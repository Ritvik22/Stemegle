import { fromNodeHeaders } from 'better-auth/node';
import { Router } from 'express';
import { auth } from './auth.mjs';
import { getAnalyticsDashboard, ingestAnalyticsRequest } from './analytics.mjs';
import { pool, withTransaction } from './db.mjs';

const MAX_SCORE = 6000;
const MAX_RANKED_MATCHES_PER_DAY = 100;
const rateBuckets = new Map();

function safeIp(req) {
  return String(
    req.headers['cf-connecting-ip']
      || req.headers['x-real-ip']
      || req.socket.remoteAddress
      || 'unknown',
  ).slice(0, 100);
}

function allowRequest(req, namespace, maximum, windowMs = 60_000) {
  const bucketKey = `${namespace}:${safeIp(req)}`;
  const window = Math.floor(Date.now() / windowMs);
  const current = rateBuckets.get(bucketKey);
  if (!current || current.window !== window) {
    rateBuckets.set(bucketKey, { window, count: 1 });
    if (rateBuckets.size > 10_000) {
      for (const [key, bucket] of rateBuckets) {
        if (bucket.window < window - 1) rateBuckets.delete(key);
      }
    }
    return true;
  }
  current.count += 1;
  return current.count <= maximum;
}

function trustedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  const normalizeOrigin = (value) => {
    try {
      const url = new URL(String(value || '').trim());
      return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
    } catch {
      return '';
    }
  };
  const allowed = new Set([
    normalizeOrigin(process.env.BETTER_AUTH_URL || 'http://localhost:5173'),
    ...String(
      process.env.APP_ALLOWED_ORIGINS || process.env.REALTIME_ALLOWED_ORIGINS || '',
    ).split(',').map(normalizeOrigin).filter(Boolean),
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]);
  return allowed.has(normalizeOrigin(origin));
}

function requireOrigin(req, res, next) {
  if (!trustedOrigin(req)) {
    res.status(403).json({ error: 'Cross-origin requests are not accepted' });
    return;
  }
  next();
}

async function getSession(req) {
  try {
    return await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  } catch {
    return null;
  }
}

function isAdmin(session) {
  return Boolean(session?.user && session.user.role === 'admin');
}

function validMatchId(value) {
  return typeof value === 'string'
    && value.length >= 10
    && value.length <= 200
    && /^[A-Za-z0-9:_-]+$/.test(value);
}

function validScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SCORE;
}

function validMatchParticipant(matchId, playerId) {
  if (typeof playerId !== 'string' || playerId.length < 8 || playerId.length > 200) return false;
  const participants = String(matchId || '').split('--');
  return participants.length === 2
    && participants.every((participant) => participant && /^[A-Za-z0-9._~-]+$/.test(participant))
    && participants.includes(playerId);
}

