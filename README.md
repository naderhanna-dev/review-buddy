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
- One of your teams is requested (when Administration read is available).
- You previously opened the PR from ReviewRadar (local viewed tracker).

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

## Running as a permanent service

Build the production bundle once, then serve the static files with a lightweight
server that starts automatically on login.

### 1. Build and verify

```bash
cd app && npm run build
npm run preview -- --port 4173
# Open http://localhost:4173 to verify, then Ctrl-C
```

### 2. Install a static file server

`vite preview` works but is intended for spot-checking builds, not long-running
service use. [`serve`](https://github.com/vercel/serve) is a better fit:

```bash
npm install -g serve
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.reviewradar.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.reviewradar</string>
  <key>ProgramArguments</key>
  <array>
    <!-- Run `which serve` to find the real path.
         See the fnm note below if you use fnm. -->
    <string>/usr/local/bin/serve</string>
    <string>-s</string>
    <string>dist</string>
    <string>-l</string>
    <string>4173</string>
    <!-- Optional: uncomment the next two lines to listen on all
         interfaces so other devices on your network can reach the app
         (e.g. http://192.168.1.x:4173). -->
    <!-- <string>--host</string> -->
    <!-- <string>0.0.0.0</string> -->
  </array>
  <key>WorkingDirectory</key>
  <!-- Replace with the absolute path to your clone's app/ directory. -->
  <string>/Users/YOU/path/to/ReviewRadar/app</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/reviewradar.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/reviewradar.log</string>
</dict>
</plist>
```

Load and start:

```bash
launchctl load ~/Library/LaunchAgents/com.reviewradar.plist
```

Management commands:

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.reviewradar.plist

# Restart (unload then load)
launchctl unload ~/Library/LaunchAgents/com.reviewradar.plist
launchctl load ~/Library/LaunchAgents/com.reviewradar.plist

# Check status
launchctl list | grep reviewradar

# View logs
tail -f /tmp/reviewradar.log
```

The service starts automatically on login. To remove it permanently, unload and
delete the plist file.

### fnm users

launchd does not source your shell profile, so `#!/usr/bin/env node` inside the
`serve` script cannot find `node`. You need to replace the single `serve` path
in the plist with the absolute `node` binary followed by the `serve` script:

fnm maintains a `default` alias symlink that tracks whichever version you set
with `fnm default`. Use it instead of a version-pinned path so upgrades just work:

```bash
# Verify the alias exists
ls ~/.local/share/fnm/aliases/default/bin/node
ls ~/.local/share/fnm/aliases/default/lib/node_modules/serve/build/main.js
```

Then replace the `<string>/usr/local/bin/serve</string>` line in the plist with:

```xml
    <string>/Users/YOU/.local/share/fnm/aliases/default/bin/node</string>
    <string>/Users/YOU/.local/share/fnm/aliases/default/lib/node_modules/serve/build/main.js</string>
```

After upgrading node via fnm, just restart the service — no path changes needed
as long as `serve` is installed globally on the new version.

### Notes

- By default the server binds to `localhost` only. To expose the app to other
  devices on your network (e.g. `http://192.168.1.x:4173`), add `--host 0.0.0.0`
  to the serve command in the service file.
- Change the port in the service file if `4173` conflicts.
- After pulling new code, rebuild (`cd app && npm run build`) and restart the
  service to pick up changes.
- The `-s` flag on `serve` enables SPA fallback (rewrites all routes to
  `index.html`), which a client-side React app needs.

## Refresh behavior

- The app polls for updates every 5 minutes while the tab is visible.
- The app also refreshes when the tab/window becomes active again.
- Header shows a live "Last updated ..." freshness label.
