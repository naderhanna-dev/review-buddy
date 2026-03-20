import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type PullRequest = {
  id: number
  number: number
  title: string
  repository: string
  author: string
  updatedAt: string
  updatedAtIso: string
  url: string
  stateLabel: string
  stateClass: string
  reason: string
  isDraft?: boolean
}

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

type PullDetails = {
  id: number
  number: number
  title: string
  html_url: string
  updated_at: string
  draft?: boolean
  user: {
    login: string
  }
  requested_reviewers: Array<{
    login: string
  }>
  requested_teams: Array<{
    slug: string
  }>
  base: {
    repo: {
      full_name: string
    }
  }
}

type Review = {
  state: string
  submitted_at?: string
  user?: {
    login: string
  }
}

type ClassifiedPullRequests = {
  needsAttention: PullRequest[]
  relatedToYou: PullRequest[]
}

const STORAGE_KEYS = {
  token: 'review-radar.pat',
  org: 'review-radar.org',
  viewed: 'review-radar.viewed',
}

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)))

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function prViewKey(repository: string, number: number): string {
  return `${repository}#${number}`
}

function sortByUpdatedDesc(prs: PullRequest[]): PullRequest[] {
  return prs.sort(
    (a, b) => new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
  )
}

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

function classifyPullRequest(
  pull: PullDetails,
  reviews: Review[],
  myLogin: string,
  myTeamSlugs: Set<string>,
  viewedAtMs?: number,
): { needsAttention?: PullRequest; relatedToYou?: PullRequest } {
  const myReviews = reviews
    .filter((review) => review.user?.login === myLogin && review.submitted_at)
    .sort(
      (a, b) =>
        new Date(b.submitted_at ?? 0).getTime() - new Date(a.submitted_at ?? 0).getTime(),
    )

  const lastReview = myReviews[0]
  const hasSubmittedReview = Boolean(lastReview)
  const pullUpdatedAtMs = new Date(pull.updated_at).getTime()
  const lastReviewAtMs = lastReview?.submitted_at
    ? new Date(lastReview.submitted_at).getTime()
    : undefined
  const requestedReviewerLogins = pull.requested_reviewers.map((reviewer) => reviewer.login)
  const requestedTeamSlugs = pull.requested_teams.map((team) => team.slug)

  const isRequiredReviewer = requestedReviewerLogins.includes(myLogin)
  const hasUpdateSinceMyReview =
    lastReviewAtMs !== undefined && pullUpdatedAtMs > lastReviewAtMs
  const assignedToMyTeam = requestedTeamSlugs.some((teamSlug) => myTeamSlugs.has(teamSlug))
  const lookedWithoutReviewAndUpdated =
    viewedAtMs !== undefined && !hasSubmittedReview && pullUpdatedAtMs > viewedAtMs

  const basePr: Omit<PullRequest, 'stateLabel' | 'stateClass' | 'reason'> = {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    repository: pull.base.repo.full_name,
    author: pull.user.login,
    updatedAt: formatRelativeTime(pull.updated_at),
    updatedAtIso: pull.updated_at,
    url: pull.html_url,
    isDraft: pull.draft,
  }

  if (isRequiredReviewer || hasUpdateSinceMyReview) {
    if (isRequiredReviewer && hasUpdateSinceMyReview) {
      return {
        needsAttention: {
          ...basePr,
          stateLabel: 'Required + updated',
          stateClass: 'required-and-updated',
          reason: 'You are requested and new updates landed since your last review.',
        },
      }
    }

    if (isRequiredReviewer) {
      return {
        needsAttention: {
          ...basePr,
          stateLabel: 'Required review',
          stateClass: 'required-review',
          reason: 'You are requested as a required reviewer.',
        },
      }
    }

    return {
      needsAttention: {
        ...basePr,
        stateLabel: 'Updated since review',
        stateClass: 'updated-since-review',
        reason: 'You already reviewed this PR and it changed afterward.',
      },
    }
  }

  if (assignedToMyTeam || lookedWithoutReviewAndUpdated) {
    if (assignedToMyTeam && lookedWithoutReviewAndUpdated) {
      return {
        relatedToYou: {
          ...basePr,
          stateLabel: 'Team + viewed update',
          stateClass: 'team-review',
          reason: 'Requested from your team, and updated after you looked without a review.',
        },
      }
    }

    if (assignedToMyTeam) {
      return {
        relatedToYou: {
          ...basePr,
          stateLabel: 'Team review',
          stateClass: 'team-review',
          reason: 'Requested from one of your teams.',
        },
      }
    }

    return {
      relatedToYou: {
        ...basePr,
        stateLabel: 'Viewed, then updated',
        stateClass: 'viewed-updated',
        reason: 'You looked at this PR without reviewing and it has new updates.',
      },
    }
  }

  return {}
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
  const [error, setError] = useState('')
  const [needsAttention, setNeedsAttention] = useState<PullRequest[]>([])
  const [relatedToYou, setRelatedToYou] = useState<PullRequest[]>([])

  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_KEYS.token) ?? ''
    const storedOrg = localStorage.getItem(STORAGE_KEYS.org) ?? ''
    const storedViewed = localStorage.getItem(STORAGE_KEYS.viewed)
    const parsedViewed = storedViewed
      ? (JSON.parse(storedViewed) as Record<string, number>)
      : {}

    setToken(storedToken)
    setTokenInput(storedToken)
    setOrg(storedOrg)
    setOrgInput(storedOrg)
    setViewedMap(parsedViewed)
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
