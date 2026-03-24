import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  type ActivitySignals,
  classifyPullRequest,
  prViewKey,
  sortByUpdatedDesc,
  type PullDetails,
  type PullRequest,
  type Review,
} from './lib/classification'
import {
  apiFetch,
  type CombinedStatusResponse,
  type GitHubUser,
  type PullComment,
  type SearchIssuesResponse,
  type Team,
} from './lib/github'
import { etagCache } from './lib/etag-cache'
import { SmartRefreshController } from './lib/smart-refresh'
import './App.css'


type ClassifiedPullRequests = {
  yourPrs: PullRequest[]
  needsAttention: PullRequest[]
  relatedToYou: PullRequest[]
  stalePrs: PullRequest[]
  teamSignalsUnavailable: boolean
}

type ThemePreference = 'system' | 'dark' | 'light'
type StalePreference = 'stale' | 'active'

const SEARCH_PAGE_SIZE = 100
const SEARCH_MAX_PAGES = 10
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
const FALLBACK_REFRESH_MS = 10 * 60 * 1000
const NOTIFICATION_FALLBACK_MS = 2 * 60 * 1000
const REFRESH_FOCUS_COOLDOWN_MS = 5 * 60 * 1000

const STORAGE_KEYS: Record<'token' | 'org' | 'viewed' | 'theme' | 'stalePreferences', string> = {
  token: 'review-radar.pat',
  org: 'review-radar.org',
  viewed: 'review-radar.viewed',
  theme: 'review-radar.theme',
  stalePreferences: 'review-radar.stalePreferences',
}

function readStorageItem(key: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  return localStorage.getItem(key) ?? ''
}

function readViewedMap(): Record<string, number> {
  const raw = readStorageItem(STORAGE_KEYS.viewed)
  if (!raw) {
    return {}
  }

  try {
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}

function readThemePreference(): ThemePreference {
  const value = readStorageItem(STORAGE_KEYS.theme)
  if (value === 'dark' || value === 'light' || value === 'system') {
    return value
  }

  return 'system'
}

function readStalePreferences(): Record<string, StalePreference> {
  const raw = readStorageItem(STORAGE_KEYS.stalePreferences)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    const next: Record<string, StalePreference> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === 'stale' || value === 'active') {
        next[key] = value
      }
    }
    return next
  } catch {
    return {}
  }
}

