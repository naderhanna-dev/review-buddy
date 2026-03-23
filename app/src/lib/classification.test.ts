import { describe, expect, it } from 'vitest'

import {
  classifyPullRequest,
  type PullDetails,
  type Review,
} from './classification'

function createPull(overrides: Partial<PullDetails> = {}): PullDetails {
  return {
    id: 1,
    number: 123,
    title: 'feat: improve review signal quality',
    html_url: 'https://github.com/acme/review-radar/pull/123',
    updated_at: '2026-03-20T11:00:00Z',
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

    const result = classifyPullRequest(pull, [], 'me', new Set())

    expect(result.yourPrs?.stateClass).toBe('your-pr')
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

    const result = classifyPullRequest(pull, [], 'me', new Set())

    expect(result.yourPrs?.stateClass).toBe('your-pr')
    expect(result.needsAttention).toBeUndefined()
  })

  it('marks PR as needs attention when user is requested reviewer', () => {
    const pull = createPull({
      requested_reviewers: [
        {
          login: 'me',
          avatar_url: 'https://avatars.githubusercontent.com/u/300?v=4',
          html_url: 'https://github.com/me',
        },
      ],
    })

    const result = classifyPullRequest(pull, [], 'me', new Set())

    expect(result.needsAttention?.stateClass).toBe('required-review')
    expect(result.relatedToYou).toBeUndefined()
  })

  it('marks PR as needs attention when updated since user review', () => {
    const pull = createPull({ updated_at: '2026-03-20T12:00:00Z' })
    const reviews: Review[] = [
      {
        state: 'APPROVED',
        submitted_at: '2026-03-20T10:00:00Z',
        user: { login: 'me' },
      },
    ]

    const result = classifyPullRequest(pull, reviews, 'me', new Set())

    expect(result.needsAttention?.stateClass).toBe('updated-since-review')
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

    const result = classifyPullRequest(pull, [], 'me', new Set(['reviewers-platform']))

    expect(result.relatedToYou?.authorProfileUrl).toBe('https://github.com/author')
    expect(result.relatedToYou?.repositoryUrl).toBe('https://github.com/acme/review-radar')
    expect(result.relatedToYou?.requestedReviewers[0]?.profileUrl).toBe(
      'https://github.com/reviewer-1',
    )
  })

  it('skips team signal when user has no readable team membership', () => {
    const pull = createPull({ requested_teams: [{ slug: 'reviewers-platform' }] })

    const result = classifyPullRequest(pull, [], 'me', new Set())

    expect(result.relatedToYou).toBeUndefined()
    expect(result.needsAttention).toBeUndefined()
  })

  it('marks PR as related when viewed without review and updated since', () => {
    const pull = createPull({ updated_at: '2026-03-20T12:00:00Z' })

    const result = classifyPullRequest(
      pull,
      [],
      'me',
      new Set(),
      new Date('2026-03-20T11:00:00Z').getTime(),
    )

    expect(result.relatedToYou?.stateClass).toBe('viewed-updated')
    expect(result.needsAttention).toBeUndefined()
  })
})
