# ReviewRadar

ReviewRadar is a small React + Vite webapp that helps you triage pull requests by attention level.
It fetches PRs scoped to you in the selected org (not all org PRs).

## Local setup

1. Install dependencies:

```bash
cd app && npm install
```

2. Start development server:

```bash
cd app && npm run dev
```

3. Open the app, then configure:
- GitHub organization (single org scope)
- Personal access token (PAT)
- Settings live in a hamburger-toggled sidebar (top-right).
- After saving, the sidebar auto-closes; reopen via the hamburger icon to update.

## Fine-grained PAT permissions

Use a fine-grained token with:
- Pull requests: **Read** (required)
- Commit statuses: **Read** (required for PR check status icons)
- Administration: **Read** (optional, enables team-assigned PR signals)

If Administration read is missing, the app still works and shows direct-reviewer and
activity-based signals; only team-assigned signals are skipped.

If Commit statuses read is missing, PR check icons fall back to pending.

## Candidate PR scope

The app builds candidates from open PRs in your org where at least one is true:
- You are directly requested as reviewer.
- You have already reviewed the PR.
- One of your teams is requested (when Members read is available).
- You previously opened the PR from ReviewRadar (local viewed tracker).

Only open PRs are displayed in sections; merged and closed PRs are excluded automatically.

## Classification behavior

### Your PRs
- PRs authored by you.
- PRs assigned to you.

Priority rule: if a PR is authored/assigned to you, it always appears in `Your PRs`
and never in `Needs your attention`.

### Needs your attention
- PRs where you are requested as reviewer.
- PRs you reviewed that have updates since your last review.

Each PR row also shows a GitHub-style checks icon:
- Green check = checks passing
- Orange dot = checks pending/unknown
- Red X = checks failing

### Related to you
- PRs requested from teams you belong to.
- PRs you looked at without leaving a review, then received updates.

### Stale PRs
- Auto-stale when `updated_at` is older than 30 days.
- Manual controls are available from the row 3-dots menu:
  - `Mark stale` hides immediately into `Stale PRs`.
  - `Not stale` force-shows a stale PR back in active sections.
  - `Use auto rule` removes a manual force-show override.
- `Stale PRs` section is collapsed by default at the bottom.

## Local "viewed" tracking

- When you click a PR title in ReviewRadar, the app stores a local "viewed" timestamp.
- Storage key: `review-radar.viewed` in browser local storage.
- This is device/browser-local and not synced to GitHub.
- Viewed PRs stay in their section and are shown with reduced row opacity as a visual cue.

## Local stale preferences

- Storage key: `review-radar.stalePreferences` in browser local storage.
- Values are per PR key (`owner/repo#number`) with `stale` or `active` override.

## Theme

- Default is `System`, following your OS/browser preference.
- Floating moon/sun button in the bottom-right toggles between dark and light.
- Preference is stored in local storage under `review-radar.theme`.

## Commands

- `cd app && npm run dev` - start dev server
- `cd app && npm run build` - type-check and build production bundle
- `cd app && npm run lint` - run ESLint
- `cd app && npm run test` - run unit tests (Vitest)

## Refresh behavior

- The app polls for updates every 5 minutes while the tab is visible.
- The app also refreshes when the tab/window becomes active again.
- Header shows a live "Last updated ..." freshness label.
