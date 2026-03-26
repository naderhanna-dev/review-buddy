# Decisions

## 2026-03-26 — Initial planning

### No external GraphQL client library
Use native `fetch()` with a `graphqlFetch<T>()` wrapper, mirroring the existing `apiFetch()` pattern. Avoids adding Apollo/urql to the bundle. The app's needs are simple: one endpoint, one auth header, error mapping.

### Keep `pr-cache.ts` unchanged
The TTL-based localStorage cache is transport-agnostic. It stores classified PR data, not raw API responses. Works identically for GraphQL.

### Keep `etag-cache.ts` for notifications only
HTTP ETags require GET requests. GraphQL uses POST. The ETag cache stays in place but is only used by `apiFetch()` (notifications). It is not used by `graphqlFetch()`.

### Keep `notifications.ts` as REST
GitHub's Notifications API has no GraphQL equivalent. The `If-Modified-Since` / `x-poll-interval` mechanism is REST-specific. Migrating this would require a fundamentally different polling strategy with no benefit.

### Type strategy: update in-place, not a parallel type system
Rather than maintaining both REST types and GraphQL types, update `PullDetails`, `Review`, and `PullComment` in `classification.ts` to use camelCase GraphQL field names. This keeps the classification logic as the single source of truth for the data shape.

### Viewer + teams: two-phase on first load, one query on subsequent loads
`organization.teams(userLogins: [$login])` requires the viewer's login. On first load, fetch viewer login first, then use it for the combined query. On subsequent loads, the login is known and both can be fetched in one query. Alternatively, always fetch viewer first (1 query) then teams (1 query) — still 2 queries vs the current 2 REST calls, but the PR search savings dwarf this.

### Locally-viewed PRs: batched GraphQL aliases
The `viewedMap` PRs that don't appear in search results are currently fetched via individual REST calls. In GraphQL, batch them into a single query using dynamic aliases (`pr_owner_repo_123: repository(...) { pullRequest(...) { ... } }`). If the batch is empty, skip the query entirely.
