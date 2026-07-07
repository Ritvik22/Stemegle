# Stemegle

Fast, competitive STEM battles for curious minds. Players can enter as a named guest, match with another online player, answer timed STEM questions, and compete live for score, XP, streaks, and universal rank.

The question bank contains 120 questions across mathematics, physics, chemistry, biology, space, computing, and engineering. Each match deterministically selects five different categories so both live players receive the same set.

## Run locally

```bash
npm install
```

Create `.env.local` with the public Supabase Realtime credentials before starting:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
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

## Multiplayer architecture

Supabase Realtime Presence powers the shared queue and deterministic two-player pairing. Each match uses an isolated match-specific channel to synchronize start time, live scores, connection presence, and final results. Account authentication, server-authoritative scoring, and persistent ranked seasons are the next backend layer.

## Accounts

Supabase Auth provides persistent email/password accounts. Users can create a password-protected account, confirm their email when required, log in across devices, log out, or continue with session-only guest play. Passwords are submitted directly to Supabase Auth and are never stored by the Stemegle frontend.
