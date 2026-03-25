export type PolicyBotStatus = {
  state: 'success' | 'pending' | 'failure'
  url: string | null
  description: string | null
}

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
  createdAtIso: string
  url: string
  checkState: 'success' | 'pending' | 'failure'
  policyBotStatus?: PolicyBotStatus
  staleState?: 'auto' | 'manual'
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
  created_at: string
  state: 'open' | 'closed'
  merged_at: string | null
  draft?: boolean
  user: {
    login: string
    avatar_url: string
    html_url: string
  }
  assignees: Array<{
    login: string
    avatar_url: string
    html_url: string
  }>
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
  commit_id?: string
  submitted_at?: string
  user?: {
    login: string
  }
}

export type ReviewVerdict = 'APPROVED' | 'CHANGES_REQUESTED' | null

export type ActivitySignals = {
  hasNewCommitsSinceMyReview: boolean
  hasNewCommentsSinceMyReview: boolean
  hasNewReviewsSinceViewed: boolean
  hasNewCommentsSinceViewed: boolean
  latestReviewVerdict: ReviewVerdict
}

export type ClassifiedPullRequest = {
  yourPrs?: PullRequest
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

export function sortByCreatedAt(prs: PullRequest[], direction: 'asc' | 'desc'): PullRequest[] {
  return [...prs].sort((a, b) => {
    const aTime = new Date(a.createdAtIso).getTime()
    const bTime = new Date(b.createdAtIso).getTime()
    return direction === 'asc' ? aTime - bTime : bTime - aTime
  })
}

export function classifyPullRequest(
  pull: PullDetails,
  reviews: Review[],
  myLogin: string,
  myTeamSlugs: Set<string>,
  viewedAtMs?: number,
  activitySignals?: ActivitySignals,
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
  const assigneeLogins = pull.assignees.map((assignee) => assignee.login.toLowerCase())
  const requestedTeamSlugs = pull.requested_teams.map((team) => team.slug)

  const isAuthoredByMe = pull.user.login.toLowerCase() === normalizedLogin
  const isAssignedToMe = assigneeLogins.includes(normalizedLogin)
  const isRequiredReviewer = requestedReviewerLogins.includes(normalizedLogin)
  const hasUpdateSinceMyReview =
    lastReviewAtMs !== undefined && pullUpdatedAtMs > lastReviewAtMs
  const hasNewCommitsSinceMyReview =
    activitySignals?.hasNewCommitsSinceMyReview ?? hasUpdateSinceMyReview
  const hasNewCommentsSinceMyReview = activitySignals?.hasNewCommentsSinceMyReview ?? false
  const hasNewReviewsSinceViewed = activitySignals?.hasNewReviewsSinceViewed ?? false
  const hasNewCommentsSinceViewed = activitySignals?.hasNewCommentsSinceViewed ?? false
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
    createdAtIso: pull.created_at,
    url: pull.html_url,
    checkState: 'pending',
    isDraft: pull.draft,
  }

  if (isAuthoredByMe || isAssignedToMe) {
    if (hasNewReviewsSinceViewed) {
      return {
        yourPrs: {
          ...basePr,
          stateLabel: 'New reviews',
          stateClass: 'your-pr-new-reviews',
          reason: 'New reviews were submitted since you last viewed this PR.',
        },
      }
    }

    if (hasNewCommentsSinceViewed) {
      return {
        yourPrs: {
          ...basePr,
          stateLabel: 'New comments',
          stateClass: 'your-pr-new-comments',
          reason: 'New comments were added since you last viewed this PR.',
        },
      }
    }

    const verdict = activitySignals?.latestReviewVerdict ?? null
    const verdictLabel =
      verdict === 'APPROVED'
        ? 'Approved'
        : verdict === 'CHANGES_REQUESTED'
          ? 'Changes requested'
          : ''
    const verdictClass =
      verdict === 'APPROVED'
        ? 'your-pr-approved'
        : verdict === 'CHANGES_REQUESTED'
          ? 'your-pr-changes-requested'
          : 'your-pr-no-activity'

    if (isAuthoredByMe && isAssignedToMe) {
      return {
        yourPrs: {
          ...basePr,
          stateLabel: verdictLabel,
          stateClass: verdictClass,
          reason: 'This PR is authored by you and assigned to you.',
        },
      }
    }

    if (isAuthoredByMe) {
      return {
        yourPrs: {
          ...basePr,
          stateLabel: verdictLabel,
          stateClass: verdictClass,
          reason: 'This PR is authored by you.',
        },
      }
    }

    return {
      yourPrs: {
        ...basePr,
        stateLabel: verdictLabel,
        stateClass: verdictClass,
        reason: 'This PR is assigned to you.',
      },
    }
  }

  if (
    hasNewCommitsSinceMyReview ||
    hasNewCommentsSinceMyReview ||
    (isRequiredReviewer && !hasSubmittedReview)
  ) {
    if (hasNewCommitsSinceMyReview) {
      return {
        needsAttention: {
          ...basePr,
          stateLabel: 'New updates',
          stateClass: 'new-updates',
          reason: 'New commits were pushed after your last review.',
        },
      }
    }

    if (hasNewCommentsSinceMyReview) {
      return {
        needsAttention: {
          ...basePr,
          stateLabel: 'New comments',
          stateClass: 'new-comments',
          reason: 'New comments were added after your last review.',
        },
      }
    }

    return {
      needsAttention: {
        ...basePr,
        stateLabel: 'Review requested',
        stateClass: 'review-requested',
        reason: 'You are requested as a direct reviewer and have not reviewed yet.',
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
