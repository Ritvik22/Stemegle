#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/repo}"
DEPLOY_SOURCE_DIR="${DEPLOY_SOURCE_DIR:-$DEPLOY_DIR/source}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_REPO="${DEPLOY_REPO:-ritvik22/stemegle}"
REMOTE_URL="${REMOTE_URL:-https://github.com/${DEPLOY_REPO}.git}"

mkdir -p "$(dirname "$DEPLOY_SOURCE_DIR")"

if [[ ! -d "$DEPLOY_SOURCE_DIR/.git" ]]; then
  rm -rf "$DEPLOY_SOURCE_DIR"
  git clone --depth=1 --branch "$DEPLOY_BRANCH" "$REMOTE_URL" "$DEPLOY_SOURCE_DIR"
else
  cd "$DEPLOY_SOURCE_DIR"
  git remote set-url origin "$REMOTE_URL"
  git fetch --depth=1 origin "$DEPLOY_BRANCH"
  git checkout -B "$DEPLOY_BRANCH" FETCH_HEAD
  git reset --hard FETCH_HEAD
  git clean -fdx
fi

cd "$DEPLOY_DIR"
export APP_SOURCE_DIR="${APP_SOURCE_DIR:-./source}"
export APP_DOCKERFILE="${APP_DOCKERFILE:-../Dockerfile}"
docker compose up -d --build app

for attempt in {1..30}; do
  if curl -fsSI "http://app/" >/dev/null; then
    echo "Stemegle is healthy on the app service"
    exit 0
  fi
  sleep 2
done

echo "Stemegle did not become healthy on the app service" >&2
exit 1
