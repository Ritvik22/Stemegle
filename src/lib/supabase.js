import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const hasRealtimeConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase = hasRealtimeConfig
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;

export function getPresencePlayers(channel) {
  return Object.values(channel.presenceState())
    .flat()
    .filter((presence) => presence?.playerId && presence?.name);
}
