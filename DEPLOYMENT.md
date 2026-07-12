# Stemegle Self-Hosted Deployment

This branch runs the web app, API, authentication, realtime relay, PostgreSQL,
migrations, and verified backups on one Docker host. Cloudflare Tunnel is the
only public ingress; the web, API, and database host ports bind to loopback.

## Requirements

- Docker Engine with Compose v2+
- A Cloudflare Tunnel for `stemegle.com`
- DNS/redirect coverage for `www.stemegle.com`
- A server checkout with a mode-600 `.env`

No external auth or database account is required.

## Environment

Start from `.env.example`:

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Generate a different random value for every secret:

```dotenv
BETTER_AUTH_URL=https://stemegle.com
APP_ALLOWED_ORIGINS=https://www.stemegle.com

POSTGRES_DB=stemegle
POSTGRES_USER=stemegle_admin
POSTGRES_PASSWORD=generated-url-safe-hex
APP_DATABASE_PASSWORD=generated-independent-hex
BETTER_AUTH_SECRET=generated-independent-hex
ANALYTICS_COOKIE_SECRET=generated-independent-hex

STEMEGLE_IMAGE_PREFIX=stemegle
STEMEGLE_PORT=8097
STEMEGLE_BACKEND_PORT=8787
POSTGRES_PORT=5432
```

`BETTER_AUTH_URL` is the canonical public origin. `APP_ALLOWED_ORIGINS` is a
comma-separated exact-origin allowlist shared by auth CSRF checks and the
WebSocket upgrade handler. Never prefix a secret with `VITE_` or commit `.env`.

## Initial Start

Validate and build the stack:

```bash
docker compose config --quiet
docker compose build migrate backend backup app
docker compose up -d --wait db
docker compose up -d --wait backend backup app
```

The backend waits for the ordered SQL migrations to finish. Verify it through
both the private API port and the Nginx proxy:

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8097/api/stats
STEMEGLE_URL=http://127.0.0.1:8097 \
STEMEGLE_BACKEND_URL=http://127.0.0.1:8787 \
npm run smoke:leaderboard
STEMEGLE_URL=http://127.0.0.1:8097 npm run smoke:realtime
```

Before enabling the tunnel, provision `cloudflared/config.yml` plus its
mode-600 tunnel credential JSON. The config's ingress for both public hostnames
must target `http://app:80`, followed by Cloudflare's required 404 fallback.
Then enable the `tunnel` profile if this checkout owns the Cloudflare Tunnel:

```bash
docker compose --profile tunnel up -d tunnel
```

The tunnel ingress remains `http://app:80`; Nginx proxies `/api/*` and WebSocket
upgrades to `backend:8787` on the private Compose network.

## Legacy Public Import

The one-time export directory must contain `profiles.json` and `matches.json`.
It must not contain emails, password hashes, tokens, or any private auth data.
Import it idempotently after migrations:

```bash
docker compose run --rm \
  -v /secure/path/legacy-export:/legacy:ro \
  -e LEGACY_EXPORT_DIR=/legacy \
  migrate node scripts/import-legacy-public.mjs
```

The import keeps historical ranks as visibly separate, unclaimed legacy rows.
Do not attach them to a new account by battle name because names are not an
identity proof.

## Backups

The `backup` service runs immediately and then daily. Each PostgreSQL custom
archive is:

1. Written with owner/ACL metadata removed.
2. Parsed with `pg_restore --list`.
3. Fully restored into a scratch database.
4. Checksummed only after the restore succeeds.
5. Retained for 30 days by default.

Trigger an extra verified backup before manual maintenance:

```bash
docker compose --profile maintenance run --rm backup-once
docker compose exec backup ls -lh /backups
```

The archives live in the project-scoped `postgres_backups` volume. Replicate
that volume off-host for machine-loss recovery; a local-only backup is not a
complete disaster-recovery plan.

Test a restore without replacing production:

```bash
RESTORE_DATABASE=stemegle_restore_test \
RESTORE_CONFIRM=restore:stemegle_restore_test \
docker compose --profile restore run --rm restore \
  /backups/stemegle_TIMESTAMP.dump stemegle_restore_test
```

Replacing the live database is intentionally gated and creates another safety
backup first:

```bash
docker compose stop app backend backup
RESTORE_DATABASE=stemegle \
RESTORE_CONFIRM=restore:stemegle \
docker compose --profile restore run --rm restore \
  /backups/stemegle_TIMESTAMP.dump stemegle
docker compose run --rm migrate
docker compose up -d --wait backend backup app
```

The fresh migration run is required: an older archive also contains its older
`stemegle_schema_migrations` ledger, so restoring data and skipping migrations
can start new application code against an old schema.

## Automatic Deploys

The webhook service checks out `DEPLOY_BRANCH`, validates Compose, runs tests,
checks all 5,624 questions, performs a production frontend build, builds the new
images, starts PostgreSQL, creates a verified pre-migration backup, applies
migrations, and only then replaces the backend and app containers. It captures
the image IDs of the running services and restores them if any replacement or
end-to-end health check fails.

```dotenv
DEPLOY_REPO=Ritvik22/Stemegle
DEPLOY_BRANCH=codex/self-hosted-backend
GITHUB_WEBHOOK_SECRET=generated-webhook-secret
```

Start it with:

```bash
docker compose --profile autodeploy up -d --build autodeploy
```

Change `DEPLOY_BRANCH` only after the intended branch is pushed and its staging
stack passes the smoke tests.

## Isolated Staging

Compose has no fixed container names, so a second project can run beside the
live stack with alternate loopback ports and its own volumes:

```bash
COMPOSE_PROJECT_NAME=stemegle-staging \
STEMEGLE_IMAGE_PREFIX=stemegle-staging \
STEMEGLE_PORT=18097 \
STEMEGLE_BACKEND_PORT=18787 \
POSTGRES_PORT=55432 \
BETTER_AUTH_URL=http://127.0.0.1:18097 \
APP_ALLOWED_ORIGINS=http://localhost:18097 \
docker compose up -d --build --wait backend backup app
```

Never point staging at the production `postgres_data` volume.
The distinct image prefix is also required: without it, a staging build can
retag production's rollback images even when the containers and volumes are
otherwise isolated.

## Cloudflare Analytics Headers

Enable Cloudflare's **Add visitor location headers** managed transform. The API
accepts country, region, city, and timezone only. It does not store request IPs.

## Account Migration Boundary

Without private access to the previous auth database, emails, password hashes,
sessions, confirmations, private match results, and private analytics cannot be
exported. The self-hosted branch therefore requires fresh account passwords.
This is preferable to guessing identity from public names or retaining a hidden
dependency on the old provider.

## Password Recovery

Self-service reset email is intentionally disabled until an SMTP or transactional
mail credential is configured. Better Auth will not log or expose reset links as
a fallback. Account creation and sign-in work, but a forgotten password currently
requires an operator-assisted recovery; add a real mailer before inviting a broad
public account cohort.
