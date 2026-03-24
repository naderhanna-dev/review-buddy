import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkForNotificationChanges,
  filterPrNotifications,
  hasRelevantPrChanges,
  type GitHubNotification,
} from './notifications'

vi.stubGlobal('fetch', vi.fn())

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

describe('checkForNotificationChanges', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('should call GET /notifications with correct auth headers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-poll-interval': '60' },
      }),
    )

    await checkForNotificationChanges('my-token', 'acme')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/notifications?all=false&participating=true',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      }),
    )
  })

  it('should send If-Modified-Since when lastModified provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-poll-interval': '60' },
      }),
    )

    await checkForNotificationChanges('my-token', 'acme', 'Mon, 23 Mar 2026 10:00:00 GMT')

    const calledHeaders = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined
    const headers = calledHeaders?.headers as Record<string, string> | undefined
    expect(headers?.['If-Modified-Since']).toBe('Mon, 23 Mar 2026 10:00:00 GMT')
  })

  it('should return hasChanges: false on 304', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 304,
      headers: new Headers({ 'x-poll-interval': '60' }),
    } as Response)

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.hasChanges).toBe(false)
    expect(result.pollIntervalSeconds).toBe(60)
  })

  it('should return hasChanges: true on 200 with PR notifications', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          createNotification({
            id: '1',
            subject: { type: 'PullRequest', url: 'https://api.github.com/repos/acme/repo/pulls/1', title: 'PR' },
            repository: { full_name: 'acme/repo' },
            reason: 'review_requested',
          }),
        ]),
        { status: 200, headers: { 'x-poll-interval': '60' } },
      ),
    )

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.hasChanges).toBe(true)
  })

  it('should return hasChanges: false on 200 with no PR notifications (only Issues)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          createNotification({
            id: '1',
            subject: { type: 'Issue', url: 'https://api.github.com/repos/acme/repo/issues/1', title: 'Bug' },
            repository: { full_name: 'acme/repo' },
          }),
        ]),
        { status: 200, headers: { 'x-poll-interval': '60' } },
      ),
    )

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.hasChanges).toBe(false)
  })

  it('should return notificationsUnavailable: true on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
    } as Response)

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.notificationsUnavailable).toBe(true)
    expect(result.hasChanges).toBe(false)
    expect(result.pollIntervalSeconds).toBe(120)
  })

  it('should return notificationsUnavailable: true on 403', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers(),
    } as Response)

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.notificationsUnavailable).toBe(true)
    expect(result.hasChanges).toBe(false)
    expect(result.pollIntervalSeconds).toBe(120)
  })

  it('should return backed-off pollIntervalSeconds on 429, NOT notificationsUnavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '120' }),
    } as Response)

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.pollIntervalSeconds).toBeGreaterThanOrEqual(120)
    expect(result.notificationsUnavailable).toBeFalsy()
  })

  it('should parse X-Poll-Interval from response header', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'x-poll-interval': '90' },
      }),
    )

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.pollIntervalSeconds).toBe(90)
  })

  it('should default pollIntervalSeconds to 60 when X-Poll-Interval missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    )

    const result = await checkForNotificationChanges('my-token', 'acme')

    expect(result.pollIntervalSeconds).toBe(60)
  })
})
