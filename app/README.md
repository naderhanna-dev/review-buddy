# ReviewRadar App

ReviewRadar is a small React + Vite webapp that helps you triage pull requests by attention level.

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

## Fine-grained PAT permissions

Use a fine-grained token with:
- Pull requests: **Read** (required)
- Members: **Read** (optional, enables team-assigned PR signals)

If Members read is missing, the app still works and shows direct-reviewer and
activity-based signals; only team-assigned signals are skipped.

## Classification behavior

### Needs your attention
- PRs where you are requested as reviewer.
- PRs you reviewed that have updates since your last review.

### Related to you
- PRs requested from teams you belong to.
- PRs you looked at without leaving a review, then received updates.

## Local "viewed" tracking

- When you click a PR title in ReviewRadar, the app stores a local "viewed" timestamp.
- Storage key: `review-radar.viewed` in browser local storage.
- This is device/browser-local and not synced to GitHub.

## Commands

- `npm run dev` - start dev server
- `npm run build` - type-check and build production bundle
- `npm run lint` - run ESLint
- `npm run test` - run unit tests (Vitest)
