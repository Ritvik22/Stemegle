# Stemegle

Fast, competitive STEM battles for curious minds. Players can enter as a named guest, match with another online player, answer timed STEM questions, and compete live for score, XP, streaks, and universal rank.

The question bank contains 624 questions across mathematics, physics, chemistry, biology, space, computing, and engineering. Each match deterministically selects five different categories so both live players receive the same set.

Completed matches are stored once by match ID in Supabase. Signed-in account results update a public, all-time leaderboard with real battle names, wins, and cumulative scores; guest matches count toward the live all-time match total but do not receive a global rank.

## Run locally

```bash
npm install
```

Create `.env.local` with the public Supabase Realtime credentials before starting:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SITE_URL=http://localhost:5173
```

Then run:

```bash
npm run dev
```

Then open the local URL printed by Vite.

## Production build

```bash
npm run build
```

## Debian + Cloudflare Tunnel hosting

This app can be self-hosted as static files behind Nginx and Cloudflare Tunnel. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the server setup, Supabase redirect settings, Nginx config, Cloudflare Tunnel config, and rsync-based deployment script.

## Multiplayer architecture

Supabase Realtime Presence powers the shared queue and deterministic two-player pairing. Each match uses an isolated match-specific channel to synchronize start time, live scores, connection presence, and final results. Account authentication, server-authoritative scoring, and persistent ranked seasons are the next backend layer.

## Accounts

Supabase Auth provides persistent email/password accounts. Users can create a password-protected account, confirm their email when required, log in across devices, log out, or continue with session-only guest play. Passwords are submitted directly to Supabase Auth and are never stored by the Stemegle frontend.
