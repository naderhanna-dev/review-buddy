# ReviewRadar App

ReviewRadar is a small React + Vite webapp that helps you triage pull requests by attention level.
It fetches PRs scoped to you in the selected org (not all org PRs).

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Open the app, then configure:
- GitHub organization (single org scope)
- Personal access token (PAT)
- Settings live in a hamburger-toggled sidebar (top-right).
- After saving, the sidebar auto-closes; reopen via the hamburger icon to update.

## Fine-grained PAT permissions

Use a fine-grained token with:
- Pull requests: **Read** (required)
- Members: **Read** (optional, enables team-assigned PR signals)

If Members read is missing, the app still works and shows direct-reviewer and
activity-based signals; only team-assigned signals are skipped.

## Candidate PR scope

The app builds candidates from open PRs in your org where at least one is true:
- You are directly requested as reviewer.
- You have already reviewed the PR.
- One of your teams is requested (when Members read is available).
- You previously opened the PR from ReviewRadar (local viewed tracker).

## Classification behavior

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

## Local "viewed" tracking

- When you click a PR title in ReviewRadar, the app stores a local "viewed" timestamp.
- Storage key: `review-radar.viewed` in browser local storage.
- This is device/browser-local and not synced to GitHub.

## Theme

- Default is `System`, following your OS/browser preference.
- Floating moon/sun button in the bottom-right toggles between dark and light.
- Preference is stored in local storage under `review-radar.theme`.

## Commands

- `npm run dev` - start dev server
- `npm run build` - type-check and build production bundle
- `npm run lint` - run ESLint
- `npm run test` - run unit tests (Vitest)
