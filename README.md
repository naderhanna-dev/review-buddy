# ReviewRadar

ReviewRadar is a small React + Vite webapp that helps you triage pull requests by attention level.
It fetches PRs scoped to you in the selected org (not all org PRs).

The integrated **AI Review** feature lets you launch a deep code review from the dashboard — with syntax-highlighted diffs, AI-powered analysis (bug hunting, architecture review, test coverage), chat, and one-click GitHub review submission.

## Setup

### Prerequisites
- Node.js 24+
- pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)
- [GitHub CLI](https://cli.github.com) (`gh`) — required for the AI review feature
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) — required for AI analysis, grouping, and chat

### Install & Build
```bash
pnpm install
pnpm build
```

### Run the server
```bash
pnpm run serve
# Server starts at http://localhost:7672
```

This serves both the PR dashboard and the AI review app from a single local server.

**Options:**
- `--port, -p` — Port to listen on (default: 7672)
- `--host, -H` — Host to bind to (default: 127.0.0.1)

> **Security note:** By default the server binds to `127.0.0.1` (localhost only).
> The server spawns `gh` and `claude` CLI subprocesses using **your local
> credentials** — anyone who can reach the server can trigger GitHub API calls
> and AI analysis on your behalf. Only use `--host 0.0.0.0` on trusted networks
> where you're comfortable with that exposure.

### Install as a service (macOS)

Run the server automatically on login:

```bash
pnpm run install-service
```

**Options** (same as `serve`):
- `--host, -H` — Host to bind to (default: 127.0.0.1)
- `--port, -p` — Port to listen on (default: 7672)

Example — bind to a specific network interface so other machines on the LAN can reach it:
```bash
pnpm run install-service --host 192.168.1.100
```

This creates a launchd plist at `~/Library/LaunchAgents/com.reviewradar.server.plist` and starts the service. The launcher script auto-detects your node version manager (fnm or nvm). Logs go to `~/Library/Logs/ReviewRadar/`.

```bash
# Remove the service
pnpm run uninstall-service

# Check service status
launchctl list | grep reviewradar

# View logs
tail -f ~/Library/Logs/ReviewRadar/server.log
```

### Project Structure
```
apps/
  web/          -- PR dashboard (React + Vite, also deployed to GitHub Pages)
  review/       -- AI review app (React + Vite + Shiki + Zustand)
  server/       -- Persistent Node.js HTTP server (serves both apps, manages review sessions)
packages/
  core/         -- Shared GitHub API client, PR classification, types
  shared/       -- Review types, gh CLI pr-provider
  agents/       -- AI agent prompts + JSON schemas
  theme/        -- Shared CSS design tokens (light/dark)
```

### Dashboard Configuration

Open the app, then configure:
- GitHub organization (single org scope)
- Personal access token (PAT)
- Settings live in a hamburger-toggled sidebar (top-right).
- After saving, the sidebar auto-closes; reopen via the hamburger icon to update.

### AI Review

Click the **Review** button on any PR row to open the AI review interface. This requires the local server to be running (not available on the GitHub Pages deployment).

The review interface provides:
- **Syntax-highlighted diffs** with Shiki
- **AI file grouping** — files organized into semantic groups with summaries
- **AI analysis** — Bug Hunter, Architecture Reviewer, and Test Coverage Analyzer agents
- **Confidence scoring** — each finding is scored 0-100 by a separate agent
- **Chat** — ask questions about the PR with streaming responses
- **Comments & suggestions** — add review comments with GitHub suggestion block support
- **One-click submit** — post your review (Approve/Comment/Request Changes) directly to GitHub

### Commands
```bash
pnpm run serve              # Start the server (dashboard + review)
pnpm build                  # Build all packages
pnpm test                   # Run all tests
pnpm lint                   # Lint all packages
pnpm --filter web dev       # Dev server for dashboard only
pnpm --filter @reviewradar/core test  # Test core package only
```

## Development

```bash
pnpm run dev
```