function formatRefreshAge(timestampMs: number, nowMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000))

  if (diffSeconds < 5) {
    return 'just now'
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`
  }

  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  return `${diffHours}h ago`
}

function sortByPriorityAndUpdated(
  prs: PullRequest[],
  priority: Record<string, number>,
): PullRequest[] {
  return [...prs].sort((a, b) => {
    const priorityDiff = (priority[a.stateClass] ?? 99) - (priority[b.stateClass] ?? 99)
    if (priorityDiff !== 0) {
      return priorityDiff
    }

    return new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
  })
}


async function fetchAndClassifyPullRequests(
  org: string,
  token: string,
  viewedMap: Record<string, number>,
  stalePreferences: Record<string, StalePreference>,
): Promise<ClassifiedPullRequests> {
  const me = await apiFetch<GitHubUser>('https://api.github.com/user', token, etagCache)

  async function searchPullRequestUrls(query: string): Promise<Set<string>> {
    const urls = new Set<string>()

    for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
      const encodedQuery = encodeURIComponent(query)
      const response = await apiFetch<SearchIssuesResponse>(
        `https://api.github.com/search/issues?q=${encodedQuery}&sort=updated&order=desc&per_page=${SEARCH_PAGE_SIZE}&page=${page}`,
        token,
        etagCache,
      )

      for (const item of response.items) {
        if (item.pull_request?.url) {
          urls.add(item.pull_request.url)
        }
      }

      if (response.items.length < SEARCH_PAGE_SIZE) {
        break
      }
    }

    return urls
  }

  let teams: Team[] = []
  let teamSignalsUnavailable = false

  try {
    teams = await apiFetch<Team[]>('https://api.github.com/user/teams?per_page=100', token, etagCache)
  } catch {
    teamSignalsUnavailable = true
  }

  const myTeamSlugs = new Set(
    teams
      .filter((team) => team.organization.login.toLowerCase() === org.toLowerCase())
      .map((team) => team.slug),
  )

  const candidateQueries = [
    `is:pr is:open archived:false org:${org} review-requested:${me.login}`,
    `is:pr is:open archived:false org:${org} reviewed-by:${me.login}`,
    `is:pr is:open archived:false org:${org} author:${me.login}`,
    `is:pr is:open archived:false org:${org} assignee:${me.login}`,
  ]

  for (const teamSlug of myTeamSlugs) {
    candidateQueries.push(
      `is:pr is:open archived:false org:${org} team-review-requested:${org}/${teamSlug}`,
    )
  }

  const candidateUrlSets = await Promise.all(
    candidateQueries.map((query) => searchPullRequestUrls(query)),
  )

  const pullUrls = new Set<string>()
  for (const urlSet of candidateUrlSets) {
    for (const url of urlSet) {
      pullUrls.add(url)
    }
  }

  for (const key of Object.keys(viewedMap)) {
    const [repository, number] = key.split('#')
    if (!repository || !number) {
      continue
    }

    if (!repository.toLowerCase().startsWith(`${org.toLowerCase()}/`)) {
      continue
    }
    pullUrls.add(`https://api.github.com/repos/${repository}/pulls/${number}`)
  }

  const pullsWithReviews = await Promise.all(
    Array.from(pullUrls).map(async (pullUrl) => {
      const [pull, reviews, pullComments] = await Promise.all([
        apiFetch<PullDetails>(pullUrl, token, etagCache),
        apiFetch<Review[]>(`${pullUrl}/reviews?per_page=100`, token, etagCache),
        apiFetch<PullComment[]>(`${pullUrl}/comments?per_page=100`, token, etagCache),
      ])

      let checkState: PullRequest['checkState'] = 'pending'

      try {
        const combinedStatus = await apiFetch<CombinedStatusResponse>(
          `https://api.github.com/repos/${pull.base.repo.full_name}/commits/${pull.head.sha}/status`,
          token,
          etagCache,
        )

        if (combinedStatus.state === 'success') {
          checkState = 'success'
        } else if (
          combinedStatus.state === 'failure' ||
          combinedStatus.state === 'error'
        ) {
          checkState = 'failure'
        }
      } catch {
        checkState = 'pending'
      }

      return { pull, reviews, pullComments, checkState }
    }),
  )

  const yourPrs: PullRequest[] = []
  const needsAttention: PullRequest[] = []
  const relatedToYou: PullRequest[] = []
  const stalePrs: PullRequest[] = []
  const nowMs = Date.now()

  for (const { pull, reviews, pullComments, checkState } of pullsWithReviews) {
    const viewKey = prViewKey(pull.base.repo.full_name, pull.number)
    const viewedAtMs = viewedMap[viewKey]
    const normalizedLogin = me.login.toLowerCase()

    const myLatestReview = reviews
      .filter(
        (review) =>
          review.user?.login?.toLowerCase() === normalizedLogin && Boolean(review.submitted_at),
      )
      .sort(
        (a, b) =>
          new Date(b.submitted_at ?? 0).getTime() - new Date(a.submitted_at ?? 0).getTime(),
      )[0]

    const lastReviewAtMs = myLatestReview?.submitted_at
      ? new Date(myLatestReview.submitted_at).getTime()
      : undefined
    const hasNewCommitsSinceMyReview =
      lastReviewAtMs !== undefined &&
      Boolean(myLatestReview?.commit_id) &&
      myLatestReview.commit_id !== pull.head.sha

    const hasNewCommentsSinceMyReview =
      lastReviewAtMs !== undefined &&
      (reviews.some(
        (review) =>
          review.user?.login?.toLowerCase() !== normalizedLogin &&
          Boolean(review.submitted_at) &&
          new Date(review.submitted_at as string).getTime() > lastReviewAtMs,
      ) ||
        pullComments.some(
          (comment) =>
            comment.user?.login?.toLowerCase() !== normalizedLogin &&
            new Date(comment.created_at).getTime() > lastReviewAtMs,
        ))

    const hasNewReviewsSinceViewed =
      viewedAtMs !== undefined &&
      reviews.some(
        (review) =>
          review.user?.login?.toLowerCase() !== normalizedLogin &&
          Boolean(review.submitted_at) &&
          new Date(review.submitted_at as string).getTime() > viewedAtMs,
      )

    const hasNewCommentsSinceViewed =
      viewedAtMs !== undefined &&
      pullComments.some(
        (comment) =>
          comment.user?.login?.toLowerCase() !== normalizedLogin &&
          new Date(comment.created_at).getTime() > viewedAtMs,
      )

    const activitySignals: ActivitySignals = {
      hasNewCommitsSinceMyReview,
      hasNewCommentsSinceMyReview,
      hasNewReviewsSinceViewed,
      hasNewCommentsSinceViewed,
    }

    const classification = classifyPullRequest(
      pull,
      reviews,
      me.login,
      myTeamSlugs,
      viewedAtMs,
      activitySignals,
    )

    const stalePreference = stalePreferences[viewKey]
    const isAutoStale = nowMs - new Date(pull.updated_at).getTime() >= STALE_AFTER_MS
    const isStale =
      stalePreference === 'stale' || (stalePreference !== 'active' && isAutoStale)
    const staleState = stalePreference === 'stale' ? 'manual' : 'auto'

    if (classification.yourPrs) {
      const nextPr = { ...classification.yourPrs, checkState }
      if (isStale) {
        stalePrs.push({ ...nextPr, staleState })
      } else {
        yourPrs.push(nextPr)
      }
      continue
    }

    if (classification.needsAttention) {
      const nextPr = { ...classification.needsAttention, checkState }
      if (isStale) {
        stalePrs.push({ ...nextPr, staleState })
      } else {
        needsAttention.push(nextPr)
      }
      continue
    }

    if (classification.relatedToYou) {
      const nextPr = { ...classification.relatedToYou, checkState }
      if (isStale) {
        stalePrs.push({ ...nextPr, staleState })
      } else {
        relatedToYou.push(nextPr)
      }
    }
  }

  return {
    yourPrs: sortByPriorityAndUpdated(yourPrs, {
      'your-pr-new-reviews': 0,
      'your-pr-new-comments': 1,
      'your-pr-no-activity': 2,
    }),
    needsAttention: sortByPriorityAndUpdated(needsAttention, {
      'new-updates': 0,
      'new-comments': 1,
      'review-requested': 2,
    }),
    relatedToYou: sortByUpdatedDesc(relatedToYou),
    stalePrs: sortByUpdatedDesc(stalePrs),
    teamSignalsUnavailable,
  }
}

