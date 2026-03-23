# ReviewRadar Plan

This file is the working source of truth for the project.

Working agreement:
- At the start of every prompt, read this file first.
- Keep this file updated as decisions, scope, and progress change.

## Product Goal

Build a small webapp that shows which pull requests need your attention, inspired by Reviewable sections and styled close to GitHub to reduce UI friction.

## Locked Decisions

- Frontend stack: React + Vite.
- Auth approach: PAT-based local access for now (fine-grained: Pull requests read; Members read optional).
- Scope: single GitHub organization.
- Team-related PRs: include PRs requested from teams the user belongs to.
- Data fetch scope: candidate PRs should be user-scoped within the org (not all org PRs).
- Theme: system-default theming with manual dark/light override.
- Theme control UI: floating moon/sun quick toggle in corner.
- Connection UX: settings live in a hamburger-toggled sidebar; auto-close after save.
- PR row details: show author/reviewer avatars with profile links and repository link.
- PR row polish: reason on rich status-pill hover tooltip and single-line truncated titles.
- PR checks signal: GitHub-style pass/pending/fail icon on each row.
- Section precedence: authored/assigned PRs always go to "Your PRs" and never to "Needs your attention".
- Stale utility: auto-stale by last update (30d), manual stale/"Not stale" overrides, persisted locally.
- Row safety UX: stale actions are in a 3-dots overflow menu to prevent accidental clicks.

## PR Classification Rules

### Needs your attention

1. PRs where you are requested as a required reviewer.
2. PRs you already reviewed and that received updates since your last submitted review.

### Related to you (not urgent)

1. PRs assigned to your teams.
2. PRs you viewed/looked at without submitting a review, and that received updates since.

## UX Direction

- Mimic GitHub visual language closely (layout density, typography rhythm, muted palette, badges, list/table behavior).
- Keep sections clear and triage-friendly with counts and quick navigation.
- Prioritize low cognitive load and immediate scanability.

## Technical Plan

1. Project bootstrap
   - Create Vite + React app.
   - Add baseline styling tokens oriented around GitHub-like UI.

2. Auth + configuration
   - First iteration: allow PAT for local speed.
   - OAuth App flow intentionally deferred.
   - Gracefully degrade when Members permission is missing (skip team signals only).
   - Add org selector/config (single-org constrained).

3. Data ingestion (GitHub API)
   - Fetch user-scoped candidate PRs for the org (direct reviewer, reviewed-by, team-requested when available, locally viewed).
   - Fetch review requests (users + teams), reviews, and latest commit/update markers.
   - Resolve team membership for current user.

4. Attention engine
   - Implement deterministic classification for the 4 rule buckets above.
   - Compute "updated since last review" using last review submitted timestamp vs latest commit/update timestamp.
   - Persist "looked but not reviewed" locally (first pass) and evolve if needed.

5. UI sections
   - Render four sections: "Needs your attention", "Your PRs", "Related to you", and collapsed "Stale PRs".
   - Add counts, sorting by urgency/recency, and direct PR links.

6. Quality + polish
   - Empty/loading/error states.
   - Basic tests around classification logic.
   - Documentation for local setup and auth.

## Current Status

- [x] Problem framing and core rules defined.
- [x] Initial technical decisions locked.
- [x] Vite + React scaffold created.
- [x] GitHub data layer implemented.
- [x] Classification engine implemented.
- [x] UI section rendering implemented.
- [ ] OAuth flow implemented.
- [x] Tests and docs completed.

## Next Step

Harden API usage: improve rate-limit handling and reduce per-PR API calls with batched GraphQL where possible.
