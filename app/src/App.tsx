import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  classifyPullRequest,
  prViewKey,
  sortByUpdatedDesc,
  type PullDetails,
  type PullRequest,
  type Review,
} from './lib/classification'
import './App.css'

type SearchIssueItem = {
  pull_request?: {
    url: string
  }
}

type SearchIssuesResponse = {
  items: SearchIssueItem[]
}

type GitHubUser = {
  login: string
}

type Team = {
  slug: string
  organization: {
    login: string
  }
}

type ClassifiedPullRequests = {
  needsAttention: PullRequest[]
  relatedToYou: PullRequest[]
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
const OAUTH_CLIENT_ID = import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID ?? ''

const STORAGE_KEYS: Record<'token' | 'org' | 'viewed', string> = {
  token: 'review-radar.pat',
  org: 'review-radar.org',
  viewed: 'review-radar.viewed',
}
const OAUTH_STATE_KEY = 'review-radar.oauth.state'

async function apiFetch<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid token. Check PAT scope and retry.')
    }

    if (response.status === 403) {
      throw new Error('Access forbidden or rate limit hit. Retry in a few minutes.')
    }

    throw new Error(`GitHub request failed (${response.status}).`)
  }

  return (await response.json()) as T
}

async function fetchAndClassifyPullRequests(
  org: string,
  token: string,
  viewedMap: Record<string, number>,
): Promise<ClassifiedPullRequests> {
  const query = encodeURIComponent(`is:pr is:open archived:false org:${org}`)
  const [me, teams, search] = await Promise.all([
    apiFetch<GitHubUser>('https://api.github.com/user', token),
    apiFetch<Team[]>('https://api.github.com/user/teams?per_page=100', token),
    apiFetch<SearchIssuesResponse>(
      `https://api.github.com/search/issues?q=${query}&sort=updated&order=desc&per_page=50`,
      token,
    ),
  ])

  const myTeamSlugs = new Set(
    teams
      .filter((team) => team.organization.login.toLowerCase() === org.toLowerCase())
      .map((team) => team.slug),
  )

  const pullUrls = search.items
    .map((item) => item.pull_request?.url)
    .filter((url): url is string => Boolean(url))

  const pullsWithReviews = await Promise.all(
    pullUrls.map(async (pullUrl) => {
      const [pull, reviews] = await Promise.all([
        apiFetch<PullDetails>(pullUrl, token),
        apiFetch<Review[]>(`${pullUrl}/reviews?per_page=100`, token),
      ])

      return { pull, reviews }
    }),
  )

  const needsAttention: PullRequest[] = []
  const relatedToYou: PullRequest[] = []

  for (const { pull, reviews } of pullsWithReviews) {
    const viewKey = prViewKey(pull.base.repo.full_name, pull.number)
    const classification = classifyPullRequest(
      pull,
      reviews,
      me.login,
      myTeamSlugs,
      viewedMap[viewKey],
    )

    if (classification.needsAttention) {
      needsAttention.push(classification.needsAttention)
      continue
    }

    if (classification.relatedToYou) {
      relatedToYou.push(classification.relatedToYou)
    }
  }

  return {
    needsAttention: sortByUpdatedDesc(needsAttention),
    relatedToYou: sortByUpdatedDesc(relatedToYou),
  }
}

function PullRequestRow({
  pr,
  onViewed,
}: {
  pr: PullRequest
  onViewed: (repository: string, number: number) => void
}) {
  function handleViewed(): void {
    onViewed(pr.repository, pr.number)
  }

  return (
    <article className="pr-row">
      <div className="title-group">
        <div>
          <a
            href={pr.url}
            className="pr-title"
            target="_blank"
            rel="noreferrer"
            onClick={handleViewed}
          >
            {pr.isDraft ? '[Draft] ' : ''}
            {pr.title}
          </a>
          <p className="pr-meta">
            #{pr.number} opened by {pr.author} in {pr.repository}
          </p>
        </div>
      </div>
      <div className="status-group">
        <span className={`pill ${pr.stateClass}`}>{pr.stateLabel}</span>
        <span className="updated-at">{pr.updatedAt}</span>
      </div>
      <p className="reason">{pr.reason}</p>
    </article>
  )
}

