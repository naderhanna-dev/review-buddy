Create an agent team to implement the expandable check status feature in ReviewRadar.

## Feature
Clicking a PR row expands an inline panel showing all failing/pending CI checks for
that PR. Clicking the PR title link (the <a> that navigates to GitHub) must NOT
trigger the expand — that navigation must stay unchanged. Everything else on the
row body should toggle the panel open/closed.

## Stack
React 19 + TypeScript + Vite. App root is at app/src. Run with: cd app && npm run dev
Unit tests: vitest. E2e tests: Playwright against localhost:5173.

## DOM Contract — both teammates must follow this exactly
- data-testid="pr-row"           on the <article> in PullRequestRow.tsx
- data-testid="pr-title-link"    on the PR title <a> in PullRequestRow.tsx
- data-testid="check-details-panel"  on the expanded panel container
- data-testid="check-item"       on each check entry in the panel
- data-testid="check-item-name"  on the check name text node
- data-testid="check-item-state" on the check state text/icon node

## Data already available in the GraphQL response
Each PR's commits.nodes[0].commit.statusCheckRollup.contexts.nodes contains
StatusContext entries shaped as:
  { __typename: 'StatusContext', context: string, state: string,
    targetUrl: string | null, description: string | null }

Only failing and pending checks need to be stored (filter out state === 'SUCCESS').

## New type to add to app/src/lib/classification.ts
  export type CheckStatus = {
    name: string
    state: 'success' | 'failure' | 'pending' | 'error'
    url: string | null
    description: string | null
  }
  Add `checkStatuses: CheckStatus[]` to the existing PullRequest type.

## Tasks — create these before spawning teammates

1. [frontend-dev] Add CheckStatus type to classification.ts; add checkStatuses to
   PullRequest type; populate it in fetch-prs.ts by mapping StatusContext nodes from
   statusCheckRollup.contexts (filter out SUCCESS, map context→name, state→lowercase)

2. [frontend-dev] Add expand/collapse behavior to PullRequestRow.tsx — track
   isExpanded with useState; clicking the <article> toggles it; clicks on <a> or
   <button> elements inside must stopPropagation so they don't also toggle; add
   data-testid="pr-row" to the article and data-testid="pr-title-link" to the title link

3. [frontend-dev] Build app/src/components/CheckDetailsPanel.tsx — receives
   checkStatuses: CheckStatus[]; renders a list with data-testid="check-details-panel";
   each item has data-testid="check-item", data-testid="check-item-name",
   data-testid="check-item-state"; shows check name, a state indicator, and links to
   targetUrl when present; handles empty state gracefully

4. [tester] Install Playwright: cd app && npm install --save-dev @playwright/test &&
   npx playwright install chromium; create app/playwright.config.ts pointing at
   http://localhost:5173 with a single chromium project

5. [tester] Create app/e2e/fixtures/pr-with-checks.ts exporting a realistic mock
   PullRequest object that has checkState: "failure" and checkStatuses with 2 failing
   checks and 1 pending check, each with name, state, url, description populated

6. [tester] Write app/e2e/check-details.spec.ts — tests must cover:
   (a) clicking the row body opens the check-details-panel
   (b) clicking again closes it
   (c) clicking the pr-title-link does NOT open the panel (the link navigates,
       not expands — test that the panel is not visible after clicking the title)
   (d) check-item elements appear with correct check names from the mock data
   Run the tests and iterate until they pass.

## Spawn two teammates

