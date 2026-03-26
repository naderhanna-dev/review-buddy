# Learnings

## 2026-03-26 — Initial codebase analysis

### API layer
- All REST calls go through `apiFetch<T>()` in `src/lib/github.ts` — single entry point, easy to parallel with a `graphqlFetch<T>()` counterpart
- `apiFetch` uses native `fetch()` with Bearer token + `X-GitHub-Api-Version: 2022-11-28` header
- ETag caching is handled by `etag-cache.ts` (LRU, 200 entries max) — only relevant for GET requests; GraphQL POST requests cannot use HTTP ETags

### Caching layers (3-tier)
1. HTTP 304 ETags via `etag-cache.ts` — GET only, keep for notifications
2. `pr-cache.ts` — localStorage TTL cache (5-min revalidation, 60-min max age) — works for GraphQL too, no changes needed
3. In-memory React state — unchanged

### Classification logic
- `classifyPullRequest()` in `classification.ts` takes `PullDetails`, `Review[]`, and derived signals
- The `PullDetails` type uses REST snake_case field names (`html_url`, `avatar_url`, `updated_at`, etc.)
- GraphQL returns camelCase — types must be updated or a mapping layer added
- `Review.commit_id` is used to detect new commits since last review (compared to `pull.head.sha`)
  - GraphQL equivalent: `review.commit.oid` vs `pull.headRefOid`

### Policy bot detection
- Current: `CombinedStatusResponse.statuses.find(s => s.context.toLowerCase().startsWith('policy-bot'))`
- GraphQL: `statusCheckRollup.contexts.nodes` with `... on StatusContext { context, state, targetUrl, description }`
- Policy-bot uses legacy commit statuses (not GitHub Actions CheckRuns), so only `StatusContext` inline fragment is needed

### Notifications
- `src/lib/notifications.ts` uses `If-Modified-Since` + `x-poll-interval` response header — REST-only mechanism
- GitHub GraphQL API has no notifications endpoint
- **Do not migrate notifications**

### Search query structure
- 4 base queries + 1 per team slug, all run in parallel via `Promise.all`
- Results are deduplicated into a `Set<string>` of PR URLs
- Locally-viewed PRs (from `viewedMap`) are added as direct REST URLs — need GraphQL alias batching

### Retry logic
- `withRetry()` in `retry.ts` wraps individual API calls with exponential backoff
- Only retries on `RateLimitError`
- Can be reused as-is for GraphQL calls

### Pre-existing lint errors in App.tsx
- Several accessibility and hook dependency lint errors exist in `App.tsx` before this migration
- Do not fix these as part of the GraphQL migration — out of scope

## 2026-03-26 — Core GraphQL migration (T6 + T2-T5)

### Classification contract now mirrors GraphQL pull node shape
- `PullDetails` in `classification.ts` now matches `GqlPullRequestNode` camelCase fields (`databaseId`, `updatedAt`, `baseRepository`, `headRefOid`, etc.)
- `Review` now uses `submittedAt`, `commit.oid`, and `author.login`
- `PullComment` was moved into `classification.ts` with GraphQL shape (`createdAt`, `author`)

### App fetch pipeline switched from REST fanout to GraphQL search + inline details
- Open PR loading now uses `graphqlFetch` + `SEARCH_OPEN_PRS_QUERY` with pagination (`SEARCH_PAGE_SIZE`/`SEARCH_MAX_PAGES`)
- Candidate PRs are deduplicated by `databaseId` instead of REST pull URLs
- Viewed-but-not-returned PRs are recovered via one dynamic GraphQL alias batch query using `PR_DETAILS_FRAGMENT`

### Status and policy-bot signals now come from `statusCheckRollup`
- Commit check state is derived from GraphQL rollup state (`SUCCESS`/`FAILURE`/`ERROR`)
- Policy-bot signal is extracted from `StatusContext` nodes under `statusCheckRollup.contexts.nodes`

### Recently merged PRs migrated to GraphQL search
- `fetchRecentlyMergedPRs()` now runs author/reviewer search via `SEARCH_MERGED_PRS_QUERY`
- Deduplication uses PR `databaseId` and preserves role priority (`author` before `reviewed`)

### Verification caveat from staged migration
- `npm run build` currently fails because `classification.test.ts` fixtures still use old REST shapes; this is expected until T7a updates that test file
- Non-classification test suite passes when excluding `classification.test.ts`
