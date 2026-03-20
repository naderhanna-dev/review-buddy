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
    user: { login: 'author' },
    requested_reviewers: [],
    requested_teams: [],
    base: { repo: { full_name: 'acme/review-radar' } },
    ...overrides,
  }
}

describe('classifyPullRequest', () => {
  it('marks PR as needs attention when user is requested reviewer', () => {
    const pull = createPull({
      requested_reviewers: [{ login: 'me' }],
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
