# Debian + Cloudflare Tunnel Deployment

Stemegle is a Vite React single-page app. Vercel is only serving static files and rewriting browser routes to `index.html`, so a Debian server can host it as static files behind Cloudflare Tunnel.

On a shared server that already runs other websites, prefer the Docker Compose setup in this repo. It creates isolated `stemegle_app` and `stemegle_tunnel` containers and does not modify the other Cloudflare tunnels.

## What Must Move To The Server

Transfer the source code, `package-lock.json`, `supabase/migrations`, and the deployment files in this repo. Do not transfer `node_modules`, `dist`, `.git`, or local `.env` files. Build on the server so the final bundle is created with the production domain and Supabase settings.

The included Docker setup builds the Vite app into an Nginx image and exposes it on a configurable loopback port, defaulting to `127.0.0.1:8097`.

## Server Prerequisites

Install these on Debian if they are not already present:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin rsync curl ca-certificates
```

Create the deployment directory. On the current shared server this is `/home/gbs/stemegle`, which avoids sudo and matches the existing Docker project layout:

```bash
mkdir -p /home/gbs/stemegle
```

## Production Environment

Create `/home/gbs/stemegle/.env` on the server:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_SITE_URL=https://stemegle.com
STEMEGLE_PORT=8097
STEMEGLE_ANALYTICS_PORT=8098
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
ANALYTICS_COOKIE_SECRET=generate-with-openssl-rand-hex-32
POSTGRES_URL_NON_POOLING=postgresql://your-direct-connection
```

`SUPABASE_SERVICE_ROLE_KEY` is a server-only secret used by the private analytics
container. `ANALYTICS_COOKIE_SECRET` signs HttpOnly visitor/session cookies;
generate it with `openssl rand -hex 32`. Never prefix either with `VITE_`; Vite
variables are public browser values.

Automated deploys run migrations before replacing the app, so configure the
direct Postgres URL above. `POSTGRES_URL` can be used as a fallback:

```bash
POSTGRES_URL=postgresql://...
```

The Supabase URL and anon key are public browser values and are baked into the static build. The Postgres URL is secret and should stay only on the server.

## Supabase Checks

In Supabase Auth settings, add your production site URL and redirect URLs:

```text
https://stemegle.com
https://www.stemegle.com
```

Keep local development URLs such as `http://localhost:5173` if you still test locally.

Apply migrations before the first analytics rollout. Future webhook deploys run
this step automatically:

```bash
cd /home/gbs/stemegle
docker compose --profile migration build migrate
docker compose --profile migration run --rm migrate
```

## Docker App

Deploy the repo contents to `/home/gbs/stemegle`. The app listens only on
`127.0.0.1:${STEMEGLE_PORT}` and proxies analytics to
`127.0.0.1:${STEMEGLE_ANALYTICS_PORT}`. Build, migrate, and start the services:

```bash
cd /home/gbs/stemegle
docker compose --profile migration build migrate analytics app
docker compose --profile migration run --rm migrate
docker compose up -d --no-build analytics app
```

Check that the selected ports are free before starting:

```bash
ss -ltn | grep ':8097' || true
ss -ltn | grep ':8098' || true
```

After applying the analytics migration, grant an admin account in the Supabase
SQL editor. Replace the email with the account that should see private analytics:

```sql
insert into public.analytics_admins (user_id)
select id from auth.users
where lower(email) = lower('your-admin-email@example.com')
on conflict (user_id) do nothing;
```

Keep Cloudflare's **Add visitor location headers** managed transform enabled.
Stemegle stores country, region, city, and timezone hints, but not IP addresses,
coordinates, or postal codes. Full details are in `ANALYTICS.md`.

## Cloudflare Tunnel For A Different Account

Because the server already has other Cloudflare tunnels for other accounts, keep Stemegle's credentials in `/home/gbs/stemegle/cloudflared` and use a separate `stemegle_tunnel` container.

For a locally managed tunnel:

```bash
cd /home/gbs/stemegle
mkdir -p cloudflared
cloudflared tunnel login --origincert ./cloudflared/cert.pem
cloudflared tunnel --origincert ./cloudflared/cert.pem create stemegle
cloudflared tunnel --origincert ./cloudflared/cert.pem route dns stemegle stemegle.com
cloudflared tunnel --origincert ./cloudflared/cert.pem route dns stemegle www.stemegle.com
```

Then copy `deploy/cloudflared-config.example.yml` to `cloudflared/config.yml` and replace `YOUR_TUNNEL_ID_OR_NAME` and `YOUR_TUNNEL_ID.json` with the tunnel ID printed by `cloudflared tunnel create`.

Start the tunnel:

```bash
docker compose --profile tunnel up -d tunnel
```

Alternatively, create a remotely managed tunnel in the Cloudflare dashboard for the account that owns `stemegle.com`, then run a separate token-based cloudflared container. Do not reuse the other sites' existing Cloudflare credentials.

## GitHub Webhook Auto-Deploy

The server can auto-deploy when GitHub receives a push to `main`.

The webhook endpoint is:

```text
https://deploy.stemegle.com/github
```

In GitHub, open the repo settings and add a webhook:

```text
Payload URL: https://deploy.stemegle.com/github
Content type: application/json
Secret: use the GITHUB_WEBHOOK_SECRET value from /home/gbs/stemegle/.env
Events: Just the push event
Active: checked
```

The webhook service verifies GitHub's `X-Hub-Signature-256`, ignores non-`main`
pushes, then clones or updates `ritvik22/stemegle` into
`/home/gbs/stemegle/source`, runs migrations, and rebuilds the analytics and app
services.

Start or restart the webhook container:

```bash
cd /home/gbs/stemegle
docker compose --profile autodeploy up -d --build autodeploy
```

Check logs:

```bash
tail -f /home/gbs/stemegle/deploy.log
docker logs -f stemegle_autodeploy
```

## Deploy From Your Machine

From this repo on your local machine:

```bash
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude __pycache__/ \
  --exclude '*.pyc' \
  --exclude dist \
  --exclude .env \
  --exclude .cloudflared/ \
  --exclude cloudflared/ \
  --exclude source/ \
  --exclude deploy.log \
  ./ gbs@ssh.astrofsa.org:/home/gbs/stemegle/
```

Then SSH into the server and run:

```bash
cd /home/gbs/stemegle
docker compose --profile migration build migrate analytics app
docker compose --profile migration run --rm migrate
docker compose up -d --no-build analytics app
```

If the tunnel is configured too:

```bash
docker compose --profile tunnel up -d
```

If the webhook is configured too:

```bash
docker compose --profile autodeploy up -d --build autodeploy
```

Rebuild `autodeploy` during this first analytics rollout. After that bootstrap,
the webhook copies the freshly cloned Compose file, builds the cloned Dockerfiles,
runs migrations, verifies the analytics health endpoint, and only then replaces
the app containers.

The older system-Nginx deploy script is still available in `scripts/deploy-debian.sh`, but Docker is the safer default on the current shared server.

## Verify

On the server:

```bash
curl -I http://127.0.0.1:8097/
curl -fsS http://127.0.0.1:8098/health
docker ps --filter name=stemegle
```

From anywhere:

```bash
curl -I https://stemegle.com/
```

Also create a Supabase account and confirm the email redirect returns to `https://stemegle.com`, not the old Vercel URL.

## Non-Docker Static Alternative

If you later want to use system Nginx instead of Docker, `deploy/nginx-stemegle.conf` and `scripts/deploy-debian.sh` provide that path. Use a loopback port that does not collide with other services.
