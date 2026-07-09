#!/usr/bin/env bash
set -euo pipefail

: "${STEMEGLE_SSH:?Set STEMEGLE_SSH to your server, for example user@example.com}"

REMOTE_DIR="${STEMEGLE_REMOTE_DIR:-/srv/stemegle}"
ENV_FILE="${STEMEGLE_ENV_FILE:-$REMOTE_DIR/shared/.env.production}"
RELOAD_CMD="${STEMEGLE_RELOAD_CMD:-sudo systemctl reload nginx}"
SKIP_RELOAD="${STEMEGLE_SKIP_RELOAD:-0}"
KEEP_RELEASES="${STEMEGLE_KEEP_RELEASES:-5}"
RELEASE="$REMOTE_DIR/releases/$(date -u +%Y%m%d%H%M%S)"

echo "Creating remote release: $STEMEGLE_SSH:$RELEASE"
ssh "$STEMEGLE_SSH" "mkdir -p '$REMOTE_DIR/releases' '$REMOTE_DIR/shared' '$RELEASE'"

rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'output/' \
  --exclude '.DS_Store' \
  --exclude '.env*' \
  ./ "$STEMEGLE_SSH:$RELEASE/"

ssh "$STEMEGLE_SSH" 'bash -s' -- \
  "$RELEASE" "$REMOTE_DIR" "$ENV_FILE" "$RELOAD_CMD" "$SKIP_RELOAD" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail

RELEASE="$1"
REMOTE_DIR="$2"
ENV_FILE="$3"
RELOAD_CMD="$4"
SKIP_RELOAD="$5"
KEEP_RELEASES="$6"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE" >&2
  echo "Create it from .env.example before deploying." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js is not installed on the server." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is not installed on the server." >&2; exit 1; }

node -e "
const [major, minor] = process.versions.node.split('.').map(Number);
const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
if (!ok) {
  console.error('Stemegle requires Node 20.19+ or Node 22.12+. Current: ' + process.version);
  process.exit(1);
}
"

cd "$RELEASE"
ln -sfn "$ENV_FILE" .env.production
npm ci
npm run build

ln -sfn "$RELEASE" "$REMOTE_DIR/current"

if [[ "$SKIP_RELOAD" != "1" && -n "$RELOAD_CMD" ]]; then
  eval "$RELOAD_CMD"
fi

find "$REMOTE_DIR/releases" -mindepth 1 -maxdepth 1 -type d \
  | sort \
  | head -n "-$KEEP_RELEASES" \
  | xargs -r rm -rf

echo "Deployed Stemegle to $REMOTE_DIR/current"
REMOTE
