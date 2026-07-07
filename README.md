# Stemegle

Fast, competitive STEM battles for curious minds. Players can enter as a named guest, match with another online player, answer timed STEM questions, and compete live for score, XP, streaks, and universal rank.

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
