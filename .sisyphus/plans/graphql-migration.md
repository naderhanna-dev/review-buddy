# GraphQL Migration Plan

## Goal

Migrate ReviewRadar from GitHub REST API to GraphQL to dramatically reduce API call count per refresh cycle.

---

## Current State: REST API Call Audit

### Per full refresh (N open candidate PRs, M recently merged PRs)

| # | Endpoint | Count |
|---|----------|-------|
| 1 | `GET /user` | 2 (called in both fetch functions) |
| 2 | `GET /user/teams?per_page=100` | 1 |
| 3 | `GET /search/issues` (open: review-requested, reviewed-by, author, assignee) | 4 |
| 4 | `GET /search/issues` (open: per team slug) | 1 per team |
| 5 | `GET /repos/{repo}/pulls/{number}` | N (one per candidate PR) |
| 6 | `GET {pullUrl}/reviews?per_page=100` | N |
| 7 | `GET {pullUrl}/comments?per_page=100` | N |
| 8 | `GET /repos/{repo}/commits/{sha}/status` | N |
| 9 | `GET /search/issues` (merged: author + reviewed-by) | 2 |
| 10 | `GET /repos/{repo}/pulls/{number}` (merged) | M |

**Total: ~9 + 4N + M calls per refresh**
For a typical user (50 open PRs, 5 merged): **~214 REST calls per refresh**

### What stays REST (no GraphQL equivalent)
- `GET /notifications` — GitHub's Notifications API is REST-only. The `If-Modified-Since` / `x-poll-interval` polling mechanism has no GraphQL counterpart. **Do not migrate.**

---

## Target State: GraphQL

| # | Query | Replaces |
|---|-------|----------|
| 1 | `viewer + organization.teams` | REST calls #1 + #2 |
| 2 | GraphQL `search` (open PRs, with nested reviews/comments/status) | REST calls #3 + #4 + #5 + #6 + #7 + #8 |
| 3 | GraphQL `repository.pullRequest` aliases (for locally-viewed PRs not in search) | REST call #5 variant |
| 4 | GraphQL `search` (merged PRs, with nested details) | REST calls #9 + #10 |

**Total: ~4 GraphQL queries per refresh (98% reduction)**

---

## Architecture Decisions

### 1. No external GraphQL library
Keep the same pattern as the existing `apiFetch()` — use native `fetch()` with a `graphqlFetch<T>()` wrapper. No Apollo, no urql. Keeps the bundle lean.

### 2. Caching strategy change
- REST uses HTTP ETags (GET requests) → `etag-cache.ts` handles this
- GraphQL uses POST → HTTP ETags do not apply to POST requests
- **Solution**: The existing `pr-cache.ts` TTL-based caching (5-min revalidation, 60-min max age) already handles this correctly. No changes needed to the caching layer.
- `etag-cache.ts` is kept exclusively for the notifications REST endpoint.

### 3. Pagination: page numbers → cursors
REST uses `?page=N`. GraphQL uses cursor-based pagination (`after: $cursor`, `pageInfo.endCursor`). The pagination loop in `searchPullRequestUrls()` must be rewritten.

### 4. Error handling: HTTP status → response body
GraphQL always returns HTTP 200. Errors appear in `response.errors[]`. The `graphqlFetch()` wrapper must inspect the response body for errors and map them to the same error types (`RateLimitError`, etc.) that the rest of the app already handles.

### 5. Policy bot status
The current code finds policy-bot via `CombinedStatusResponse.statuses` (legacy commit statuses). In GraphQL, `statusCheckRollup.contexts` returns both `StatusContext` (legacy) and `CheckRun` (Actions) nodes via inline fragments. Policy-bot uses legacy statuses, so we target `StatusContext` nodes where `context` starts with `"policy-bot"`.

### 6. Viewer + teams in one query
The `organization.teams(userLogins: [$login])` filter requires the viewer's login as a variable. Since we fetch `viewer { login }` in the same query, we use a two-field root query — both `viewer` and `organization` are top-level fields and can be fetched together.

