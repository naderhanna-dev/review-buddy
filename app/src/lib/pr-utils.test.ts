import { describe, it, expect } from 'vitest'
import type { PullRequest } from './classification'
import { EMPTY_FILTER_STATE } from '../types'
import { applySectionFilter, applySectionSort } from './pr-utils'

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

describe('applySectionFilter', () => {
  it('should return all PRs unchanged for empty filter', () => {
    const prs = [
      makePr({ id: 1, repository: 'org/foo', checkState: 'success', author: 'alice' }),
      makePr({ id: 2, repository: 'org/bar', checkState: 'failure', author: 'bob' }),
    ]

    const filtered = applySectionFilter(prs, EMPTY_FILTER_STATE)

    expect(filtered).toBe(prs)
  })

  it('should return only PRs from matching repositories', () => {
    const prs = [
      makePr({ id: 1, repository: 'org/foo' }),
      makePr({ id: 2, repository: 'org/bar' }),
      makePr({ id: 3, repository: 'org/foo' }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      repository: new Set(['org/foo']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1, 3])
  })

  it('should return only passing PRs for checkStatus=success', () => {
    const prs = [
      makePr({ id: 1, checkState: 'success' }),
      makePr({ id: 2, checkState: 'pending' }),
      makePr({ id: 3, checkState: 'failure' }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      checkStatus: new Set(['success']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1])
  })

  it('should return only failing PRs for checkStatus=failure', () => {
    const prs = [
      makePr({ id: 1, checkState: 'success' }),
      makePr({ id: 2, checkState: 'failure' }),
      makePr({ id: 3, checkState: 'pending' }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      checkStatus: new Set(['failure']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([2])
  })

  it('should match a PR when any label is in filter set', () => {
    const prs = [
      makePr({
        id: 1,
        labels: [
          { name: 'bug', color: 'f00' },
          { name: 'urgent', color: '0f0' },
        ],
      }),
      makePr({
        id: 2,
        labels: [{ name: 'enhancement', color: '00f' }],
      }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      labels: new Set(['bug']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1])
  })

  it('should exclude PRs with undefined labels when label filter is active', () => {
    const prs = [
      makePr({ id: 1, labels: [{ name: 'bug', color: 'f00' }] }),
      makePr({ id: 2, labels: undefined }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      labels: new Set(['bug']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1])
  })

  it('should exclude PRs with empty labels when label filter is active', () => {
    const prs = [
      makePr({ id: 1, labels: [{ name: 'bug', color: 'f00' }] }),
      makePr({ id: 2, labels: [] }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      labels: new Set(['bug']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1])
  })

  it('should return only PRs from matching authors', () => {
    const prs = [
      makePr({ id: 1, author: 'alice' }),
      makePr({ id: 2, author: 'bob' }),
      makePr({ id: 3, author: 'alice' }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      author: new Set(['alice']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1, 3])
  })

  it('should apply AND semantics across repository and checkStatus filters', () => {
    const prs = [
      makePr({ id: 1, repository: 'org/foo', checkState: 'success' }),
      makePr({ id: 2, repository: 'org/foo', checkState: 'failure' }),
      makePr({ id: 3, repository: 'org/bar', checkState: 'success' }),
    ]

    const filtered = applySectionFilter(prs, {
      ...EMPTY_FILTER_STATE,
      repository: new Set(['org/foo']),
      checkStatus: new Set(['success']),
    })

    expect(filtered.map((pr) => pr.id)).toEqual([1])
  })
})
