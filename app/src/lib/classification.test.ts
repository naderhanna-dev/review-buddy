import { describe, expect, it } from 'vitest'

import {
  type ActivitySignals,
  classifyPullRequest,
  type PullDetails,
  type PullRequest,
  type Review,
  sortByCreatedAt,
} from './classification'

const noActivity: ActivitySignals = {
  hasNewCommitsSinceMyReview: false,
  hasNewCommentsSinceMyReview: false,
  hasNewReviewsSinceViewed: false,
  hasNewCommentsSinceViewed: false,
  latestReviewVerdict: null,
}

function createPull(overrides: Partial<PullDetails> = {}): PullDetails {
  return {
    id: 1,
    number: 123,
    title: 'feat: improve review signal quality',
    html_url: 'https://github.com/acme/review-radar/pull/123',
    updated_at: '2026-03-20T11:00:00Z',
    created_at: '2026-03-15T10:00:00Z',
    state: 'open',
    merged_at: null,
    user: {
      login: 'author',
      avatar_url: 'https://avatars.githubusercontent.com/u/100?v=4',
      html_url: 'https://github.com/author',
    },
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
    base: {
      repo: {
        full_name: 'acme/review-radar',
        html_url: 'https://github.com/acme/review-radar',
      },
    },
    head: {
      sha: 'abc123def456',
    },
    ...overrides,
  }
}

describe('classifyPullRequest', () => {
  it('routes authored PRs to yourPrs before urgent buckets', () => {
    const pull = createPull({
      user: {
        login: 'me',
        avatar_url: 'https://avatars.githubusercontent.com/u/300?v=4',
        html_url: 'https://github.com/me',
      },
      requested_reviewers: [
        {
          login: 'me',
          avatar_url: 'https://avatars.githubusercontent.com/u/300?v=4',
          html_url: 'https://github.com/me',
        },
      ],
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs?.stateClass).toBe('your-pr-no-activity')
    expect(result.yourPrs?.stateLabel).toBe('')
    expect(result.needsAttention).toBeUndefined()
  })

  it('routes assigned PRs to yourPrs before urgent buckets', () => {
    const pull = createPull({
      assignees: [
        {
          login: 'me',
          avatar_url: 'https://avatars.githubusercontent.com/u/300?v=4',
          html_url: 'https://github.com/me',
        },
      ],
      requested_reviewers: [
        {
          login: 'me',
          avatar_url: 'https://avatars.githubusercontent.com/u/300?v=4',
          html_url: 'https://github.com/me',
        },
      ],
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs?.stateClass).toBe('your-pr-no-activity')
    expect(result.needsAttention).toBeUndefined()
  })

  it('shows New reviews on your PRs before other statuses', () => {
    const pull = createPull({ user: { login: 'me', avatar_url: 'x', html_url: 'y' } })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(),
      new Date('2026-03-20T10:00:00Z').getTime(),
      {
        ...noActivity,
        hasNewReviewsSinceViewed: true,
        hasNewCommentsSinceViewed: true,
      },
    )

    expect(result.yourPrs?.stateLabel).toBe('New reviews')
    expect(result.yourPrs?.stateClass).toBe('your-pr-new-reviews')
  })

  it('shows New comments on your PRs when no new reviews exist', () => {
    const pull = createPull({
      assignees: [{ login: 'me', avatar_url: 'x', html_url: 'y' }],
    })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(),
      new Date('2026-03-20T10:00:00Z').getTime(),
      {
        ...noActivity,
        hasNewCommentsSinceViewed: true,
      },
    )

    expect(result.yourPrs?.stateLabel).toBe('New comments')
    expect(result.yourPrs?.stateClass).toBe('your-pr-new-comments')
  })

  it('shows Approved verdict on authored PR when latest non-self review is APPROVED', () => {
    const pull = createPull({
      user: { login: 'me', avatar_url: 'x', html_url: 'y' },
    })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(),
      new Date('2026-03-20T10:00:00Z').getTime(),
      { ...noActivity, latestReviewVerdict: 'APPROVED' },
    )

    expect(result.yourPrs?.stateLabel).toBe('Approved')
    expect(result.yourPrs?.stateClass).toBe('your-pr-approved')
  })

  it('shows Changes requested verdict on authored PR', () => {
    const pull = createPull({
      user: { login: 'me', avatar_url: 'x', html_url: 'y' },
    })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(),
      new Date('2026-03-20T10:00:00Z').getTime(),
      { ...noActivity, latestReviewVerdict: 'CHANGES_REQUESTED' },
    )

    expect(result.yourPrs?.stateLabel).toBe('Changes requested')
    expect(result.yourPrs?.stateClass).toBe('your-pr-changes-requested')
  })

  it('prioritizes New reviews over review verdict', () => {
    const pull = createPull({
      user: { login: 'me', avatar_url: 'x', html_url: 'y' },
    })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(),
      new Date('2026-03-20T10:00:00Z').getTime(),
      { ...noActivity, hasNewReviewsSinceViewed: true, latestReviewVerdict: 'APPROVED' },
    )

    expect(result.yourPrs?.stateLabel).toBe('New reviews')
    expect(result.yourPrs?.stateClass).toBe('your-pr-new-reviews')
  })

  it('marks PR as needs attention when user is requested reviewer and unreviewed', () => {
    const pull = createPull({
      requested_reviewers: [
        {
          login: 'me',
          avatar_url: 'https://avatars.githubusercontent.com/u/300?v=4',
          html_url: 'https://github.com/me',
        },
      ],
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.needsAttention?.stateClass).toBe('review-requested')
    expect(result.relatedToYou).toBeUndefined()
  })

  it('marks PR as needs attention with New updates for commit changes', () => {
    const pull = createPull()
    const reviews: Review[] = [
      {
        state: 'APPROVED',
        commit_id: 'abc123def456',
        submitted_at: '2026-03-20T10:00:00Z',
        user: { login: 'me' },
      },
    ]

    const result = classifyPullRequest(pull, reviews, 'me', new Set(), undefined, {
      ...noActivity,
      hasNewCommitsSinceMyReview: true,
    })

    expect(result.needsAttention?.stateClass).toBe('new-updates')
    expect(result.needsAttention?.stateLabel).toBe('New updates')
    expect(result.relatedToYou).toBeUndefined()
  })

  it('marks PR as needs attention with New comments when only comments changed', () => {
    const pull = createPull()
    const reviews: Review[] = [
      {
        state: 'APPROVED',
        submitted_at: '2026-03-20T10:00:00Z',
        user: { login: 'me' },
      },
    ]

    const result = classifyPullRequest(pull, reviews, 'me', new Set(), undefined, {
      ...noActivity,
      hasNewCommentsSinceMyReview: true,
    })

    expect(result.needsAttention?.stateClass).toBe('new-comments')
    expect(result.needsAttention?.stateLabel).toBe('New comments')
    expect(result.relatedToYou).toBeUndefined()
  })

  it('marks PR as related when requested team matches user team', () => {
    const pull = createPull({ requested_teams: [{ slug: 'reviewers-platform' }] })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(['reviewers-platform']),
    )

    expect(result.relatedToYou?.stateClass).toBe('team-review')
    expect(result.needsAttention).toBeUndefined()
  })

  it('maps author and reviewer profile metadata for UI links', () => {
    const pull = createPull({
      requested_teams: [{ slug: 'reviewers-platform' }],
      requested_reviewers: [
        {
          login: 'reviewer-1',
          avatar_url: 'https://avatars.githubusercontent.com/u/201?v=4',
          html_url: 'https://github.com/reviewer-1',
        },
      ],
    })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(['reviewers-platform']),
      undefined,
      noActivity,
    )

    expect(result.relatedToYou?.authorProfileUrl).toBe('https://github.com/author')
    expect(result.relatedToYou?.repositoryUrl).toBe('https://github.com/acme/review-radar')
    expect(result.relatedToYou?.requestedReviewers[0]?.profileUrl).toBe(
      'https://github.com/reviewer-1',
    )
  })

  it('skips team signal when user has no readable team membership', () => {
    const pull = createPull({ requested_teams: [{ slug: 'reviewers-platform' }] })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.relatedToYou).toBeUndefined()
    expect(result.needsAttention).toBeUndefined()
  })

  it('marks PR as related when viewed without review and updated since', () => {
    const pull = createPull({ updated_at: '2026-03-20T12:00:00Z' })

    const result = classifyPullRequest(pull, [], 'me', new Set(), new Date('2026-03-20T11:00:00Z').getTime(), noActivity)

    expect(result.relatedToYou?.stateClass).toBe('viewed-updated')
    expect(result.needsAttention).toBeUndefined()
  })

  it('includes createdAtIso from pull created_at', () => {
    const pull = createPull({
      created_at: '2026-03-10T08:00:00Z',
      user: { login: 'me', avatar_url: 'x', html_url: 'y' },
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs?.createdAtIso).toBe('2026-03-10T08:00:00Z')
  })
})

