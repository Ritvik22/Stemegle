import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
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

export async function fetchRegisteredUsers() {
  if (!supabase) return null;
  const { count, error } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  return error ? null : count;
}

export async function fetchLeaderboard(accountId) {
  if (!supabase) return false;
  const columns = 'rank_position,id,battle_name,total_score,wins,losses,matches_played,streak';
  const topRanks = supabase
    .from('leaderboard_rankings')
    .select(columns)
    .order('rank_position', { ascending: true })
    .limit(10);
  const ownRank = accountId
    ? supabase.from('leaderboard_rankings').select(columns).eq('id', accountId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [{ data: leaders, error: leadersError }, { data: accountRank, error: accountError }] = await Promise.all([topRanks, ownRank]);
  if (leadersError || accountError) return false;
  const normalizeRank = (entry) => entry ? {
    ...entry,
    rank_position: Number(entry.rank_position),
    total_score: Number(entry.total_score),
  } : null;
  return { leaders: leaders.map(normalizeRank), accountRank: normalizeRank(accountRank) };
}

// Records a bot/practice match toward the global matches-completed counter
// without touching ranked stats. Safe to call for guests and signed-in users.
export async function recordBotMatch(matchId) {
  if (!supabase || !matchId) return;
  const { error } = await supabase.rpc('record_bot_match', { p_match_id: matchId });
  if (error) throw error;
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