function PullRequestRow({
  pr,
  isViewed,
  onViewed,
  stalePreference,
  sectionKind,
  openMenuKey,
  onToggleMenu,
  onCloseMenu,
  onMarkStale,
  onMarkActive,
  onClearStalePreference,
}: {
  pr: PullRequest
  isViewed: boolean
  onViewed: (repository: string, number: number) => void
  stalePreference?: StalePreference
  sectionKind: 'active' | 'stale'
  openMenuKey: string | null
  onToggleMenu: (menuKey: string) => void
  onCloseMenu: () => void
  onMarkStale: (repository: string, number: number) => void
  onMarkActive: (repository: string, number: number) => void
  onClearStalePreference: (repository: string, number: number) => void
}) {
  const checkTitle =
    pr.checkState === 'success'
      ? 'Checks passed'
      : pr.checkState === 'failure'
        ? 'Checks failing'
        : 'Checks pending'

  const menuKey = prViewKey(pr.repository, pr.number)
  const isMenuOpen = openMenuKey === menuKey

  function handleViewed(): void {
    onViewed(pr.repository, pr.number)
  }

  return (
    <article className={`pr-row${isViewed ? ' viewed' : ''}`}>
      <div className="title-group">
        <a
          href={pr.authorProfileUrl}
          className="avatar-link"
          target="_blank"
          rel="noreferrer"
          title={pr.author}
          aria-label={`Open ${pr.author} profile`}
        >
          <img src={pr.authorAvatarUrl} className="avatar" alt={`${pr.author} avatar`} />
        </a>
        <div>
          <div className="pr-title-line">
            <span
              className={`check-indicator ${pr.checkState}`}
              title={checkTitle}
              aria-label={checkTitle}
            >
              {pr.checkState === 'success' ? (
                <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l2.47 2.47 5.97-5.97a.75.75 0 0 1 1.06 0Z" />
                </svg>
              ) : pr.checkState === 'failure' ? (
                <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                  <circle cx="8" cy="8" r="3.5" />
                </svg>
              )}
            </span>
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
          </div>
          <p className="pr-meta">
            #{pr.number} opened by{' '}
            <a
              href={pr.authorProfileUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.author}
            </a>{' '}
            in{' '}
            <a
              href={pr.repositoryUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.repository}
            </a>
          </p>
          {pr.requestedReviewers.length > 0 ? (
            <div className="reviewer-list" aria-label="Requested reviewers">
              {pr.requestedReviewers.map((reviewer) => (
                <a
                  key={reviewer.login}
                  href={reviewer.profileUrl}
                  className="avatar-link reviewer-avatar-link"
                  target="_blank"
                  rel="noreferrer"
                  title={reviewer.login}
                  aria-label={`Open ${reviewer.login} profile`}
                >
                  <img
                    src={reviewer.avatarUrl}
                    className="avatar reviewer-avatar"
                    alt={`${reviewer.login} avatar`}
                  />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="status-group">
        {pr.stateLabel ? (
          <span className="pill-wrap">
            <span className={`pill ${pr.stateClass}`}>{pr.stateLabel}</span>
            <span className="pill-tooltip" role="tooltip">
              {pr.reason}
            </span>
          </span>
        ) : null}
        <span className="updated-at">{pr.updatedAt}</span>
      </div>
      <div className="row-menu-wrap">
        <button
          type="button"
          className="row-menu-toggle"
          aria-label="Open row actions"
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            event.stopPropagation()
            onToggleMenu(menuKey)
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
            <path d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 6.5A1.5 1.5 0 1 1 8 6.5a1.5 1.5 0 0 1 0 3Zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
          </svg>
        </button>

        {isMenuOpen ? (
          <div className="row-menu" onClick={(event) => event.stopPropagation()}>
            {sectionKind === 'stale' ? (
              <>
                <span className="row-menu-hint">
                  {pr.staleState === 'manual' ? 'Manually stale' : 'Auto stale (30d+)'}
                </span>
                <button
                  type="button"
                  className="row-menu-item"
                  onClick={() => {
                    onMarkActive(pr.repository, pr.number)
                    onCloseMenu()
                  }}
                >
                  Not stale
                </button>
              </>
            ) : stalePreference === 'active' ? (
              <button
                type="button"
                className="row-menu-item"
                onClick={() => {
                  onClearStalePreference(pr.repository, pr.number)
                  onCloseMenu()
                }}
              >
                Use auto rule
              </button>
            ) : (
              <button
                type="button"
                className="row-menu-item danger-item"
                onClick={() => {
                  onMarkStale(pr.repository, pr.number)
                  onCloseMenu()
                }}
              >
                Mark stale
              </button>
            )}
            <a
              href={pr.url}
              className="row-menu-item"
              target="_blank"
              rel="noreferrer"
              onClick={() => onCloseMenu()}
            >
              Open PR
            </a>
            <a
              href={pr.repositoryUrl}
              className="row-menu-item"
              target="_blank"
              rel="noreferrer"
              onClick={() => onCloseMenu()}
            >
              Open repo
            </a>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function App() {
  const [tokenInput, setTokenInput] = useState(() => readStorageItem(STORAGE_KEYS.token))
  const [token, setToken] = useState(() => readStorageItem(STORAGE_KEYS.token))
  const [orgInput, setOrgInput] = useState(() => readStorageItem(STORAGE_KEYS.org) || 'MaintainX')
  const [org, setOrg] = useState(() => readStorageItem(STORAGE_KEYS.org))
  const [viewedMap, setViewedMap] = useState<Record<string, number>>(() => readViewedMap())
  const [stalePreferences, setStalePreferences] = useState<Record<string, StalePreference>>(
    () => readStalePreferences(),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<React.ReactNode>('')
  const [teamSignalsUnavailable, setTeamSignalsUnavailable] = useState(false)
  const [stalePrs, setStalePrs] = useState<PullRequest[]>([])
  const [yourPrs, setYourPrs] = useState<PullRequest[]>([])
  const [needsAttention, setNeedsAttention] = useState<PullRequest[]>([])
  const [relatedToYou, setRelatedToYou] = useState<PullRequest[]>([])
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  )
  const [isConnectionPanelOpen, setIsConnectionPanelOpen] = useState(() => {
    const savedToken = readStorageItem(STORAGE_KEYS.token)
    const savedOrg = readStorageItem(STORAGE_KEYS.org)
    return !(savedToken && savedOrg)
  })
  const [isStaleSectionOpen, setIsStaleSectionOpen] = useState(false)
  const [openRowMenuKey, setOpenRowMenuKey] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const isLoadingRef = useRef(false)
  const viewedMapRef = useRef<Record<string, number>>(viewedMap)
  const lastVisibilityRefreshAtRef = useRef(0)

  function resolveTheme(preference: ThemePreference): 'dark' | 'light' {
    if (preference === 'dark') {
      return 'dark'
    }

    if (preference === 'light') {
      return 'light'
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function applyTheme(): void {
      document.documentElement.dataset.theme = resolveTheme(themePreference)
    }

    applyTheme()

    if (themePreference !== 'system') {
      return
    }

    mediaQuery.addEventListener('change', applyTheme)
    return () => {
      mediaQuery.removeEventListener('change', applyTheme)
    }
  }, [themePreference])

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    viewedMapRef.current = viewedMap
  }, [viewedMap])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 30 * 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!isConnectionPanelOpen) {
      return
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsConnectionPanelOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isConnectionPanelOpen])

  useEffect(() => {
    if (!token || !org) {
      return
    }

    const controller = new SmartRefreshController({
      token,
      org,
      onRefresh: () => {
        if (document.visibilityState !== 'visible' || isLoadingRef.current) {
          return
        }

        setRefreshTick((current) => current + 1)
      },
      fallbackIntervalMs: FALLBACK_REFRESH_MS,
      degradedIntervalMs: NOTIFICATION_FALLBACK_MS,
    })

    controller.start()

    return () => {
      controller.stop()
    }
  }, [org, token])

  useEffect(() => {
    if (!token || !org) {
      return
    }

    function triggerFocusRefresh(): void {
      if (document.visibilityState !== 'visible' || isLoadingRef.current) {
        return
      }

      const now = Date.now()
      if (now - lastVisibilityRefreshAtRef.current < REFRESH_FOCUS_COOLDOWN_MS) {
        return
      }

      lastVisibilityRefreshAtRef.current = now
      setRefreshTick((current) => current + 1)
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === 'visible') {
        triggerFocusRefresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', triggerFocusRefresh)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', triggerFocusRefresh)
    }
  }, [org, token])

  useEffect(() => {
    function handleGlobalClick(event: MouseEvent): void {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }

      if (target.closest('.row-menu') || target.closest('.row-menu-toggle')) {
        return
      }

      setOpenRowMenuKey(null)
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpenRowMenuKey(null)
      }
    }

    document.addEventListener('mousedown', handleGlobalClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleGlobalClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (!token || !org) {
      setIsConnectionPanelOpen(true)
    }
  }, [org, token])

  useEffect(() => {
    if (!token || !org) {
      setStalePrs([])
      setYourPrs([])
      setNeedsAttention([])
      setRelatedToYou([])
      setTeamSignalsUnavailable(false)
      return
    }

    let ignore = false

    async function loadAndClassifyPulls(): Promise<void> {
      setIsLoading(true)
      setError('')

      try {
        const classified = await fetchAndClassifyPullRequests(
          org,
          token,
          viewedMapRef.current,
          stalePreferences,
        )
        if (!ignore) {
          setStalePrs(classified.stalePrs)
          setYourPrs(classified.yourPrs)
          setNeedsAttention(classified.needsAttention)
          setRelatedToYou(classified.relatedToYou)
          setTeamSignalsUnavailable(classified.teamSignalsUnavailable)
          setLastRefreshedAt(Date.now())
        }
      } catch (loadError) {
        if (!ignore) {
          const message =
            loadError instanceof Error ? loadError.message : 'Failed to load pull requests.'
          setError(message)
          setStalePrs([])
          setYourPrs([])
          setNeedsAttention([])
          setRelatedToYou([])
          setTeamSignalsUnavailable(false)
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
  }, [org, refreshTick, stalePreferences, token])

  function handleSaveConfig(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    const nextOrg = orgInput.trim()

    localStorage.setItem(STORAGE_KEYS.token, nextToken)
    localStorage.setItem(STORAGE_KEYS.org, nextOrg)
    setToken(nextToken)
    setOrg(nextOrg)
    setIsConnectionPanelOpen(false)
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

  function updateStalePreference(
    repository: string,
    number: number,
    nextValue?: StalePreference,
  ): void {
    const key = prViewKey(repository, number)

    setStalePreferences((current) => {
      const next = { ...current }
      if (nextValue) {
        next[key] = nextValue
      } else {
        delete next[key]
      }

      localStorage.setItem(STORAGE_KEYS.stalePreferences, JSON.stringify(next))
      return next
    })
  }

  function handleMarkStale(repository: string, number: number): void {
    updateStalePreference(repository, number, 'stale')
  }

  function handleMarkActive(repository: string, number: number): void {
    updateStalePreference(repository, number, 'active')
  }

  function handleClearStalePreference(repository: string, number: number): void {
    updateStalePreference(repository, number)
  }

  function handleToggleRowMenu(menuKey: string): void {
    setOpenRowMenuKey((current) => (current === menuKey ? null : menuKey))
  }

  function handleCloseRowMenu(): void {
    setOpenRowMenuKey(null)
  }

  function toggleTheme(): void {
    const activeTheme = resolveTheme(themePreference)
    const nextPreference: ThemePreference = activeTheme === 'dark' ? 'light' : 'dark'
    setThemePreference(nextPreference)
    localStorage.setItem(STORAGE_KEYS.theme, nextPreference)
  }

  const activeTheme = resolveTheme(themePreference)
  const hasSavedConnection = Boolean(token && org)
  const refreshLabel = isLoading
    ? 'Refreshing...'
    : lastRefreshedAt
      ? `Last updated ${formatRefreshAge(lastRefreshedAt, nowMs)}`
      : 'Not refreshed yet'

  return (
    <main className="app-shell">
      <button
        type="button"
        className="settings-toggle"
        aria-label="Open settings"
        onClick={() => setIsConnectionPanelOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
          <path d="M4 6.5a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2H4Zm0 7a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2H4Zm0 7a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2H4Z" />
        </svg>
      </button>

      <header className="page-header">
        <h1>Review Radar</h1>
        <p>Pull requests ranked by what needs your attention first.</p>
        <p className="refresh-meta">{refreshLabel}</p>
      </header>

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
            <PullRequestRow
              key={pr.id}
              pr={pr}
              isViewed={Boolean(viewedMap[prViewKey(pr.repository, pr.number)])}
              onViewed={handleViewed}
              sectionKind="active"
              openMenuKey={openRowMenuKey}
              onToggleMenu={handleToggleRowMenu}
              onCloseMenu={handleCloseRowMenu}
              stalePreference={stalePreferences[prViewKey(pr.repository, pr.number)]}
              onMarkStale={handleMarkStale}
              onMarkActive={handleMarkActive}
              onClearStalePreference={handleClearStalePreference}
            />
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2>Your PRs</h2>
          <span>{yourPrs.length}</span>
        </div>
        <div>
          {isLoading ? <p className="empty-state">Loading your assigned/authored PRs...</p> : null}
          {!isLoading && !error && token && org && yourPrs.length === 0 ? (
            <p className="empty-state">No assigned or authored pull requests right now.</p>
          ) : null}
          {!isLoading && !error && (!token || !org) ? (
            <p className="empty-state">Add org + PAT above to load pull requests from GitHub.</p>
          ) : null}
          {yourPrs.map((pr) => (
            <PullRequestRow
              key={pr.id}
              pr={pr}
              isViewed={Boolean(viewedMap[prViewKey(pr.repository, pr.number)])}
              onViewed={handleViewed}
              sectionKind="active"
              openMenuKey={openRowMenuKey}
              onToggleMenu={handleToggleRowMenu}
              onCloseMenu={handleCloseRowMenu}
              stalePreference={stalePreferences[prViewKey(pr.repository, pr.number)]}
              onMarkStale={handleMarkStale}
              onMarkActive={handleMarkActive}
              onClearStalePreference={handleClearStalePreference}
            />
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
            <PullRequestRow
              key={pr.id}
              pr={pr}
              isViewed={Boolean(viewedMap[prViewKey(pr.repository, pr.number)])}
              onViewed={handleViewed}
              sectionKind="active"
              openMenuKey={openRowMenuKey}
              onToggleMenu={handleToggleRowMenu}
              onCloseMenu={handleCloseRowMenu}
              stalePreference={stalePreferences[prViewKey(pr.repository, pr.number)]}
              onMarkStale={handleMarkStale}
              onMarkActive={handleMarkActive}
              onClearStalePreference={handleClearStalePreference}
            />
          ))}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2>Stale PRs</h2>
          <div className="section-header-tools">
            <span>{stalePrs.length}</span>
            <button
              type="button"
              className="section-action"
              onClick={() => setIsStaleSectionOpen((current) => !current)}
            >
              {isStaleSectionOpen ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {isStaleSectionOpen ? (
          <div>
            {isLoading ? <p className="empty-state">Loading stale pull requests...</p> : null}
            {!isLoading && !error && token && org && stalePrs.length === 0 ? (
              <p className="empty-state">No stale pull requests right now.</p>
            ) : null}
            {!isLoading && !error && (!token || !org) ? (
              <p className="empty-state">Add org + PAT above to load pull requests from GitHub.</p>
            ) : null}
            {stalePrs.map((pr) => (
              <PullRequestRow
                key={pr.id}
                pr={pr}
                isViewed={Boolean(viewedMap[prViewKey(pr.repository, pr.number)])}
                onViewed={handleViewed}
                sectionKind="stale"
                openMenuKey={openRowMenuKey}
                onToggleMenu={handleToggleRowMenu}
                onCloseMenu={handleCloseRowMenu}
                stalePreference={stalePreferences[prViewKey(pr.repository, pr.number)]}
                onMarkStale={handleMarkStale}
                onMarkActive={handleMarkActive}
                onClearStalePreference={handleClearStalePreference}
              />
            ))}
          </div>
        ) : (
          <p className="collapsed-hint">Hidden by default to keep active triage focused.</p>
        )}
      </section>

      {isConnectionPanelOpen ? (
        <>
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Close settings"
            onClick={() => setIsConnectionPanelOpen(false)}
          />
          <aside className="settings-drawer" aria-label="Connection settings">
            <div className="settings-header">
              <h2>Settings</h2>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsConnectionPanelOpen(false)}
              >
                Close
              </button>
            </div>
            {hasSavedConnection ? (
              <p className="connection-summary">Connected to {org} with saved PAT.</p>
            ) : null}
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
            <div className="helper-copy">
              <p>
                PAT is stored in local storage for this browser profile.
              </p>
              <p>
                <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                  Create a fine-grained PAT
                </a>
                {' '}and set <strong>Resource owner</strong> to <strong>MaintainX</strong> (the
                Resource owner cannot be changed after creation — if your existing token uses
                your personal account, you need to generate a new one). Then select{' '}
                <strong>All repositories</strong> and grant these permissions:
              </p>
              <ul>
                <li>Pull requests: Read (required)</li>
                <li>Commit statuses: Read (required for PR check status icons)</li>
                <li>Administration: Read (optional, enables team-assigned PR signals)</li>
              </ul>
              <p>
                For <strong>live refresh</strong> (~60s), use a{' '}
                <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer">
                  classic token
                </a>
                {' '}with <strong>repo</strong> and <strong>notifications</strong> scopes, then
                authorize it for <strong>MaintainX SSO</strong>. Fine-grained tokens use
                2-minute polling instead (still efficient via ETag caching).
              </p>
            </div>
            {teamSignalsUnavailable ? (
              <p className="helper-copy warning-copy">
                Team permissions are unavailable for this token. Showing direct-review and
                activity-based signals only.
              </p>
            ) : null}
          </aside>
        </>
      ) : null}

      <button
        type="button"
        className="theme-fab"
        onClick={toggleTheme}
        title={`Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} mode`}
        aria-label={`Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {activeTheme === 'dark' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm0-14a1 1 0 0 0 1-1V2a1 1 0 1 0-2 0v1a1 1 0 0 0 1 1Zm0 17a1 1 0 0 0-1 1v1a1 1 0 1 0 2 0v-1a1 1 0 0 0-1-1Zm8-8a1 1 0 0 0 1-1 1 1 0 1 0 0-2h-1a1 1 0 1 0 0 2h1ZM4 12a1 1 0 1 0 0-2H3a1 1 0 1 0 0 2h1Zm12.95 6.536a1 1 0 0 0 1.414 0l.707-.707a1 1 0 1 0-1.414-1.414l-.707.707a1 1 0 0 0 0 1.414ZM6.343 7.929a1 1 0 0 0 1.414 0l.707-.707A1 1 0 1 0 7.05 5.808l-.707.707a1 1 0 0 0 0 1.414Zm11.314 0a1 1 0 0 0 0-1.414l-.707-.707a1 1 0 1 0-1.414 1.414l.707.707a1 1 0 0 0 1.414 0ZM7.757 18.536a1 1 0 0 0 0-1.414l-.707-.707a1 1 0 0 0-1.414 1.414l.707.707a1 1 0 0 0 1.414 0Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <path d="M20.742 14.045A8 8 0 0 1 9.955 3.258a1 1 0 0 0-1.17-1.17A10 10 0 1 0 21.912 15.215a1 1 0 0 0-1.17-1.17Z" />
          </svg>
        )}
      </button>
    </main>
  )
}

export default App
