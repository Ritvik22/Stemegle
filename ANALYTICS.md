# Stemegle Analytics

Stemegle now includes first-party traffic and product analytics at `/admin`.
It records acquisition, coarse Cloudflare geography, device families, account
conversion, matchmaking, and game journeys for bot, human, team, and tournament
play.

## What Is Collected

- Signed, HttpOnly anonymous visitor cookie (180 days) and 30-minute idle session cookie
- Virtual page views for landing, matchmaking, party, game, and results screens
- Sanitized external referrer, UTM source/medium/campaign/term/content, and landing path
- Cloudflare country, region, city, and timezone headers
- Coarse device type, browser family, and operating system
- Signup, queue, game start, question progress, completion, and abandonment events
- Anonymous-to-account attribution after signup or login

Stemegle does not persist IP addresses, raw user-agent strings, passwords, auth
tokens, party codes, chat messages, question/answer text, latitude/longitude, or
postal codes. Sensitive referrer query fields and all fragments are removed
before storage. Browsers that enable Do Not Track or Global Privacy Control are
not tracked. Raw events, sessions, and inactive visitor records are automatically
removed after 400 days.

## Data Flow

The browser posts an allowlisted event to `POST /api/analytics/events`. Nginx
proxies that request to the private `analytics` container. The service reads the
Cloudflare headers attached to that request, normalizes the user agent, removes
sensitive fields, rate limits the sender in memory, and calls a service-role-only
Supabase RPC. Visitor and session IDs are issued and signed by the service rather
than trusted from JavaScript. Signed-in events are linked only after the service
verifies the Supabase access token. Email-confirmation signups use a one-time,
30-minute attribution token consumed by the auth trigger. Server secrets never
enter the Vite bundle.

Analytics tables have RLS enabled and grant no browser read access. Admin data is
returned only by an authenticated RPC that checks `analytics_admins` (or a trusted
`app_metadata.role = admin` claim) inside Postgres.

## Setup

1. Add the server-only values to the production `.env`:

   ```text
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ANALYTICS_COOKIE_SECRET=generate-with-openssl-rand-hex-32
   POSTGRES_URL_NON_POOLING=your-direct-postgres-url
   ```

   Generate the cookie secret with `openssl rand -hex 32`. Never prefix these
   secrets with `VITE_` and never commit their values.

2. Apply all migrations:

   ```bash
   docker compose --profile migration build migrate
   docker compose --profile migration run --rm migrate
   ```

3. Grant an existing Stemegle account access in the Supabase SQL editor:

   ```sql
   insert into public.analytics_admins (user_id)
   select id
   from auth.users
   where lower(email) = lower('your-admin-email@example.com')
   on conflict (user_id) do nothing;
   ```

4. Rebuild both production services:

   ```bash
   docker compose up -d --build analytics app
   ```

5. Sign in with the granted account and open `https://stemegle.com/admin`.

Cloudflare's **Add visitor location headers** managed transform must remain
enabled. The analytics service accepts only the country, region, city, and
timezone subset. Historical referral, device, and geography data cannot be
backfilled; existing accounts appear as `Unknown (pre-tracking)` until they
return.

## Local Verification

The UI has a development-only preview populated with representative data:

```text
http://localhost:5173/admin?analytics-demo=1
```

The flag is unavailable in production builds. Run the API unit checks with:

```bash
npm run test:analytics
```