function validMatchTicket(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function normalizeRank(row) {
  if (!row) return null;
  return {
    ...row,
    rank_position: Number(row.rank_position),
    total_score: Number(row.total_score),
    wins: Number(row.wins),
    losses: Number(row.losses),
    matches_played: Number(row.matches_played),
    streak: Number(row.streak),
  };
}

export function createApiRouter({
  getOnlineCount = () => 0,
  notifyStats = () => {},
  verifyMatchTicket = () => false,
} = {}) {
  const router = Router();

  router.get('/stats', async (req, res, next) => {
    try {
      const session = await getSession(req);
      const [counts, leaders, accountRank] = await Promise.all([
        pool.query(`
          select
            (select count(*)::integer from matches) as games_played,
            (
              (select count(*) from app_users)
              + (select count(*) from legacy_profiles)
            )::integer as registered_users
        `),
        pool.query(`
          select rank_position, id, battle_name, total_score, wins, losses,
                 matches_played, streak, legacy
          from leaderboard_rankings
          order by rank_position
          limit 10
        `),
        session?.user?.id
          ? pool.query(`
              select rank_position, id, battle_name, total_score, wins, losses,
                     matches_played, streak, legacy
              from leaderboard_rankings
              where id = $1
            `, [session.user.id])
          : Promise.resolve({ rows: [] }),
      ]);

      res.json({
        onlineCount: getOnlineCount(),
        gamesPlayed: counts.rows[0].games_played,
        registeredUsers: counts.rows[0].registered_users,
        leaders: leaders.rows.map(normalizeRank),
        accountRank: normalizeRank(accountRank.rows[0]),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/bot', requireOrigin, async (req, res, next) => {
    if (!allowRequest(req, 'bot-match', 30)) {
      res.status(429).json({ error: 'Too many match submissions' });
      return;
    }
    const matchId = req.body?.matchId;
    if (!validMatchId(matchId)) {
      res.status(400).json({ error: 'Invalid match ID' });
      return;
    }
    try {
      const result = await pool.query(
        `insert into matches (id, mode) values ($1, 'bot')
         on conflict (id) do nothing returning id`,
        [matchId],
      );
      if (result.rowCount) notifyStats();
      res.json({ recorded: Boolean(result.rowCount), ranked: false });
    } catch (error) {
      next(error);
    }
  });

  router.post('/matches/result', requireOrigin, async (req, res, next) => {
    if (!allowRequest(req, 'match-result', 30)) {
      res.status(429).json({ error: 'Too many match submissions' });
      return;
    }
    const matchId = req.body?.matchId;
    const playerId = req.body?.playerId;
    const ticket = req.body?.ticket;
    const score = req.body?.score;
    const opponentScore = req.body?.opponentScore;
    if (!validMatchId(matchId)
      || !validMatchParticipant(matchId, playerId)
      || !validMatchTicket(ticket)
      || !validScore(score)
      || !validScore(opponentScore)) {
      res.status(400).json({ error: 'Invalid match result' });
      return;
    }
    const authorization = verifyMatchTicket({ ticket, matchId, playerId });
    if (!authorization) {
      res.status(403).json({ error: 'This match was not authorized by the realtime server' });
      return;
    }
    if (authorization.pending) {
      res.status(409).json({ error: 'Both players must finish before this result can be recorded' });
      return;
    }
    if (authorization.score !== score || authorization.opponentScore !== opponentScore) {
      res.status(409).json({ error: 'Match scores do not match the realtime result' });
      return;
    }

    try {
      const session = await getSession(req);
      if (authorization.userId && authorization.userId !== session?.user?.id) {
        res.status(403).json({ error: 'This match ticket belongs to a different account' });
        return;
      }
      const rankedUserId = authorization.ranked && authorization.userId === session?.user?.id
        ? session.user.id
        : null;
      const result = await withTransaction(async (client) => {
        const match = await client.query(
          `insert into matches (id, mode) values ($1, 'human')
           on conflict (id) do nothing returning id`,
          [matchId],
        );
        const persistedMatch = await client.query(
          'select mode from matches where id = $1 for update',
          [matchId],
        );
        if (persistedMatch.rows[0]?.mode !== 'human') {
          throw Object.assign(new Error('Match ID belongs to a different game mode'), { statusCode: 409 });
        }
        if (!rankedUserId) {
          return { matchInserted: Boolean(match.rowCount), ranked: false, stats: null };
        }

        const didWin = score >= opponentScore;
        const existingResult = await client.query(
          'select 1 from match_results where match_id = $1 and user_id = $2',
          [matchId, rankedUserId],
        );
        if (!existingResult.rowCount) {
          const dailyMatches = await client.query(`
            select count(*)::integer as count
            from match_results
            where user_id = $1 and created_at >= date_trunc('day', now())
          `, [rankedUserId]);
          if (dailyMatches.rows[0].count >= MAX_RANKED_MATCHES_PER_DAY) {
            throw Object.assign(new Error('Daily ranked match limit reached'), { statusCode: 429 });
          }
        }
        const inserted = await client.query(
          `insert into match_results (
             match_id, user_id, participant_id, score, opponent_score, won
           ) values ($1, $2, $3, $4, $5, $6)
           on conflict do nothing
           returning match_id`,
          [matchId, rankedUserId, playerId, score, opponentScore, didWin],
        );

        if (inserted.rowCount) {
          await client.query(`
            update player_profiles
            set
              total_score = total_score + $2,
              wins = wins + case when $3 then 1 else 0 end,
              losses = losses + case when $3 then 0 else 1 end,
              matches_played = matches_played + 1,
              streak = case when $3 then streak + 1 else 0 end,
              best_streak = greatest(best_streak, case when $3 then streak + 1 else 0 end),
              updated_at = now()
            where user_id = $1
          `, [rankedUserId, score, didWin]);
        }

        const profile = await client.query(
          'select streak, total_score from player_profiles where user_id = $1',
          [rankedUserId],
        );
        return {
          matchInserted: Boolean(match.rowCount),
          ranked: true,
          stats: {
            xpGained: inserted.rowCount ? score : 0,
            streak: Number(profile.rows[0]?.streak || 0),
            totalXp: Number(profile.rows[0]?.total_score || 0),
          },
        };
      });

      if (result.matchInserted || result.stats?.xpGained) notifyStats();
      res.json({ recorded: result.matchInserted, ranked: result.ranked, stats: result.stats });
    } catch (error) {
      next(error);
    }
  });

  router.post('/analytics/events', requireOrigin, async (req, res, next) => {
    if (!allowRequest(req, 'analytics', 180)) {
      res.status(429).json({ error: 'Too many analytics requests' });
      return;
    }
    try {
      const session = await getSession(req);
      await ingestAnalyticsRequest(req, res, req.body, session?.user?.id || null);
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/access', async (req, res) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ allowed: false });
      return;
    }
    res.json({ allowed: isAdmin(session) });
  });

  router.get('/admin/analytics', async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (!isAdmin(session)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    try {
      res.json(await getAnalyticsDashboard(Number(req.query.days) || 30));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export { getSession, isAdmin, trustedOrigin };
