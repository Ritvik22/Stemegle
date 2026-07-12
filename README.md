# Stemegle

Fast, competitive STEM battles for curious minds. Players can enter as a named
guest, match with another online player, answer timed questions, form parties,
and compete for score, streaks, and a global rank.

This branch is fully self-hosted. PostgreSQL stores accounts, sessions,
leaderboards, matches, and first-party analytics. Better Auth handles password
accounts with same-origin HttpOnly cookies. New players log in with their battle
name and may add an optional contact email; existing email-based accounts remain
compatible. Stemegle's own WebSocket relay powers presence and multiplayer
events. There is no Supabase runtime, SDK, environment variable, or hosted
service dependency.

Ranked human results require server-issued match tickets bound to two distinct
signed-in accounts and both players' realtime finish events. Guest matches stay
playable but do not alter the authenticated leaderboard.

## Stack

- React 19 and Vite
- Express 5 and Better Auth
- PostgreSQL 17
- `ws` realtime relay
- Nginx and Cloudflare Tunnel
- Docker Compose migrations and daily PostgreSQL backups

The question bank contains 5,624 questions across mathematics, physics,
chemistry, biology, space, computing, and engineering. Every match
deterministically selects five categories so both live players receive the same
questions.

## Run With Docker

Create the local environment file:

```bash
cp .env.example .env
openssl rand -hex 32
```

Put independent generated values in `POSTGRES_PASSWORD`,
`APP_DATABASE_PASSWORD`, `BETTER_AUTH_SECRET`, and
`ANALYTICS_COOKIE_SECRET`, then start the stack:

```bash
docker compose up -d --build
```

Open `http://127.0.0.1:8097`. Migrations run before the backend starts.

## Frontend Development

After creating and populating `.env` as described above, install packages and
start PostgreSQL:

```bash
npm install
docker compose up -d db
```

Create `.env.local` with the development server values:

```dotenv
DATABASE_URL=postgresql://stemegle_app:your-app-password@127.0.0.1:5432/stemegle
MIGRATION_DATABASE_URL=postgresql://stemegle_admin:your-admin-password@127.0.0.1:5432/stemegle
APP_DATABASE_PASSWORD=your-app-password
BETTER_AUTH_URL=http://localhost:5173
BETTER_AUTH_SECRET=use-a-random-value-with-at-least-32-characters
ANALYTICS_COOKIE_SECRET=use-a-different-random-value-with-at-least-32-characters
PORT=8787
```

Apply migrations, then run the API and Vite in separate terminals:

```bash
npm run db:migrate:local
npm run dev:server
npm run dev
```

Vite proxies `/api` and WebSocket upgrades to `127.0.0.1:8787`.

## Verification

```bash
npm test
npm run check:questions
npm run build
STEMEGLE_URL=http://127.0.0.1:8097 npm run smoke:leaderboard
STEMEGLE_URL=http://127.0.0.1:8097 npm run smoke:realtime
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production rollout and recovery, and
[ANALYTICS.md](./ANALYTICS.md) for the admin dashboard, collection policy, and
admin bootstrap.

## Legacy Data

The public leaderboard and public match history from the previous deployment
can be imported with `npm run db:import-legacy`. Private emails, password hashes,
sessions, confirmations, private match results, and analytics require owner-level
database access and cannot be recovered from a public project key. Consequently,
players must create a new password on this branch; public historical ranks remain
visible as unclaimed legacy rows rather than being attached by battle name.

Contact email is optional, stored separately from the internal battle-name login
identifier, and is not treated as verified. Password recovery remains unavailable
until the mail integration below is configured.

Self-service password-reset email still needs a real SMTP or transactional-mail
credential. It is not routed through the former provider or an insecure log-link
fallback; see the deployment guide before a broad account launch.