describe('sortByCreatedAt', () => {
  function makePr(createdAtIso: string): PullRequest {
    return {
      id: 1,
      number: 1,
      title: '',
      repository: '',
      repositoryUrl: '',
      author: '',
      authorAvatarUrl: '',
      authorProfileUrl: '',
      requestedReviewers: [],
      updatedAt: '',
      updatedAtIso: '',
      createdAtIso,
      url: '',
      checkState: 'pending',
      stateLabel: '',
      stateClass: '',
      reason: '',
    }
  }

  it('sorts ascending (oldest first)', () => {
    const prs = [
      makePr('2026-03-20T00:00:00Z'),
      makePr('2026-03-10T00:00:00Z'),
      makePr('2026-03-15T00:00:00Z'),
    ]

    const sorted = sortByCreatedAt(prs, 'asc')

    expect(sorted.map((pr) => pr.createdAtIso)).toEqual([
      '2026-03-10T00:00:00Z',
      '2026-03-15T00:00:00Z',
      '2026-03-20T00:00:00Z',
    ])
  })

  it('sorts descending (newest first)', () => {
    const prs = [
      makePr('2026-03-10T00:00:00Z'),
      makePr('2026-03-20T00:00:00Z'),
      makePr('2026-03-15T00:00:00Z'),
    ]

    const sorted = sortByCreatedAt(prs, 'desc')

    expect(sorted.map((pr) => pr.createdAtIso)).toEqual([
      '2026-03-20T00:00:00Z',
      '2026-03-15T00:00:00Z',
      '2026-03-10T00:00:00Z',
    ])
  })

  it('does not mutate the original array', () => {
    const prs = [
      makePr('2026-03-20T00:00:00Z'),
      makePr('2026-03-10T00:00:00Z'),
    ]

    const sorted = sortByCreatedAt(prs, 'asc')

    expect(sorted).not.toBe(prs)
    expect(prs[0].createdAtIso).toBe('2026-03-20T00:00:00Z')
  })
})