function App() {
  const [tokenInput, setTokenInput] = useState('')
  const [token, setToken] = useState('')
  const [orgInput, setOrgInput] = useState('')
  const [org, setOrg] = useState('')
  const [viewedMap, setViewedMap] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isExchangingCode, setIsExchangingCode] = useState(false)
  const [error, setError] = useState('')
  const [needsAttention, setNeedsAttention] = useState<PullRequest[]>([])
  const [relatedToYou, setRelatedToYou] = useState<PullRequest[]>([])

  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_KEYS.token) ?? ''
    const storedOrg = localStorage.getItem(STORAGE_KEYS.org) ?? ''
    const storedViewed = localStorage.getItem(STORAGE_KEYS.viewed)
    let parsedViewed: Record<string, number> = {}
    if (storedViewed) {
      try {
        parsedViewed = JSON.parse(storedViewed) as Record<string, number>
      } catch {
        parsedViewed = {}
      }
    }

    setToken(storedToken)
    setTokenInput(storedToken)
    setOrg(storedOrg)
    setOrgInput(storedOrg)
    setViewedMap(parsedViewed)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthError = params.get('error')
    const oauthCode = params.get('code')
    const returnedState = params.get('state')

    if (!oauthError && !oauthCode) {
      return
    }

    const storedState = localStorage.getItem(OAUTH_STATE_KEY)
    const clearOAuthParams = () => {
      const cleanUrl = `${window.location.origin}${window.location.pathname}`
      window.history.replaceState({}, '', cleanUrl)
      localStorage.removeItem(OAUTH_STATE_KEY)
    }

    if (oauthError) {
      setError(`OAuth error: ${oauthError}`)
      clearOAuthParams()
      return
    }

    if (!oauthCode) {
      setError('OAuth callback is missing authorization code.')
      clearOAuthParams()
      return
    }

    if (!returnedState || !storedState || returnedState !== storedState) {
      setError('OAuth state mismatch. Please retry sign-in.')
      clearOAuthParams()
      return
    }

    async function exchangeCodeForToken(): Promise<void> {
      setIsExchangingCode(true)
      setError('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/github/exchange`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: oauthCode,
            redirectUri: `${window.location.origin}/`,
          }),
        })

        const payload = (await response.json()) as {
          accessToken?: string
          error?: string
        }

        if (!response.ok || !payload.accessToken) {
          throw new Error(payload.error ?? 'OAuth token exchange failed.')
        }

        localStorage.setItem(STORAGE_KEYS.token, payload.accessToken)
        setToken(payload.accessToken)
        setTokenInput(payload.accessToken)
      } catch (exchangeError) {
        const message =
          exchangeError instanceof Error
            ? exchangeError.message
            : 'OAuth token exchange failed.'
        setError(message)
      } finally {
        setIsExchangingCode(false)
        clearOAuthParams()
      }
    }

    void exchangeCodeForToken()
  }, [])

  useEffect(() => {
    if (!token || !org) {
      setNeedsAttention([])
      setRelatedToYou([])
      return
    }

    let ignore = false

    async function loadAndClassifyPulls(): Promise<void> {
      setIsLoading(true)
      setError('')

      try {
        const classified = await fetchAndClassifyPullRequests(org, token, viewedMap)
        if (!ignore) {
          setNeedsAttention(classified.needsAttention)
          setRelatedToYou(classified.relatedToYou)
        }
      } catch (loadError) {
        if (!ignore) {
          const message =
            loadError instanceof Error ? loadError.message : 'Failed to load pull requests.'
          setError(message)
          setNeedsAttention([])
          setRelatedToYou([])
        }
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }

    void loadAndClassifyPulls()

    return () => {
      ignore = true
    }
  }, [org, token, viewedMap])

  function handleSaveConfig(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    const nextOrg = orgInput.trim()

    localStorage.setItem(STORAGE_KEYS.token, nextToken)
    localStorage.setItem(STORAGE_KEYS.org, nextOrg)
    setToken(nextToken)
    setOrg(nextOrg)
  }

  function handleViewed(repository: string, number: number): void {
    const key = prViewKey(repository, number)
    const now = Date.now()
    setViewedMap((current) => {
      const next = { ...current, [key]: now }
      localStorage.setItem(STORAGE_KEYS.viewed, JSON.stringify(next))
      return next
    })
  }

  function startOAuthSignIn(): void {
    if (!OAUTH_CLIENT_ID) {
      setError(
        'Missing VITE_GITHUB_OAUTH_CLIENT_ID. Configure it before using OAuth sign-in.',
      )
      return
    }

    const state =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

    localStorage.setItem(OAUTH_STATE_KEY, state)

    const query = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: `${window.location.origin}/`,
      scope: 'repo read:org',
      state,
    })

    window.location.href = `https://github.com/login/oauth/authorize?${query.toString()}`
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <h1>ReviewRadar</h1>
        <p>Pull requests ranked by what needs your attention first.</p>
      </header>

      <section className="section-card">
        <div className="section-header">
          <h2>Connection</h2>
        </div>
        <form className="config-form" onSubmit={handleSaveConfig}>
          <label>
            GitHub organization
            <input
              type="text"
              value={orgInput}
              onChange={(event) => setOrgInput(event.target.value)}
              placeholder="your-org"
              autoComplete="organization"
            />
          </label>
          <label>
            Personal access token
            <input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="github_pat_..."
              autoComplete="off"
            />
          </label>
          <button type="submit">Save and refresh</button>
        </form>
        <div className="oauth-row">
          <button type="button" onClick={startOAuthSignIn} disabled={isExchangingCode}>
            {isExchangingCode ? 'Completing OAuth...' : 'Sign in with GitHub OAuth'}
          </button>
          <p>
            OAuth is now supported via a local exchange server. PAT remains available as
            fallback.
          </p>
        </div>
        <p className="helper-copy">
          PAT is stored in local storage for this browser profile. Recommended scopes: `repo`
          and `read:org`.
        </p>
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2>Needs your attention</h2>
          <span>{needsAttention.length}</span>
        </div>
        <div>
          {isLoading ? <p className="empty-state">Classifying pull requests...</p> : null}
          {!isLoading && !error && token && org && needsAttention.length === 0 ? (
            <p className="empty-state">Nothing currently needs your immediate attention.</p>
          ) : null}
          {!isLoading && !error && (!token || !org) ? (
            <p className="empty-state">Add org + PAT above to classify pull requests.</p>
          ) : null}
          {needsAttention.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} onViewed={handleViewed} />
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2>Related to you</h2>
          <span>{relatedToYou.length}</span>
        </div>
        <div>
          {isLoading ? <p className="empty-state">Loading open pull requests...</p> : null}
          {error ? <p className="empty-state error-state">{error}</p> : null}
          {!isLoading && !error && token && org && relatedToYou.length === 0 ? (
            <p className="empty-state">No non-urgent related pull requests right now.</p>
          ) : null}
          {!isLoading && !error && (!token || !org) ? (
            <p className="empty-state">Add org + PAT above to load pull requests from GitHub.</p>
          ) : null}
          {relatedToYou.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} onViewed={handleViewed} />
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
