import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is required');

const sql = postgres(connectionString, { max: 1, prepare: false });
const rollback = new Error('ROLLBACK_SMOKE_TEST');

try {
  await sql.begin(async (tx) => {
    const matchId = `smoke-${randomUUID()}`;
    const [{ count: beforeCount }] = await tx`select count(*)::integer as count from public.matches`;

    await tx`select * from public.record_match_result(${matchId}, 750, 500)`;
    await tx`select * from public.record_match_result(${matchId}, 750, 500)`;

    const [{ count: afterCount }] = await tx`select count(*)::integer as count from public.matches`;
    if (afterCount !== beforeCount + 1) throw new Error('Duplicate reports changed the match total more than once');

    const rankings = await tx`select rank_position, total_score from public.leaderboard_rankings order by rank_position`;
    if (rankings.length === 0) throw new Error('Leaderboard omitted registered accounts');
    if (rankings.some((entry, index) => Number(entry.rank_position) !== index + 1)) throw new Error('Leaderboard ranks are not sequential');
    if (rankings.some((entry, index) => index > 0 && Number(entry.total_score) > Number(rankings[index - 1].total_score))) throw new Error('Leaderboard is not score ordered');

    const [account] = await tx`select id from public.profiles order by created_at asc limit 1`;
    if (account) {
      await tx`select set_config('request.jwt.claim.sub', ${account.id}, true)`;
      const [beforeProfile] = await tx`select total_score, matches_played from public.profiles where id = ${account.id}`;
      await tx`select * from public.record_match_result(${matchId}, 750, 500)`;
      await tx`select * from public.record_match_result(${matchId}, 9999, 0)`;
      const [afterProfile] = await tx`select total_score, matches_played from public.profiles where id = ${account.id}`;

      if (afterProfile.matches_played !== beforeProfile.matches_played + 1) throw new Error('Account received duplicate match credit');
      if (Number(afterProfile.total_score) !== Number(beforeProfile.total_score) + 750) throw new Error('Account score was not recorded exactly once');
    }

    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}

console.log('LEADERBOARD_SMOKE_OK: match totals and account scores are idempotent');
