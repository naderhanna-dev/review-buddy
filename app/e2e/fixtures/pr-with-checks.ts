import type { PullRequest } from '../../src/lib/classification'

export type CheckStatus = {
  name: string
  state: 'success' | 'failure' | 'pending'
  url: string | null
  description: string | null
}

export type PullRequestWithChecks = PullRequest & {
  checkStatuses: CheckStatus[]
}

export const prWithChecks: PullRequestWithChecks = {
  id: 1001,
  number: 42,
  title: 'feat: add expandable check status panel',
  repository: 'testorg/frontend',
  repositoryUrl: 'https://github.com/testorg/frontend',
  author: 'octocat',
  authorAvatarUrl: 'https://avatars.githubusercontent.com/u/583231',
  authorProfileUrl: 'https://github.com/octocat',
  requestedReviewers: [],
  updatedAt: '2h ago',
  updatedAtIso: '2026-03-29T10:00:00Z',
  createdAtIso: '2026-03-29T09:00:00Z',
  url: 'https://github.com/testorg/frontend/pull/42',
  checkState: 'failure',
  stateLabel: 'Review requested',
  stateClass: 'review-requested',
  reason: 'You are requested as a direct reviewer and have not reviewed yet.',
  checkStatuses: [
    { name: 'build / lint', state: 'failure', url: 'https://example.com/1', description: 'ESLint failed' },
    { name: 'build / test', state: 'failure', url: 'https://example.com/2', description: '3 tests failed' },
    { name: 'deploy / preview', state: 'pending', url: null, description: null },
  ],
}