### 7. Locally-viewed PRs not in search results
The current code adds REST URLs for locally-viewed PRs that may not appear in any search query. In GraphQL, these are fetched using aliased `repository(owner, name) { pullRequest(number) { ... } }` queries, batched into a single GraphQL request using dynamic aliases.

---

## Files Inventory

### New file
| File | Purpose |
|------|---------|
| `src/lib/graphql.ts` | `graphqlFetch<T>()`, GraphQL error handling, rate limit mapping, GraphQL-specific TypeScript types |

### Modified files
| File | Changes |
|------|---------|
| `src/App.tsx` | Replace all REST calls in `fetchAndClassifyPullRequests()` and `fetchRecentlyMergedPRs()` with GraphQL |
| `src/lib/classification.ts` | Update `PullDetails`, `Review`, `PullComment` types to match GraphQL response shapes |
| `src/lib/github.ts` | Remove REST-only types that move to `graphql.ts`; keep `RateLimitError`, `apiFetch`, and notification-related types |

### Unchanged files
| File | Reason |
|------|--------|
| `src/lib/notifications.ts` | REST-only; no GraphQL equivalent |
| `src/lib/etag-cache.ts` | Kept for notifications endpoint only |
| `src/lib/smart-refresh.ts` | No API calls; orchestration logic unchanged |
| `src/lib/retry.ts` | Reused as-is for GraphQL calls |
| `src/lib/pr-cache.ts` | TTL-based caching works for both REST and GraphQL |

---

## GraphQL Query Reference

### Query A — Viewer + Teams
```graphql
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
```
> Note: `$login` is passed as the viewer's login (fetched from `viewer.login` on first load, then cached). On the very first call, fetch viewer alone, then use the login for the teams query — or accept that the first load makes 2 queries and subsequent loads make 1.

### Query B — Open PR Search with Full Details
```graphql
query SearchOpenPRs($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: ISSUE, first: $first, after: $after) {
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
        state
        isDraft
        createdAt
        updatedAt
        mergedAt
        author { login avatarUrl url }
        assignees(first: 10) {
          nodes { login avatarUrl url }
        }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
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
        headRefOid
      }
    }
  }
}
```

### Query C — Batch Fetch Locally-Viewed PRs
```graphql
query BatchViewedPRs {
  # One alias per locally-viewed PR not already in search results
  pr_owner_repo_123: repository(owner: "owner", name: "repo") {
    pullRequest(number: 123) {
      # same fields as Query B PullRequest fragment
    }
  }
  pr_owner_repo_456: repository(owner: "owner", name: "repo") {
    pullRequest(number: 456) { ... }
  }
}
```

### Query D — Merged PR Search
```graphql
query SearchMergedPRs($query: String!, $first: Int!) {
  search(query: $query, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        databaseId
        number
        title
        url
        mergedAt
        author { login avatarUrl url }
        baseRepository {
          nameWithOwner
          url
        }
      }
    }
  }
}
```

---

## TODOs

- [x] T1: Create `src/lib/graphql.ts` — GraphQL fetch infrastructure with error handling and rate limit mapping
- [x] T2: Migrate viewer + teams fetch to GraphQL — replace `GET /user` and `GET /user/teams` in `fetchAndClassifyPullRequests()`
- [x] T3: Migrate open PR search + per-PR details to GraphQL — replace `searchPullRequestUrls()` + the `pullsWithReviews` Promise.all block
- [x] T4: Migrate locally-viewed PR batch fetch to GraphQL — replace the `viewedMap` REST URL injection with batched GraphQL aliases
- [x] T5: Migrate `fetchRecentlyMergedPRs()` to GraphQL — replace merged PR search + detail fetches
- [x] T6: Update TypeScript types — align `PullDetails`, `Review`, `PullComment` in `classification.ts` and clean up `github.ts`
- [x] T7: Update unit tests — update mocks and assertions for new GraphQL response shapes

## Final Verification Wave

- [x] F1: `npm run build` exits 0 — no TypeScript errors, no build failures
- [x] F2: `npm run test` — all unit tests pass
- [x] F3: `npm run lint` — no ESLint errors
- [x] F4: Code review — verify GraphQL queries request only the fields actually consumed by the classification logic; no over-fetching or under-fetching
