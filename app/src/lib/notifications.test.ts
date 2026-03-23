import { describe, it, expect } from 'vitest'
import { filterPrNotifications, hasRelevantPrChanges, type GitHubNotification } from './notifications'

function createNotification(overrides: Partial<GitHubNotification> = {}): GitHubNotification {
  return {
    id: '1',
    subject: {
      title: 'feat: add thing',
      type: 'PullRequest',
      url: 'https://api.github.com/repos/acme/repo/pulls/1',
    },
    repository: {
      full_name: 'acme/repo',
    },
    updated_at: '2026-03-23T10:00:00Z',
    reason: 'review_requested',
    ...overrides,
  }
}

describe('filterPrNotifications', () => {
  describe('with PullRequest notifications', () => {
    it('should return only items where subject.type === "PullRequest" AND repository.full_name starts with org/', () => {
      const notifications: GitHubNotification[] = [
        createNotification({
          id: '1',
          subject: { title: 'PR 1', type: 'PullRequest', url: 'https://api.github.com/repos/acme/repo/pulls/1' },
          repository: { full_name: 'acme/repo' },
        }),
        createNotification({
          id: '2',
          subject: { title: 'PR 2', type: 'PullRequest', url: 'https://api.github.com/repos/acme/other/pulls/2' },
          repository: { full_name: 'acme/other' },
        }),
      ]
      const result = filterPrNotifications(notifications, 'acme')
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('1')
      expect(result[1].id).toBe('2')
    })

    it('should return empty array when no PR notifications match (all are Issues)', () => {
      const notifications: GitHubNotification[] = [
        createNotification({
          id: '1',
          subject: { title: 'Issue 1', type: 'Issue', url: 'https://api.github.com/repos/acme/repo/issues/1' },
          repository: { full_name: 'acme/repo' },
        }),
        createNotification({
          id: '2',
          subject: { title: 'Issue 2', type: 'Issue', url: 'https://api.github.com/repos/acme/other/issues/2' },
          repository: { full_name: 'acme/other' },
        }),
      ]
      const result = filterPrNotifications(notifications, 'acme')
      expect(result).toHaveLength(0)
    })

    it('should return empty array for empty input', () => {
      const result = filterPrNotifications([], 'acme')
      expect(result).toHaveLength(0)
    })

    it('should handle mixed notification types correctly (Issue, PullRequest, Release in same array)', () => {
      const notifications: GitHubNotification[] = [
        createNotification({
          id: '1',
          subject: { title: 'Issue 1', type: 'Issue', url: 'https://api.github.com/repos/acme/repo/issues/1' },
          repository: { full_name: 'acme/repo' },
        }),
        createNotification({
          id: '2',
          subject: { title: 'PR 1', type: 'PullRequest', url: 'https://api.github.com/repos/acme/repo/pulls/1' },
          repository: { full_name: 'acme/repo' },
        }),
        createNotification({
          id: '3',
          subject: { title: 'Release 1', type: 'Release', url: 'https://api.github.com/repos/acme/repo/releases/1' },
          repository: { full_name: 'acme/repo' },
        }),
      ]
      const result = filterPrNotifications(notifications, 'acme')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('2')
    })

    it('should match org case-insensitively: "MaintainX" org matches "maintainx/repo" full_name', () => {
      const notifications: GitHubNotification[] = [
        createNotification({
          id: '1',
          subject: { title: 'PR 1', type: 'PullRequest', url: 'https://api.github.com/repos/maintainx/repo/pulls/1' },
          repository: { full_name: 'maintainx/repo' },
        }),
      ]
      const result = filterPrNotifications(notifications, 'MaintainX')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('1')
    })
  })

  describe('with different org', () => {
    it('should not match PRs from different org', () => {
      const notifications: GitHubNotification[] = [
        createNotification({
          id: '1',
          subject: { title: 'PR 1', type: 'PullRequest', url: 'https://api.github.com/repos/other/repo/pulls/1' },
          repository: { full_name: 'other/repo' },
        }),
      ]
      const result = filterPrNotifications(notifications, 'acme')
      expect(result).toHaveLength(0)
    })
  })
})

describe('hasRelevantPrChanges', () => {
  it('should return true when there are matching PR notifications', () => {
    const notifications: GitHubNotification[] = [
      createNotification({
        id: '1',
        subject: { title: 'PR 1', type: 'PullRequest', url: 'https://api.github.com/repos/acme/repo/pulls/1' },
        repository: { full_name: 'acme/repo' },
      }),
    ]
    const result = hasRelevantPrChanges(notifications, 'acme')
    expect(result).toBe(true)
  })

  it('should return false when no matching notifications', () => {
    const notifications: GitHubNotification[] = [
      createNotification({
        id: '1',
        subject: { title: 'Issue 1', type: 'Issue', url: 'https://api.github.com/repos/acme/repo/issues/1' },
        repository: { full_name: 'acme/repo' },
      }),
    ]
    const result = hasRelevantPrChanges(notifications, 'acme')
    expect(result).toBe(false)
  })
})
