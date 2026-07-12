# Stemegle Analytics

The authenticated `/admin` workspace reports traffic, acquisition, conversion,
and player progress from Stemegle's own PostgreSQL database.

## Dashboard

The dashboard includes:

- Page views, distinct visitors, sessions, signups, and unconverted visitors
- Daily traffic, game starts, completions, and abandonments
- Referrer source, exact sanitized referrer URL, UTM fields, and landing page
- Cloudflare country, region, city, and timezone hints
- Device type, browser family, and operating system
- Bot, human, team, and tournament completion breakdowns
- A signup-to-completion funnel
- Signed-up users with first touch, latest activity, account activity, gameplay
  stage, ranked record, and whether a started game was completed or abandoned

## Collection Policy

Stemegle records:

- A signed HttpOnly visitor cookie lasting 180 days
- A signed HttpOnly 30-minute activity-session cookie
- Virtual page views for landing, matchmaking, party, game, and result screens
- Sanitized external referrer and UTM source/medium/campaign/term/content
- Cloudflare country, region, city, and timezone headers
- Coarse device type, browser family, and operating system
- Signup, queue, game start, question progress, completion, and abandonment
- Anonymous-to-account attribution once the user authenticates

Party analytics use an opaque per-game identifier; invite codes never enter the
analytics payload.

The analytics tables do **not** store IP addresses, raw user-agent strings,
passwords, session tokens, party codes, chat messages, question text, answer
text, latitude/longitude, or postal codes. Referrer fragments, credentials, and
non-allowlisted query parameters are removed before storage. Browsers with Do
Not Track or Global Privacy Control enabled are not tracked. Admin page visits
are also excluded.

Better Auth separately stores a signed-in session's token, IP address, and raw
user agent as security metadata. Plaintext passwords are never stored; Better
Auth stores a password hash. Expired auth sessions and their metadata are
purged by the daily maintenance job.

Raw events, sessions, and inactive anonymous visitors are removed after 400
days by default. Set `ANALYTICS_RETENTION_DAYS` between 30 and 730 to change the
window.

## Data Flow

The browser sends an allowlisted event to `POST /api/analytics/events`. Nginx
proxies it to the private Express backend, which:

1. Rejects cross-origin and oversized requests.
2. Rate limits the source without persisting its IP address.
3. Reads Cloudflare location headers and normalizes the user agent.
4. Issues signed visitor/session cookies instead of trusting browser IDs.
5. Verifies Better Auth sessions server-side before attaching a user ID.
6. Writes a parameterized, idempotent PostgreSQL transaction.

The admin endpoints verify the same HttpOnly session and require
`app_users.role = 'admin'`. No database or admin secret enters the Vite bundle.

## Admin Bootstrap

Create the intended account normally, then assign its role from the trusted
server console and sign in again afterward:

```sql
update app_users
set role = 'admin', updated_at = now()
where lower(email) = lower('you@example.com');
```

Never grant access through an unverified email allowlist: before an address is
verified, another person could register it first. The database role is the
authorization boundary; hiding the navigation link is not.

## Cloudflare

Keep Cloudflare's **Add visitor location headers** managed transform enabled.
Only country, region, city, and timezone are accepted. Missing headers render as
unknown rather than blocking the event.

Historical acquisition and private account data cannot be backfilled without
private access to the former database. New activity is tracked from the moment
this stack is deployed; imported public leaderboard rows stay separate from
new authenticated accounts.
