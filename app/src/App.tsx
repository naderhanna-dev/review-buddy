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
  url: string
  stateLabel: string
  reason: string
  isDraft?: boolean
}

type SearchIssueItem = {
  id: number
  number: number
  title: string
  html_url: string
  updated_at: string
  draft?: boolean
  user: {
    login: string
  }
  repository_url: string
}

type SearchIssuesResponse = {
  items: SearchIssueItem[]
}

const STORAGE_KEYS = {
  token: 'review-radar.pat',
  org: 'review-radar.org',
}

function getRepositoryName(repositoryUrl: string): string {
  const parts = repositoryUrl.split('/')
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
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

async function fetchOpenPullRequests(org: string, token: string): Promise<PullRequest[]> {
  const query = encodeURIComponent(`is:pr is:open archived:false org:${org}`)
  const response = await fetch(
    `https://api.github.com/search/issues?q=${query}&sort=updated&order=desc&per_page=100`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid token. Check PAT scope and retry.')
    }

    if (response.status === 403) {
      throw new Error('Access forbidden or rate limit hit. Retry in a few minutes.')
    }

    throw new Error(`GitHub request failed (${response.status}).`)
  }

  const data = (await response.json()) as SearchIssuesResponse

  return data.items.map((item) => ({
    id: item.id,
    number: item.number,
    title: item.title,
    repository: getRepositoryName(item.repository_url),
    author: item.user.login,
    updatedAt: formatRelativeTime(item.updated_at),
    url: item.html_url,
    stateLabel: 'Open',
    reason: 'Fetched from GitHub; classification rules apply in next step',
    isDraft: item.draft,
  }))
}

function PullRequestRow({ pr }: { pr: PullRequest }) {
  const statusClass = pr.stateLabel.toLowerCase().replace(/\s+/g, '-')

  return (
    <article className="pr-row">
      <div className="title-group">
        <div>
          <a href={pr.url} className="pr-title" target="_blank" rel="noreferrer">
            {pr.isDraft ? '[Draft] ' : ''}
            {pr.title}
          </a>
          <p className="pr-meta">
            #{pr.number} opened by {pr.author} in {pr.repository}
          </p>
        </div>
      </div>
      <div className="status-group">
        <span className={`pill ${statusClass}`}>{pr.stateLabel}</span>
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [openPrs, setOpenPrs] = useState<PullRequest[]>([])

  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_KEYS.token) ?? ''
    const storedOrg = localStorage.getItem(STORAGE_KEYS.org) ?? ''
    setToken(storedToken)
    setTokenInput(storedToken)
    setOrg(storedOrg)
    setOrgInput(storedOrg)
  }, [])

  useEffect(() => {
    if (!token || !org) {
      return
    }

    let ignore = false

    async function loadOpenPrs(): Promise<void> {
      setIsLoading(true)
      setError('')

      try {
        const prs = await fetchOpenPullRequests(org, token)
        if (!ignore) {
          setOpenPrs(prs)
        }
      } catch (loadError) {
        if (!ignore) {
          const message = loadError instanceof Error ? loadError.message : 'Failed to load pull requests.'
          setError(message)
          setOpenPrs([])
        }
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }

    void loadOpenPrs()

    return () => {
      ignore = true
    }
  }, [org, token])

  const needsAttention: PullRequest[] = []
  const relatedToYou = openPrs

  function handleSaveConfig(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    const nextOrg = orgInput.trim()

    localStorage.setItem(STORAGE_KEYS.token, nextToken)
    localStorage.setItem(STORAGE_KEYS.org, nextOrg)
    setToken(nextToken)
    setOrg(nextOrg)
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
          PAT is stored in local storage for this browser profile. OAuth app integration is planned next.
        </p>
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2>Needs your attention</h2>
          <span>{needsAttention.length}</span>
        </div>
        <div>
          {needsAttention.length === 0 ? (
            <p className="empty-state">Classification engine is not wired yet.</p>
          ) : null}
          {needsAttention.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
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
            <p className="empty-state">No open pull requests found for this organization.</p>
          ) : null}
          {!isLoading && !error && (!token || !org) ? (
            <p className="empty-state">Add org + PAT above to load pull requests from GitHub.</p>
          ) : null}
          {relatedToYou.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
