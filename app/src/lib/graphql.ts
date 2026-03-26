import { RateLimitError } from './github'

// Re-export RateLimitError for convenience
export { RateLimitError }

// ============================================================================
// GraphQL Response Types
// ============================================================================

export type GqlViewer = {
  login: string
  databaseId: number
  avatarUrl: string
  url: string
}

export type GqlTeamsResponse = {
  viewer: GqlViewer
  organization: {
    teams: {
      nodes: Array<{ slug: string }>
    }
  } | null
}

export type GqlPullRequestNode = {
  databaseId: number
  number: number
  title: string
  url: string
  state: string // 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  headRefOid: string
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
  reviews: {
    nodes: Array<{
      state: string
      submittedAt: string | null
      commit: { oid: string } | null
      author: { login: string } | null
    }>
  }
  comments: {
    nodes: Array<{
      createdAt: string
      author: { login: string } | null
    }>
  }
  commits: {
    nodes: Array<{
      commit: {
        oid: string
        statusCheckRollup: {
          state: string
          contexts: {
            nodes: Array<
              | {
                  __typename: 'StatusContext'
                  context: string
                  state: string
                  targetUrl: string | null
                  description: string | null
                }
              | { __typename: string }
            >
          }
        } | null
      }
    }>
  } | null
  baseRepository: {
    nameWithOwner: string
    url: string
  } | null
  additions: number
  deletions: number
  labels: {
    nodes: Array<{ name: string; color: string }>
  }
}

export type GqlSearchResponse<T> = {
  search: {
    issueCount: number
    pageInfo: {
      hasNextPage: boolean
      endCursor: string | null
    }
    nodes: Array<T | null>
  }
}

export type GqlMergedPullRequestNode = {
  databaseId: number
  number: number
  title: string
  url: string
  mergedAt: string | null
  author: {
    login: string
    avatarUrl: string
    url: string
  } | null
  baseRepository: {
    nameWithOwner: string
    url: string
  } | null
}

// ============================================================================
// GraphQL Query Constants
// ============================================================================

export const PR_DETAILS_FRAGMENT = `
  databaseId
  number
  title
  url
  state
  isDraft
  createdAt
  updatedAt
  mergedAt
  headRefOid
  author { login avatarUrl url }
  assignees(first: 10) {
    nodes { login avatarUrl url }
  }
  reviewRequests(first: 20) {
    nodes {
      requestedReviewer {
        __typename
        ... on User { login avatarUrl url }
        ... on Team { slug }
      }
    }
  }
  reviews(first: 50) {
    nodes {
      state
      submittedAt
      commit { oid }
      author { login }
    }
  }
  comments(first: 50) {
    nodes {
      createdAt
      author { login }
    }
  }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: 20) {
            nodes {
              __typename
              ... on StatusContext {
                context
                state
                targetUrl
                description
              }
            }
          }
        }
      }
    }
  }
  baseRepository {
    nameWithOwner
    url
  }
  additions
  deletions
  labels(first: 20) {
    nodes { name color }
  }
`

export const VIEWER_AND_TEAMS_QUERY = `
  query ViewerAndTeams($org: String!, $login: String!) {
    viewer {
      login
      databaseId
      avatarUrl
      url
    }
    organization(login: $org) {
      teams(first: 100, userLogins: [$login]) {
        nodes {
          slug
        }
      }
    }
  }
`

export const SEARCH_OPEN_PRS_QUERY = `
  query SearchOpenPRs($query: String!, $first: Int!, $after: String) {
    search(query: $query, type: ISSUE, first: $first, after: $after) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on PullRequest {
          ${PR_DETAILS_FRAGMENT}
        }
      }
    }
  }
`

export const SEARCH_MERGED_PRS_QUERY = `
  query SearchMergedPRs($query: String!, $first: Int!) {
    search(query: $query, type: ISSUE, first: $first) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on PullRequest {
          databaseId
          number
          title
          url
          mergedAt
          author { login avatarUrl url }
          baseRepository { nameWithOwner url }
        }
      }
    }
  }
`

// ============================================================================
// GraphQL Fetch Function
// ============================================================================

export async function graphqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<T> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query, variables }),
  })

  // Handle HTTP-level errors
  if (response.status === 401) {
    throw new Error('Invalid token. Check PAT scope and retry.')
  }

  if (response.status === 403 || response.status === 429) {
    throw new RateLimitError()
  }

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}).`)
  }

  // Parse response body
  const responseBody = (await response.json()) as {
    data?: T
    errors?: Array<{ message: string }>
  }

  // Handle GraphQL-level errors
  if (responseBody.errors && responseBody.errors.length > 0) {
    const errorMessage = responseBody.errors[0].message
    if (errorMessage.toLowerCase().includes('rate limit')) {
      throw new RateLimitError()
    }

    // If data is present alongside errors, treat as a partial success.
    // This is standard GraphQL behaviour: fields the token cannot access
    // (e.g. commits on fine-grained PATs) are nulled out with FORBIDDEN
    // errors while the rest of the response remains valid.
    if (!responseBody.data) {
      throw new Error(errorMessage)
    }
  }

  return responseBody.data as T
}
