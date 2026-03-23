export type PullRequest = {
  id: number
  number: number
  title: string
  repository: string
  repositoryUrl: string
  author: string
  authorAvatarUrl: string
  authorProfileUrl: string
  requestedReviewers: Array<{
    login: string
    avatarUrl: string
    profileUrl: string
  }>
  updatedAt: string
  updatedAtIso: string
  url: string
  checkState: 'success' | 'pending' | 'failure'
  stateLabel: string
  stateClass: string
  reason: string
  isDraft?: boolean
}

export type PullDetails = {
  id: number
  number: number
  title: string
  html_url: string
  updated_at: string
  draft?: boolean
  user: {
    login: string
    avatar_url: string
    html_url: string
  }
  requested_reviewers: Array<{
    login: string
    avatar_url: string
    html_url: string
  }>
  requested_teams: Array<{
    slug: string
  }>
  base: {
    repo: {
      full_name: string
      html_url: string
    }
  }
  head: {
    sha: string
  }
}

export type Review = {
  state: string
  submitted_at?: string
  user?: {
    login: string
  }
}

export type ClassifiedPullRequest = {
  needsAttention?: PullRequest
  relatedToYou?: PullRequest
}

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)))

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function prViewKey(repository: string, number: number): string {
  return `${repository}#${number}`
}

export function sortByUpdatedDesc(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort(
    (a, b) => new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime(),
  )
}

export function classifyPullRequest(
  pull: PullDetails,
  reviews: Review[],
  myLogin: string,
  myTeamSlugs: Set<string>,
  viewedAtMs?: number,
): ClassifiedPullRequest {
  const normalizedLogin = myLogin.toLowerCase()
  const myReviews = reviews
    .filter(
      (review) =>
        review.user?.login?.toLowerCase() === normalizedLogin && Boolean(review.submitted_at),
    )
    .sort(
      (a, b) =>
        new Date(b.submitted_at ?? 0).getTime() - new Date(a.submitted_at ?? 0).getTime(),
    )

  const lastReview = myReviews[0]
  const hasSubmittedReview = Boolean(lastReview)
  const pullUpdatedAtMs = new Date(pull.updated_at).getTime()
  const lastReviewAtMs = lastReview?.submitted_at
    ? new Date(lastReview.submitted_at).getTime()
    : undefined
  const requestedReviewerLogins = pull.requested_reviewers.map((reviewer) =>
    reviewer.login.toLowerCase(),
  )
  const requestedTeamSlugs = pull.requested_teams.map((team) => team.slug)

  const isRequiredReviewer = requestedReviewerLogins.includes(normalizedLogin)
  const hasUpdateSinceMyReview =
    lastReviewAtMs !== undefined && pullUpdatedAtMs > lastReviewAtMs
  const assignedToMyTeam = requestedTeamSlugs.some((teamSlug) => myTeamSlugs.has(teamSlug))
  const lookedWithoutReviewAndUpdated =
    viewedAtMs !== undefined && !hasSubmittedReview && pullUpdatedAtMs > viewedAtMs

  const basePr: Omit<PullRequest, 'stateLabel' | 'stateClass' | 'reason'> = {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    repository: pull.base.repo.full_name,
    repositoryUrl: pull.base.repo.html_url,
    author: pull.user.login,
    authorAvatarUrl: pull.user.avatar_url,
    authorProfileUrl: pull.user.html_url,
    requestedReviewers: pull.requested_reviewers.map((reviewer) => ({
      login: reviewer.login,
      avatarUrl: reviewer.avatar_url,
      profileUrl: reviewer.html_url,
    })),
    updatedAt: formatRelativeTime(pull.updated_at),
    updatedAtIso: pull.updated_at,
    url: pull.html_url,
    checkState: 'pending',
    isDraft: pull.draft,
  }

  if (isRequiredReviewer || hasUpdateSinceMyReview) {
    if (isRequiredReviewer && hasUpdateSinceMyReview) {
      return {
        needsAttention: {
          ...basePr,
          stateLabel: 'Required + updated',
          stateClass: 'required-and-updated',
          reason: 'You are requested and new updates landed since your last review.',
        },
      }
    }

    if (isRequiredReviewer) {
      return {
        needsAttention: {
          ...basePr,
          stateLabel: 'Required review',
          stateClass: 'required-review',
          reason: 'You are requested as a required reviewer.',
        },
      }
    }

    return {
      needsAttention: {
        ...basePr,
        stateLabel: 'Updated since review',
        stateClass: 'updated-since-review',
        reason: 'You already reviewed this PR and it changed afterward.',
      },
    }
  }

  if (assignedToMyTeam || lookedWithoutReviewAndUpdated) {
    if (assignedToMyTeam && lookedWithoutReviewAndUpdated) {
      return {
        relatedToYou: {
          ...basePr,
          stateLabel: 'Team + viewed update',
          stateClass: 'team-review',
          reason: 'Requested from your team, and updated after you looked without a review.',
        },
      }
    }

    if (assignedToMyTeam) {
      return {
        relatedToYou: {
          ...basePr,
          stateLabel: 'Team review',
          stateClass: 'team-review',
          reason: 'Requested from one of your teams.',
        },
      }
    }

    return {
      relatedToYou: {
        ...basePr,
        stateLabel: 'Viewed, then updated',
        stateClass: 'viewed-updated',
        reason: 'You looked at this PR without reviewing and it has new updates.',
      },
    }
  }

  return {}
}
