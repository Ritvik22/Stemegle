#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/repo}"
DEPLOY_SOURCE_DIR="${DEPLOY_SOURCE_DIR:-$DEPLOY_DIR/source}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_REPO="${DEPLOY_REPO:-ritvik22/stemegle}"
REMOTE_URL="${REMOTE_URL:-https://github.com/${DEPLOY_REPO}.git}"
STEMEGLE_IMAGE_PREFIX="${STEMEGLE_IMAGE_PREFIX:-stemegle}"
APP_IMAGE="${STEMEGLE_IMAGE_PREFIX}:latest"
BACKEND_IMAGE="${STEMEGLE_IMAGE_PREFIX}-backend:latest"
BACKUP_IMAGE="${STEMEGLE_IMAGE_PREFIX}-postgres-tools:latest"

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
cp "$DEPLOY_SOURCE_DIR/compose.yaml" "$DEPLOY_DIR/compose.yaml"
export APP_SOURCE_DIR="${APP_SOURCE_DIR:-./source}"
export APP_DOCKERFILE="${APP_DOCKERFILE:-Dockerfile}"
docker compose config --quiet

# Keep immutable image IDs so a failed health gate can put the last application
# binaries back even after the moving tags are rebuilt.
running_image_id() {
  local container
  container="$(docker compose ps -q "$1" 2>/dev/null || true)"
  if [[ -n "$container" ]]; then
    docker inspect "$container" --format '{{.Image}}' 2>/dev/null || true
  fi
}

PREVIOUS_APP_IMAGE="$(running_image_id app)"
PREVIOUS_BACKEND_IMAGE="$(running_image_id backend)"
PREVIOUS_BACKUP_IMAGE="$(running_image_id backup)"

# The validation image runs unit tests, question-bank integrity checks, and a
# production frontend build. A failed validation never reaches the database.
docker compose build validate migrate backend backup app

# Bring up the database first, then take a fully restore-verified snapshot
# before applying any new schema changes.
docker compose up -d --wait db
docker compose --profile maintenance run --rm backup-once
docker compose up --no-deps --abort-on-container-exit --exit-code-from migrate migrate

# Remove services deleted from the current Compose model (including the former
# analytics sidecar) only after the database backup and migrations succeed.
DEPLOY_HEALTHY=0
if docker compose up -d --no-build --wait --remove-orphans backend backup app; then
  for attempt in {1..30}; do
    if curl -fsSI "http://app/" >/dev/null \
      && curl -fsS "http://app/api/stats" >/dev/null \
      && curl -fsS "http://backend:8787/health" >/dev/null; then
      DEPLOY_HEALTHY=1
      break
    fi
    sleep 2
  done
fi

if [[ "$DEPLOY_HEALTHY" == "1" ]]; then
  echo "Stemegle web, backend, and backup services are healthy"
  exit 0
fi

echo "Stemegle did not become healthy after deployment" >&2
if [[ -n "$PREVIOUS_APP_IMAGE" && -n "$PREVIOUS_BACKEND_IMAGE" && -n "$PREVIOUS_BACKUP_IMAGE" ]]; then
  echo "Restoring the previous web, backend, and backup images" >&2
  docker image tag "$PREVIOUS_APP_IMAGE" "$APP_IMAGE"
  docker image tag "$PREVIOUS_BACKEND_IMAGE" "$BACKEND_IMAGE"
  docker image tag "$PREVIOUS_BACKUP_IMAGE" "$BACKUP_IMAGE"
  if docker compose up -d --no-build --no-deps --force-recreate --wait backend backup app; then
    for attempt in {1..30}; do
      if curl -fsSI "http://app/" >/dev/null \
        && curl -fsS "http://app/api/stats" >/dev/null \
        && curl -fsS "http://backend:8787/health" >/dev/null; then
        echo "Previous service images restored; inspect schema compatibility before retrying" >&2
        exit 1
      fi
      sleep 2
    done
  fi
  echo "Automatic application rollback also failed" >&2
else
  echo "No complete previous self-hosted image set was available for automatic rollback" >&2
fi
exit 1