### Spawn teammate: frontend-dev
Prompt:
  You are the frontend developer on an agent team building the expandable check
  status feature for ReviewRadar (React 19 + TypeScript + Vite, app root at app/src).

  Your tasks (pick them up from the shared task list in order):
  - Task 1: Add CheckStatus type and checkStatuses field. In classification.ts add:
      export type CheckStatus = { name: string; state: 'success'|'failure'|'pending'|'error'; url: string|null; description: string|null }
    Add checkStatuses: CheckStatus[] to PullRequest. In fetch-prs.ts, populate it
    from the GraphQL response: map statusCheckRollup.contexts.nodes, keep only entries
    where state !== 'SUCCESS', map context→name, state.toLowerCase()→state, targetUrl→url.

  - Task 2: Add expand behavior to PullRequestRow.tsx.
    Add useState<boolean>(false) for isExpanded. Wrap the article's onClick to toggle
    it. On every <a> and <button> inside the article, add event.stopPropagation() to
    prevent the click from bubbling to the row toggle. Add these testids:
      data-testid="pr-row" to the <article>
      data-testid="pr-title-link" to the PR title <a>
    Render <CheckDetailsPanel checkStatuses={pr.checkStatuses ?? []} /> below the
    existing content when isExpanded is true.

  - Task 3: Build app/src/components/CheckDetailsPanel.tsx.
    Props: { checkStatuses: CheckStatus[] }. Render:
      <div data-testid="check-details-panel">
        {checkStatuses.map(check => (
          <div key={check.name} data-testid="check-item">
            <span data-testid="check-item-state">{check.state}</span>
            <span data-testid="check-item-name">{check.name}</span>
            {check.url ? <a href={check.url} target="_blank" rel="noreferrer">Details</a> : null}
          </div>
        ))}
        {checkStatuses.length === 0 ? <p>No failing checks.</p> : null}
      </div>
    Add appropriate CSS classes (follow existing patterns in App.css).
    Run `cd app && npm run build` when done to verify no TypeScript errors.
    Message the tester teammate when all three tasks are complete so they can run tests.

### Spawn teammate: tester
Prompt:
  You are the tester on an agent team building the expandable check status feature
  for ReviewRadar (React 19 + TypeScript + Vite, app root at app/). Your job is
  Playwright e2e tests. The app runs at http://localhost:5173 (start with:
  cd app && npm run dev).

  The DOM contract you must test against (set by the lead):
    data-testid="pr-row"             — the clickable PR row article
    data-testid="pr-title-link"      — the PR title link (navigates, does not expand)
    data-testid="check-details-panel"— the expanded check panel
    data-testid="check-item"         — each check entry in the panel
    data-testid="check-item-name"    — the check name
    data-testid="check-item-state"   — the check state

  Your tasks (pick them up from the shared task list in order):

  - Task 4: Install Playwright.
    cd app && npm install --save-dev @playwright/test && npx playwright install chromium
    Create app/playwright.config.ts:
      import { defineConfig } from '@playwright/test'
      export default defineConfig({
        testDir: './e2e',
        use: { baseURL: 'http://localhost:5173' },
        projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
        webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
      })

  - Task 5: Create app/e2e/fixtures/pr-with-checks.ts.
    Export a mock PullRequest (matching the type from app/src/lib/classification.ts)
    with checkState: "failure" and checkStatuses: [
      { name: "build / lint", state: "failure", url: "https://example.com/1", description: "ESLint failed" },
      { name: "build / test", state: "failure", url: "https://example.com/2", description: "3 tests failed" },
      { name: "deploy / preview", state: "pending", url: null, description: null },
    ]
    Fill all required PullRequest fields with realistic placeholder values.

  - Task 6: Write app/e2e/check-details.spec.ts.
    The app requires a GitHub token and org to show PRs, so you will need to either:
    (a) mock the fetch layer at the network level using page.route() to intercept
        GitHub API calls and return synthetic PR data that includes your mock
        checkStatuses, OR
    (b) inject the data by setting localStorage before navigating
        (STORAGE_KEYS are in app/src/constants.ts — token key and org key).
    Approach (a) is preferred. Write tests for:
      - row click toggles the panel open
      - second click closes the panel
      - clicking pr-title-link does not open the panel
      - check-item elements show the correct check names
    Run: cd app && npx playwright test
    Iterate until all tests pass. If the frontend dev hasn't finished yet,
    message them to check their status before running.
