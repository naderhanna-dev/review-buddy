#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

command -v tsx >/dev/null 2>&1 || {
  echo "Error: tsx is required. Install: pnpm add -g tsx" >&2
  exit 1
}

exec tsx "$ROOT_DIR/apps/server/src/cli.ts" "$@"