This starts all apps in parallel via Turborepo:
- **Dashboard** — Vite dev server on port 5173
- **Review app** — Vite dev server on port 5174 (proxies `/api` to the server)
- **Server** — tsx with watch mode on port 7672

You can also run selectively:
```bash
pnpm --filter web dev                 # Dashboard only
pnpm --filter review dev              # Review app only (needs server running)
pnpm --filter server dev              # Server only
```

## Token setup

ReviewRadar supports two token types. Both require the **Resource owner** set to
**MaintainX** (not your personal account) and **All repositories** selected.

### Option A — Fine-grained PAT (recommended for most users)

[Create a fine-grained token](https://github.com/settings/personal-access-tokens/new).

**Repository permissions**:
- Pull requests: **Read** (required)
- Commit statuses: **Read** (required for PR check status icons)
- Metadata: **Read** (auto-granted when any other repo permission is set)

**Organization permissions**:
- Members: **Read** (optional, enables team-assigned PR signals)

Fine-grained tokens do not support the GitHub Notifications API, so the app uses
**ETag-enhanced polling every 2 minutes** to detect changes. This is efficient —
unchanged data returns HTTP 304 and costs minimal API quota.

### Option B — Classic PAT (enables live refresh)

[Create a classic token](https://github.com/settings/tokens/new) with these scopes:
- **repo** (covers pull requests, commit statuses, and administration)
- **notifications** (enables the Notifications API for near-instant change detection)
- **read:org** - Read org and team membership, read org projects 
- **read:discussion** - Read team discussions 

After creation, authorize the token for **MaintainX SSO** — click
"Configure SSO" next to the token and authorize the MaintainX organization.

With a classic token the app polls the Notifications API every ~60 seconds
(respecting GitHub's `X-Poll-Interval` header). When a PR change is detected,
a full refresh triggers immediately. A 10-minute safety-net refresh runs
regardless as a fallback.

### Permission notes

If the Members organization permission is missing, the app still works and shows
direct-reviewer and activity-based signals; only team-assigned signals are skipped.

If Commit statuses read is missing, PR check icons fall back to pending.

## Candidate PR scope

The app builds candidates from open PRs in your org where at least one is true:
- You are directly requested as reviewer.
- You have already reviewed the PR.
- One of your teams is requested (when Members read is available).
- You previously opened the PR from ReviewRadar (local viewed tracker).

Only open PRs are displayed in sections; merged and closed PRs are excluded automatically.
Locally tracked PR keys that are no longer returned in the open candidate set are cleaned up.

## Classification behavior

### Your PRs
- PRs authored by you.
- PRs assigned to you.

Pill priority (since last viewed in ReviewRadar):
1. `New reviews`
2. `New comments`

If there is no new review/comment since last viewed, no pill is shown.

Priority rule: if a PR is authored/assigned to you, it always appears in `Your PRs`
and never in `Needs your attention`.

### Needs your attention
- PRs where you are directly requested and have not reviewed yet.
- PRs you reviewed that have new commits since your last review.
- PRs you reviewed that have new PR comments since your last review.

Pill priority:
1. `New updates`
2. `New comments`
3. `Review requested`

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

## Refresh behavior

The app uses smart polling to stay up to date:

- **With a classic PAT** (`notifications` scope): polls the GitHub Notifications
  API every ~60 seconds. When a PR change is detected, a full data refresh
  triggers immediately. A 10-minute safety-net refresh runs as a fallback.
- **With a fine-grained PAT** (no notifications support): polls with ETag-enhanced
  requests every 2 minutes. Unchanged data returns HTTP 304 (cheap).
- **Tab focus/visibility**: the app also refreshes when the tab or window becomes
  active again (with a 5-minute cooldown to avoid rate limit pressure).
- All API requests use ETag conditional caching — subsequent fetches for unchanged
  data return 304 Not Modified with no response body, saving bandwidth and API quota.
- Header shows a live "Last updated ..." freshness label.
