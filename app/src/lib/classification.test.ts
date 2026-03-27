import { describe, expect, it } from 'vitest'

import {
  type ActivitySignals,
  classifyPullRequest,
  type PullDetails,
  type PullRequest,
  type Review,
  sortByCreatedAt,
  sortByAuthor,
  sortByRepository,
  sortByLineChanges,
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
    databaseId: 1,
    number: 123,
    title: 'feat: improve review signal quality',
    url: 'https://github.com/acme/review-radar/pull/123',
    updatedAt: '2026-03-20T11:00:00Z',
    createdAt: '2026-03-15T10:00:00Z',
    state: 'OPEN',
    mergedAt: null,
    isDraft: false,
    author: {
      login: 'author',
      avatarUrl: 'https://avatars.githubusercontent.com/u/100?v=4',
      url: 'https://github.com/author',
    },
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    baseRepository: {
      nameWithOwner: 'acme/review-radar',
      url: 'https://github.com/acme/review-radar',
    },
    headRefOid: 'abc123def456',
    ...overrides,
  }
}

describe('classifyPullRequest', () => {
  it('routes authored PRs to yourPrs before urgent buckets', () => {
    const pull = createPull({
      author: {
        login: 'me',
        avatarUrl: 'https://avatars.githubusercontent.com/u/300?v=4',
        url: 'https://github.com/me',
      },
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'User',
              login: 'me',
              avatarUrl: 'https://avatars.githubusercontent.com/u/300?v=4',
              url: 'https://github.com/me',
            },
          },
        ],
      },
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs?.stateClass).toBe('your-pr-no-activity')
    expect(result.yourPrs?.stateLabel).toBe('')
    expect(result.needsAttention).toBeUndefined()
  })

  it('routes assigned PRs to yourPrs before urgent buckets', () => {
    const pull = createPull({
      assignees: {
        nodes: [
          {
            login: 'me',
            avatarUrl: 'https://avatars.githubusercontent.com/u/300?v=4',
            url: 'https://github.com/me',
          },
        ],
      },
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'User',
              login: 'me',
              avatarUrl: 'https://avatars.githubusercontent.com/u/300?v=4',
              url: 'https://github.com/me',
            },
          },
        ],
      },
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs?.stateClass).toBe('your-pr-no-activity')
    expect(result.needsAttention).toBeUndefined()
  })

  it('shows New reviews on your PRs before other statuses', () => {
    const pull = createPull({ author: { login: 'me', avatarUrl: 'x', url: 'y' } })

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
      assignees: { nodes: [{ login: 'me', avatarUrl: 'x', url: 'y' }] },
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
      author: { login: 'me', avatarUrl: 'x', url: 'y' },
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
      author: { login: 'me', avatarUrl: 'x', url: 'y' },
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
      author: { login: 'me', avatarUrl: 'x', url: 'y' },
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
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'User',
              login: 'me',
              avatarUrl: 'https://avatars.githubusercontent.com/u/300?v=4',
              url: 'https://github.com/me',
            },
          },
        ],
      },
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
        commit: { oid: 'abc123def456' },
        submittedAt: '2026-03-20T10:00:00Z',
        author: { login: 'me' },
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
        submittedAt: '2026-03-20T10:00:00Z',
        commit: null,
        author: { login: 'me' },
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
    const pull = createPull({
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'Team',
              slug: 'reviewers-platform',
            },
          },
        ],
      },
    })

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
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'Team',
              slug: 'reviewers-platform',
            },
          },
          {
            requestedReviewer: {
              __typename: 'User',
              login: 'reviewer-1',
              avatarUrl: 'https://avatars.githubusercontent.com/u/201?v=4',
              url: 'https://github.com/reviewer-1',
            },
          },
        ],
      },
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
    const pull = createPull({
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: 'Team',
              slug: 'reviewers-platform',
            },
          },
        ],
      },
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.relatedToYou).toBeUndefined()
    expect(result.needsAttention).toBeUndefined()
  })

  it('marks PR as related when viewed without review and updated since', () => {
    const pull = createPull({ updatedAt: '2026-03-20T12:00:00Z' })

    const result = classifyPullRequest(pull, [], 'me', new Set(), new Date('2026-03-20T11:00:00Z').getTime(), noActivity)

    expect(result.relatedToYou?.stateClass).toBe('viewed-updated')
    expect(result.needsAttention).toBeUndefined()
  })

  it('includes createdAtIso from pull created_at', () => {
    const pull = createPull({
      createdAt: '2026-03-10T08:00:00Z',
      author: { login: 'me', avatarUrl: 'x', url: 'y' },
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs?.createdAtIso).toBe('2026-03-10T08:00:00Z')
  })

  it('classifies a merged PR the same as an open one (state guard lives in caller)', () => {
    const pull = createPull({
      state: 'CLOSED',
      mergedAt: '2026-03-21T12:00:00Z',
      author: { login: 'me', avatarUrl: 'x', url: 'y' },
    })

    const result = classifyPullRequest(pull, [], 'me', new Set(), undefined, noActivity)

    expect(result.yourPrs).toBeDefined()
    expect(result.yourPrs?.stateClass).toBe('your-pr-no-activity')
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

describe('sortByAuthor', () => {
  function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
      id: 1, number: 1, title: '', repository: '', repositoryUrl: '',
      author: '', authorAvatarUrl: '', authorProfileUrl: '',
      requestedReviewers: [], updatedAt: '', updatedAtIso: '',
      createdAtIso: '', url: '', checkState: 'pending',
      stateLabel: '', stateClass: '', reason: '',
      ...overrides,
    }
  }

  it('sorts authors alphabetically A-Z', () => {
    const prs = [
      makePr({ author: 'Charlie' }),
      makePr({ author: 'Alice' }),
      makePr({ author: 'Bob' }),
    ]
    const sorted = sortByAuthor(prs)
    expect(sorted.map(pr => pr.author)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('sorts case-insensitively', () => {
    const prs = [
      makePr({ author: 'charlie' }),
      makePr({ author: 'Alice' }),
      makePr({ author: 'BOB' }),
    ]
    const sorted = sortByAuthor(prs)
    expect(sorted.map(pr => pr.author)).toEqual(['Alice', 'BOB', 'charlie'])
  })

  it('sorts empty-string authors to end', () => {
    const prs = [
      makePr({ author: '' }),
      makePr({ author: 'Alice' }),
      makePr({ author: 'Bob' }),
    ]
    const sorted = sortByAuthor(prs)
    expect(sorted.map(pr => pr.author)).toEqual(['Alice', 'Bob', ''])
  })

  it('tie-breaks by updatedAtIso descending', () => {
    const prs = [
      makePr({ author: 'Alice', updatedAtIso: '2026-03-10T00:00:00Z' }),
      makePr({ author: 'Alice', updatedAtIso: '2026-03-20T00:00:00Z' }),
    ]
    const sorted = sortByAuthor(prs)
    expect(sorted.map(pr => pr.updatedAtIso)).toEqual([
      '2026-03-20T00:00:00Z',
      '2026-03-10T00:00:00Z',
    ])
  })

  it('does not mutate the original array', () => {
    const prs = [makePr({ author: 'Bob' }), makePr({ author: 'Alice' })]
    const sorted = sortByAuthor(prs)
    expect(sorted).not.toBe(prs)
    expect(prs[0].author).toBe('Bob')
  })
})

describe('sortByRepository', () => {
  function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
      id: 1, number: 1, title: '', repository: '', repositoryUrl: '',
      author: '', authorAvatarUrl: '', authorProfileUrl: '',
      requestedReviewers: [], updatedAt: '', updatedAtIso: '',
      createdAtIso: '', url: '', checkState: 'pending',
      stateLabel: '', stateClass: '', reason: '',
      ...overrides,
    }
  }

  it('sorts repositories alphabetically A-Z', () => {
    const prs = [
      makePr({ repository: 'org/zoo' }),
      makePr({ repository: 'org/alpha' }),
      makePr({ repository: 'org/mid' }),
    ]
    const sorted = sortByRepository(prs)
    expect(sorted.map(pr => pr.repository)).toEqual(['org/alpha', 'org/mid', 'org/zoo'])
  })

  it('sorts case-insensitively', () => {
    const prs = [
      makePr({ repository: 'org/Zoo' }),
      makePr({ repository: 'org/alpha' }),
      makePr({ repository: 'org/MID' }),
    ]
    const sorted = sortByRepository(prs)
    expect(sorted.map(pr => pr.repository)).toEqual(['org/alpha', 'org/MID', 'org/Zoo'])
  })

  it('sorts empty-string repository to end', () => {
    const prs = [
      makePr({ repository: '' }),
      makePr({ repository: 'org/alpha' }),
    ]
    const sorted = sortByRepository(prs)
    expect(sorted.map(pr => pr.repository)).toEqual(['org/alpha', ''])
  })

  it('tie-breaks by updatedAtIso descending', () => {
    const prs = [
      makePr({ repository: 'org/alpha', updatedAtIso: '2026-03-10T00:00:00Z' }),
      makePr({ repository: 'org/alpha', updatedAtIso: '2026-03-20T00:00:00Z' }),
    ]
    const sorted = sortByRepository(prs)
    expect(sorted.map(pr => pr.updatedAtIso)).toEqual([
      '2026-03-20T00:00:00Z',
      '2026-03-10T00:00:00Z',
    ])
  })

  it('does not mutate the original array', () => {
    const prs = [makePr({ repository: 'org/zoo' }), makePr({ repository: 'org/alpha' })]
    const sorted = sortByRepository(prs)
    expect(sorted).not.toBe(prs)
    expect(prs[0].repository).toBe('org/zoo')
  })
})

describe('sortByLineChanges', () => {
  function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
      id: 1, number: 1, title: '', repository: '', repositoryUrl: '',
      author: '', authorAvatarUrl: '', authorProfileUrl: '',
      requestedReviewers: [], updatedAt: '', updatedAtIso: '',
      createdAtIso: '', url: '', checkState: 'pending',
      stateLabel: '', stateClass: '', reason: '',
      ...overrides,
    }
  }

  it('sorts by total churn descending (largest first)', () => {
    const prs = [
      makePr({ additions: 5, deletions: 5 }),
      makePr({ additions: 100, deletions: 50 }),
      makePr({ additions: 20, deletions: 10 }),
    ]
    const sorted = sortByLineChanges(prs)
    expect(sorted.map(pr => (pr.additions ?? 0) + (pr.deletions ?? 0))).toEqual([150, 30, 10])
  })

  it('sorts PRs with both additions and deletions undefined to end', () => {
    const prs = [
      makePr({ additions: undefined, deletions: undefined }),
      makePr({ additions: 10, deletions: 5 }),
    ]
    const sorted = sortByLineChanges(prs)
    expect(sorted[0].additions).toBe(10)
    expect(sorted[1].additions).toBeUndefined()
  })

  it('counts PRs with only one field defined', () => {
    const prs = [
      makePr({ additions: 10, deletions: undefined }),
      makePr({ additions: 5, deletions: 20 }),
    ]
    const sorted = sortByLineChanges(prs)
    expect(sorted.map(pr => (pr.additions ?? 0) + (pr.deletions ?? 0))).toEqual([25, 10])
  })

  it('tie-breaks by updatedAtIso descending', () => {
    const prs = [
      makePr({ additions: 10, deletions: 5, updatedAtIso: '2026-03-10T00:00:00Z' }),
      makePr({ additions: 10, deletions: 5, updatedAtIso: '2026-03-20T00:00:00Z' }),
    ]
    const sorted = sortByLineChanges(prs)
    expect(sorted.map(pr => pr.updatedAtIso)).toEqual([
      '2026-03-20T00:00:00Z',
      '2026-03-10T00:00:00Z',
    ])
  })

  it('does not mutate the original array', () => {
    const prs = [
      makePr({ additions: 5, deletions: 5 }),
      makePr({ additions: 100, deletions: 50 }),
    ]
    const sorted = sortByLineChanges(prs)
    expect(sorted).not.toBe(prs)
    expect(prs[0].additions).toBe(5)
  })
})
