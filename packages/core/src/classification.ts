export type PolicyBotStatus = {
  state: 'success' | 'pending' | 'failure'
  url: string | null
  description: string | null
}

export type CheckStatus = {
  name: string
  state: 'success' | 'failure' | 'pending' | 'error'
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
  additions?: number
  deletions?: number
  labels?: Array<{ name: string; color: string }>
  checkStatuses?: CheckStatus[]
}

export type PullDetails = {
  databaseId: number
  number: number
  title: string
  url: string
  updatedAt: string
  createdAt: string
  state: string
  mergedAt: string | null
  isDraft: boolean
  author: {
    login: string
    avatarUrl: string
    url: string
  } | null
  assignees: {
    nodes: Array<{
      login: string
      avatarUrl: string
      url: string
    }>
  }
  reviewRequests: {
    nodes: Array<{
      requestedReviewer:
        | { __typename: 'User'; login: string; avatarUrl: string; url: string }
        | { __typename: 'Team'; slug: string }
        | null
    }>
  }
  baseRepository: {
    nameWithOwner: string
    url: string
  } | null
  headRefOid: string
  additions?: number
  deletions?: number
  labels?: { nodes: Array<{ name: string; color: string }> }
}

export type Review = {
  state: string
  submittedAt: string | null
  commit: { oid: string } | null
  author: { login: string } | null
}

export type PullComment = {
  createdAt: string
  author: { login: string } | null
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

export function sortByAuthor(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const aAuthor = a.author.toLowerCase()
    const bAuthor = b.author.toLowerCase()
    if (aAuthor === '' && bAuthor === '') return 0
    if (aAuthor === '') return 1
    if (bAuthor === '') return -1
    if (aAuthor !== bAuthor) return aAuthor.localeCompare(bAuthor)
    return new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
  })
}

export function sortByRepository(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const aRepo = a.repository.toLowerCase()
    const bRepo = b.repository.toLowerCase()
    if (aRepo === '' && bRepo === '') return 0
    if (aRepo === '') return 1
    if (bRepo === '') return -1
    if (aRepo !== bRepo) return aRepo.localeCompare(bRepo)
    return new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
  })
}

export function sortByLineChanges(prs: PullRequest[]): PullRequest[] {
  return [...prs].sort((a, b) => {
    const aUndefined = a.additions === undefined && a.deletions === undefined
    const bUndefined = b.additions === undefined && b.deletions === undefined
    if (aUndefined && bUndefined) return 0
    if (aUndefined) return 1
    if (bUndefined) return -1
    const aTotal = (a.additions ?? 0) + (a.deletions ?? 0)
    const bTotal = (b.additions ?? 0) + (b.deletions ?? 0)
    if (aTotal !== bTotal) return bTotal - aTotal
    return new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
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
        review.author?.login?.toLowerCase() === normalizedLogin && Boolean(review.submittedAt),
    )
    .sort(
      (a, b) =>
        new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime(),
    )

  const lastReview = myReviews[0]
  const hasSubmittedReview = Boolean(lastReview)
  const pullUpdatedAtMs = new Date(pull.updatedAt).getTime()
  const lastReviewAtMs = lastReview?.submittedAt
    ? new Date(lastReview.submittedAt).getTime()
    : undefined
  const requestedReviewerLogins = pull.reviewRequests.nodes.flatMap((node) =>
    node.requestedReviewer?.__typename === 'User'
      ? [node.requestedReviewer.login.toLowerCase()]
      : [],
  )
  const assigneeLogins = pull.assignees.nodes.map((assignee) => assignee.login.toLowerCase())
  const requestedTeamSlugs = pull.reviewRequests.nodes.flatMap((node) =>
    node.requestedReviewer?.__typename === 'Team' ? [node.requestedReviewer.slug] : [],
  )

  const isAuthoredByMe = (pull.author?.login ?? '').toLowerCase() === normalizedLogin
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
    id: pull.databaseId,
    number: pull.number,
    title: pull.title,
    repository: pull.baseRepository?.nameWithOwner ?? '',
    repositoryUrl: pull.baseRepository?.url ?? '',
    author: pull.author?.login ?? '',
    authorAvatarUrl: pull.author?.avatarUrl ?? '',
    authorProfileUrl: pull.author?.url ?? '',
    requestedReviewers: pull.reviewRequests.nodes.flatMap((node) => {
      const reviewer = node.requestedReviewer
      if (reviewer?.__typename !== 'User') return []
      return [
        {
          login: reviewer.login,
          avatarUrl: reviewer.avatarUrl,
          profileUrl: reviewer.url,
        },
      ]
    }),
    updatedAt: formatRelativeTime(pull.updatedAt),
    updatedAtIso: pull.updatedAt,
    createdAtIso: pull.createdAt,
    url: pull.url,
    checkState: 'pending',
    isDraft: pull.isDraft,
    additions: pull.additions,
    deletions: pull.deletions,
    labels: pull.labels?.nodes.map((l) => ({ name: l.name, color: l.color })),
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
