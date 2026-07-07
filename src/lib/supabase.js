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
        flowType: 'implicit',
      },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;

export function getPresencePlayers(channel) {
  return Object.values(channel.presenceState())
    .flat()
    .filter((presence) => presence?.playerId && presence?.name);
}

export async function fetchGamesPlayed() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('global_stats')
      .select('value')
      .eq('key', 'games_played')
      .single();
    if (error) return null;
    return data?.value ?? null;
  } catch { return null; }
}

export async function incrementGamesPlayed() {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_games_played');
  } catch { /* table may not exist yet */ }
}
