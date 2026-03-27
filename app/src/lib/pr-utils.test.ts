import { describe, it, expect } from 'vitest'
import type { PullRequest } from './classification'
import { applySectionSort } from './pr-utils'

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
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
    createdAtIso: '',
    url: '',
    checkState: 'pending',
    stateLabel: '',
    stateClass: '',
    reason: '',
    ...overrides,
  }
}

describe('applySectionSort', () => {
  it('returns array unchanged for "default"', () => {
    const prs = [
      makePr({ author: 'Charlie' }),
      makePr({ author: 'Alice' }),
    ]
    const sorted = applySectionSort(prs, 'default')
    expect(sorted.map(pr => pr.author)).toEqual(['Charlie', 'Alice'])
  })

  it('sorts by createdAtIso ascending for "oldest-first"', () => {
    const prs = [
      makePr({ createdAtIso: '2026-03-20T00:00:00Z' }),
      makePr({ createdAtIso: '2026-03-10T00:00:00Z' }),
    ]
    const sorted = applySectionSort(prs, 'oldest-first')
    expect(sorted.map(pr => pr.createdAtIso)).toEqual([
      '2026-03-10T00:00:00Z',
      '2026-03-20T00:00:00Z',
    ])
  })

  it('sorts by createdAtIso descending for "newest-first"', () => {
    const prs = [
      makePr({ createdAtIso: '2026-03-10T00:00:00Z' }),
      makePr({ createdAtIso: '2026-03-20T00:00:00Z' }),
    ]
    const sorted = applySectionSort(prs, 'newest-first')
    expect(sorted.map(pr => pr.createdAtIso)).toEqual([
      '2026-03-20T00:00:00Z',
      '2026-03-10T00:00:00Z',
    ])
  })

  it('sorts by author A-Z for "author-az"', () => {
    const prs = [
      makePr({ author: 'Charlie' }),
      makePr({ author: 'Alice' }),
      makePr({ author: 'Bob' }),
    ]
    const sorted = applySectionSort(prs, 'author-az')
    expect(sorted.map(pr => pr.author)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('sorts by repository A-Z for "repo-az"', () => {
    const prs = [
      makePr({ repository: 'org/zoo' }),
      makePr({ repository: 'org/alpha' }),
      makePr({ repository: 'org/mid' }),
    ]
    const sorted = applySectionSort(prs, 'repo-az')
    expect(sorted.map(pr => pr.repository)).toEqual(['org/alpha', 'org/mid', 'org/zoo'])
  })

  it('sorts by total churn descending for "line-changes-desc"', () => {
    const prs = [
      makePr({ additions: 5, deletions: 5 }),
      makePr({ additions: 100, deletions: 50 }),
      makePr({ additions: 20, deletions: 10 }),
    ]
    const sorted = applySectionSort(prs, 'line-changes-desc')
    expect(sorted.map(pr => (pr.additions ?? 0) + (pr.deletions ?? 0))).toEqual([150, 30, 10])
  })
})
