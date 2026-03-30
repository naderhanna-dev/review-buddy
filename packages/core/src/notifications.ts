export type GitHubNotification = {
  id: string
  subject: {
    title: string
    type: string
    url: string
  }
  repository: {
    full_name: string
  }
  updated_at: string
  reason: string
}

export function filterPrNotifications(
  notifications: GitHubNotification[],
  org: string,
): GitHubNotification[] {
  const prefix = `${org.toLowerCase()}/`
  return notifications.filter(
    (n) =>
      n.subject.type === 'PullRequest' &&
      n.repository.full_name.toLowerCase().startsWith(prefix),
  )
}

export function hasRelevantPrChanges(
  notifications: GitHubNotification[],
  org: string,
): boolean {
  return filterPrNotifications(notifications, org).length > 0
}

export type NotificationCheckResult = {
  hasChanges: boolean
  pollIntervalSeconds: number
  lastModified?: string
  notificationsUnavailable?: boolean
}

const GITHUB_AUTH_HEADERS = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
})

const DEFAULT_POLL_INTERVAL_SECONDS = 60

function parsePollInterval(headers: Headers): number {
  const value = headers.get('x-poll-interval')
  if (!value) return DEFAULT_POLL_INTERVAL_SECONDS
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? DEFAULT_POLL_INTERVAL_SECONDS : parsed
}

export async function checkForNotificationChanges(
  token: string,
  org: string,
  lastModified?: string,
): Promise<NotificationCheckResult> {
  const headers: Record<string, string> = {
    ...GITHUB_AUTH_HEADERS(token),
  }

  if (lastModified) {
    headers['If-Modified-Since'] = lastModified
  }

  let response: Response
  try {
    response = await fetch(
      'https://api.github.com/notifications?all=false&participating=true',
      { headers },
    )
  } catch {
    return { hasChanges: false, pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS }
  }

  const pollIntervalSeconds = parsePollInterval(response.headers)
  const lastModifiedHeader = response.headers.get('last-modified') ?? undefined

  if (response.status === 304) {
    return { hasChanges: false, pollIntervalSeconds, lastModified: lastModifiedHeader }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      hasChanges: false,
      pollIntervalSeconds: 120,
      notificationsUnavailable: true,
    }
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    const backoff = retryAfter ? parseInt(retryAfter, 10) : pollIntervalSeconds * 2
    return {
      hasChanges: false,
      pollIntervalSeconds: isNaN(backoff) ? pollIntervalSeconds * 2 : backoff,
    }
  }

  if (!response.ok) {
    return { hasChanges: false, pollIntervalSeconds }
  }

  const notifications = (await response.json()) as GitHubNotification[]
  const hasChanges = hasRelevantPrChanges(notifications, org)

  return { hasChanges, pollIntervalSeconds, lastModified: lastModifiedHeader }
}
