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
  const { count, error } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true });
  return error ? null : count;
}

export async function fetchLeaderboard() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id,battle_name,total_score,wins,matches_played,streak')
    .gt('matches_played', 0)
    .order('total_score', { ascending: false })
    .order('wins', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(10);
  return error ? [] : data;
}

export async function recordMatchResult(matchId, score, opponentScore) {
  if (!supabase || !matchId) return null;
  const { data, error } = await supabase.rpc('record_match_result', {
    p_match_id: matchId,
    p_score: score,
    p_opponent_score: opponentScore,
  });
  if (error) throw error;
  const stats = data?.[0];
  return stats ? {
    xpGained: stats.score_gained,
    streak: stats.current_streak,
    totalXp: stats.total_score,
  } : null;
}
