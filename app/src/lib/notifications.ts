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
