# ReviewRadar App

ReviewRadar is a small React + Vite webapp that helps you triage pull requests by attention level.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill OAuth values.

3. Start backend OAuth exchange server:

```bash
npm run dev:server
```

4. In another terminal, start frontend:

```bash
npm run dev
```

5. Open the app, then configure:
- GitHub organization (single org scope)
- Use **Sign in with GitHub OAuth** (preferred) or PAT fallback

## PAT scopes

For PAT fallback, use a token with:
- `repo` (read pull requests across private/public repos you can access)
- `read:org` (read your team memberships)

For OAuth app setup, grant the same scopes: `repo` and `read:org`.

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
- `npm run dev:server` - start OAuth code exchange server
- `npm run build` - type-check and build production bundle
- `npm run lint` - run ESLint
- `npm run test` - run unit tests (Vitest)
