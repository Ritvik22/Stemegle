import { fromNodeHeaders } from 'better-auth/node';
import { Router } from 'express';
import { auth } from './auth.mjs';
import { getAnalyticsDashboard, ingestAnalyticsRequest } from './analytics.mjs';
import { pool, withTransaction } from './db.mjs';
import { MAX_RANKED_MATCHES_PER_DAY } from './game-rules.mjs';
import { getLearningQuestionByKey } from '../src/data/learning.js';

const MAX_SCORE = 6000;
const CHAT_REPORT_REASONS = new Set([
  'harassment',
  'hate_speech',
  'sexual_content',
  'spam',
  'cheating',
  'personal_information',
  'other',
]);
const CHAT_REPORT_STATUSES = new Set(['pending', 'reviewed', 'dismissed', 'actioned', 'all']);
const CHAT_MODERATION_STATUSES = new Set(['reviewed', 'dismissed', 'actioned']);
const rateBuckets = new Map();

function requestError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function boundedText(value, minimum, maximum, pattern = null) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < minimum || normalized.length > maximum) return '';
  if (/\p{Cc}/u.test(normalized) || (pattern && !pattern.test(normalized))) return '';
  return normalized;
}

function numericProfile(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    [
      'total_score', 'wins', 'losses', 'matches_played', 'streak', 'best_streak',
      'competitive_rating', 'peak_rating', 'rating_games', 'rating_wins',
      'rank_position', 'competitive_rank_position',
    ].includes(key) && value !== null ? Number(value) : value,
  ]));
}

export function calculateEloRating(rating, opponentRating, outcome, gamesPlayed) {
  const current = Number(rating);
  const opponent = Number(opponentRating);
  if (!Number.isFinite(current) || !Number.isFinite(opponent)
    || ![0, 0.5, 1].includes(outcome) || !Number.isInteger(gamesPlayed) || gamesPlayed < 0) {
    throw new TypeError('Invalid Elo rating input');
  }
  const kFactor = gamesPlayed < 10 ? 40 : 24;
  const expected = 1 / (1 + (10 ** ((opponent - current) / 400)));
  const unclamped = current + Math.round(kFactor * (outcome - expected));
  const ratingAfter = Math.max(100, Math.min(4000, unclamped));
  return {
    ratingBefore: current,
    ratingAfter,
    ratingChange: ratingAfter - current,
    kFactor,
  };
}

export function normalizeLearningAttempt(body) {
  const attemptId = boundedText(body?.attemptId, 36, 36, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const questionKey = boundedText(body?.questionKey, 1, 120, /^[A-Za-z0-9:_-]+$/);
  const question = getLearningQuestionByKey(questionKey);
  const selectedIndex = body?.selectedIndex;
  const responseMs = body?.responseMs ?? body?.timeMs;
  if (!attemptId || !question || !Number.isInteger(selectedIndex)
    || selectedIndex < 0 || selectedIndex >= question.choiceCount
    || !Number.isInteger(responseMs)
    || responseMs < 0 || responseMs > 120_000) {
    return null;
  }
  return {
    attemptId,
    questionKey,
    selectedIndex,
    category: question.category,
    difficulty: question.difficulty.toLowerCase(),
    correct: selectedIndex === question.answer,
    responseMs,
  };
}

export function normalizeChatReport(body) {
  const reportToken = boundedText(body?.reportToken, 43, 43, /^[A-Za-z0-9_-]+$/);
  const reason = String(body?.reason || '').trim().toLowerCase();
  if (!reportToken || !CHAT_REPORT_REASONS.has(reason)) {
    return null;
  }
  return { reportToken, reason };
}

export function normalizeChatReportStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return CHAT_MODERATION_STATUSES.has(status) ? status : '';
}

export function deriveAchievements(profile, learningTotals = {}) {
  const matches = Number(profile?.matches_played || 0);
  const wins = Number(profile?.wins || 0);
  const bestStreak = Number(profile?.best_streak || 0);
  const attempts = Number(learningTotals.attempts || 0);
  const masteredTracks = Number(learningTotals.mastered_tracks || 0);
  return [
    { id: 'first-match', title: 'First Contact', description: 'Finish a ranked match.', earned: matches >= 1, progress: Math.min(matches, 1), target: 1 },
    { id: 'five-wins', title: 'On the Board', description: 'Win 5 ranked matches.', earned: wins >= 5, progress: Math.min(wins, 5), target: 5 },
    { id: 'hot-streak', title: 'Hot Streak', description: 'Win 3 ranked matches in a row.', earned: bestStreak >= 3, progress: Math.min(bestStreak, 3), target: 3 },
    { id: 'study-session', title: 'Study Session', description: 'Answer 10 learning questions.', earned: attempts >= 10, progress: Math.min(attempts, 10), target: 10 },
    { id: 'subject-mastery', title: 'Subject Specialist', description: 'Reach 80% mastery in one subject and difficulty.', earned: masteredTracks >= 1, progress: Math.min(masteredTracks, 1), target: 1 },
  ];
}

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
  const now = Date.now();
  const current = rateBuckets.get(bucketKey);
  if (!current || current.expiresAt <= now) {
    rateBuckets.set(bucketKey, { expiresAt: now + windowMs, count: 1 });
    if (rateBuckets.size > 10_000) {
      for (const [key, bucket] of rateBuckets) {
        if (bucket.expiresAt <= now) rateBuckets.delete(key);
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

export function validBotMatchId(value) {
  return validMatchId(value)
    && value.startsWith('bot-')
    && !value.includes('--')
    && /^bot-[A-Za-z0-9._~-]+$/.test(value);
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
    rank_position: row.rank_position === null ? null : Number(row.rank_position),
    total_score: Number(row.total_score),
    wins: Number(row.wins),
    losses: Number(row.losses),
    matches_played: Number(row.matches_played),
    streak: Number(row.streak),
    competitive_rating: row.competitive_rating === null ? null : Number(row.competitive_rating),
    peak_rating: row.peak_rating === null ? null : Number(row.peak_rating),
    rating_games: row.rating_games === null ? null : Number(row.rating_games),
    rating_wins: row.rating_wins === null ? null : Number(row.rating_wins),
    competitive_rank_position: row.competitive_rank_position === null
      ? null
      : Number(row.competitive_rank_position),
  };
}

function learningSummary(row) {
  if (!row) return null;
  return {
    category: row.category,
    difficulty: row.difficulty,
    attempts: Number(row.attempts),
    correct: Number(row.correct_answers),
    currentStreak: Number(row.current_streak),
    bestStreak: Number(row.best_streak),
    masteryScore: Number(row.mastery_score),
    lastAttemptAt: row.last_attempt_at,
  };
}

async function settleMatchRatings(client, matchId, newlyInserted) {
  if (!newlyInserted) return;
  const results = await client.query(`
    select user_id, score, opponent_score, rating_after
    from match_results
    where match_id = $1
    order by user_id
    for update
  `, [matchId]);
  if (results.rowCount !== 2 || results.rows.some((row) => row.rating_after !== null)) return;

  const profiles = await client.query(`
    select user_id, competitive_rating, rating_games
    from player_profiles
    where user_id = any($1::uuid[])
    order by user_id
    for update
  `, [results.rows.map((row) => row.user_id)]);
  if (profiles.rowCount !== 2) throw requestError('Ranked match profiles are incomplete', 409);
  const profileByUser = new Map(profiles.rows.map((row) => [row.user_id, row]));

  for (const result of results.rows) {
    const opponentResult = results.rows.find((candidate) => candidate.user_id !== result.user_id);
    const profile = profileByUser.get(result.user_id);
    const opponentProfile = profileByUser.get(opponentResult.user_id);
    const outcome = result.score > result.opponent_score
      ? 1
      : result.score === result.opponent_score ? 0.5 : 0;
    const rating = calculateEloRating(
      profile.competitive_rating,
      opponentProfile.competitive_rating,
      outcome,
      Number(profile.rating_games),
    );
    await client.query(`
      update match_results
      set rating_before = $3, rating_after = $4, rating_change = $5
      where match_id = $1 and user_id = $2
    `, [matchId, result.user_id, rating.ratingBefore, rating.ratingAfter, rating.ratingChange]);
    await client.query(`
      update player_profiles
      set competitive_rating = $2,
          peak_rating = greatest(peak_rating, $2),
          rating_games = rating_games + 1,
          rating_wins = rating_wins + $3,
          updated_at = now()
      where user_id = $1
    `, [result.user_id, rating.ratingAfter, outcome === 1 ? 1 : 0]);
  }
}

export function createApiRouter({
  getOnlineCount = () => 0,
  notifyStats = () => {},
  verifyMatchTicket = () => false,
  completeMatchTicket = () => false,
  verifyChatReportToken = () => null,
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
          select rankings.rank_position, rankings.id, rankings.battle_name,
                 rankings.total_score, rankings.wins, rankings.losses,
                 rankings.matches_played, rankings.streak, rankings.legacy,
                 profile.competitive_rating, profile.peak_rating,
                 profile.rating_games, profile.rating_wins,
                 case when profile.user_id is null or profile.rating_games = 0 then null else (
                   select count(*) + 1 from player_profiles as competitor
                   where competitor.rating_games > 0
                     and competitor.competitive_rating > profile.competitive_rating
                 ) end as competitive_rank_position
          from leaderboard_rankings as rankings
          left join player_profiles as profile
            on not rankings.legacy and profile.user_id::text = rankings.id
          where rankings.matches_played > 0
          order by rankings.rank_position
          limit 10
        `),
        session?.user?.id
          ? pool.query(`
              select rankings.rank_position, rankings.id, rankings.battle_name,
                     rankings.total_score, rankings.wins, rankings.losses,
                     rankings.matches_played, rankings.streak, rankings.legacy,
                     profile.competitive_rating, profile.peak_rating,
                     profile.rating_games, profile.rating_wins,
                     case when profile.rating_games = 0 then null else (
                       select count(*) + 1 from player_profiles as competitor
                       where competitor.rating_games > 0
                         and competitor.competitive_rating > profile.competitive_rating
                     ) end as competitive_rank_position
              from leaderboard_rankings as rankings
              join player_profiles as profile on profile.user_id::text = rankings.id
              where rankings.id = $1 and rankings.matches_played > 0
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

  router.get('/player/hub', async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    try {
      const [
        profileResult,
        recentResult,
        masteryResult,
        learningTotalsResult,
        dailyProgressResult,
      ] = await Promise.all([
        pool.query(`
          select users.id, users.name as battle_name, profile.total_score,
                 profile.wins, profile.losses, profile.matches_played,
                 profile.streak, profile.best_streak, profile.competitive_rating,
                 profile.peak_rating, profile.rating_games, profile.rating_wins,
                 profile.current_season, profile.created_at, profile.updated_at,
                 case when profile.matches_played > 0 then rankings.rank_position end
                   as rank_position,
                 case when profile.rating_games = 0 then null else (
                   select count(*) + 1 from player_profiles as competitor
                   where competitor.rating_games > 0
                     and competitor.competitive_rating > profile.competitive_rating
                 ) end as competitive_rank_position
          from player_profiles as profile
          join app_users as users on users.id = profile.user_id
          left join leaderboard_rankings as rankings on rankings.id = profile.user_id::text
          where profile.user_id = $1
        `, [session.user.id]),
        pool.query(`
          select own.match_id, matches.mode, own.score, own.opponent_score,
                 case
                   when own.score > own.opponent_score then 'win'
                   when own.score = own.opponent_score then 'draw'
                   else 'loss'
                 end as outcome,
                 own.rating_before, own.rating_after, own.rating_change,
                 own.created_at,
                 opponent.user_id as opponent_user_id,
                 case when matches.mode = 'bot' then 'Stemegle Bot'
                      else opponent_users.name end as opponent_name,
                 opponent.score as verified_opponent_score
          from match_results as own
          join matches on matches.id = own.match_id and matches.mode in ('human', 'bot')
          left join match_results as opponent
            on matches.mode = 'human'
           and opponent.match_id = own.match_id
           and opponent.user_id <> own.user_id
          left join app_users as opponent_users on opponent_users.id = opponent.user_id
          where own.user_id = $1
            and (matches.mode = 'bot' or opponent.user_id is not null)
          order by own.created_at desc
          limit 20
        `, [session.user.id]),
        pool.query(`
          select category, difficulty, attempts, correct_answers, current_streak,
                 best_streak, mastery_score, last_attempt_at
          from learning_mastery
          where user_id = $1
          order by category, difficulty
        `, [session.user.id]),
        pool.query(`
          select coalesce(sum(attempts), 0)::integer as attempts,
                 count(*) filter (where mastery_score >= 80 and attempts >= 5)::integer
                   as mastered_tracks
          from learning_mastery
          where user_id = $1
        `, [session.user.id]),
        pool.query(`
          select
            (
              select count(*)::integer
              from match_results as result
              join matches on matches.id = result.match_id and matches.mode = 'human'
              where result.user_id = $1 and result.created_at >= date_trunc('day', now())
            ) as ranked_matches,
            (
              select count(*)::integer from learning_attempts
              where user_id = $1 and created_at >= date_trunc('day', now())
            ) as learning_attempts,
            (
              select count(*)::integer from learning_attempts
              where user_id = $1 and correct
                and created_at >= date_trunc('day', now())
            ) as correct_answers
        `, [session.user.id]),
      ]);
      const profile = numericProfile(profileResult.rows[0]);
      if (!profile) {
        res.status(404).json({ error: 'Player profile not found' });
        return;
      }
      const recentMatches = recentResult.rows.map((row) => ({
        matchId: row.match_id,
        mode: row.mode,
        score: Number(row.score),
        opponentScore: Number(row.verified_opponent_score ?? row.opponent_score),
        outcome: row.outcome,
        ratingBefore: row.rating_before === null ? null : Number(row.rating_before),
        ratingAfter: row.rating_after === null ? null : Number(row.rating_after),
        ratingChange: row.rating_change === null ? null : Number(row.rating_change),
        opponent: {
          id: row.opponent_user_id,
          battleName: row.opponent_name,
        },
        completedAt: row.created_at,
      }));
      const mastery = masteryResult.rows.map(learningSummary);
      const learningTotals = learningTotalsResult.rows[0];
      const daily = dailyProgressResult.rows[0];
      const dailyGoals = [
        {
          id: 'daily-ranked-match',
          title: 'Enter the arena',
          description: 'Finish one ranked match today.',
          progress: Math.min(Number(daily.ranked_matches), 1),
          target: 1,
          completed: Number(daily.ranked_matches) >= 1,
        },
        {
          id: 'daily-learning-five',
          title: 'Practice five',
          description: 'Answer five learning questions today.',
          progress: Math.min(Number(daily.learning_attempts), 5),
          target: 5,
          completed: Number(daily.learning_attempts) >= 5,
        },
        {
          id: 'daily-correct-three',
          title: 'Three right',
          description: 'Answer three learning questions correctly today.',
          progress: Math.min(Number(daily.correct_answers), 3),
          target: 3,
          completed: Number(daily.correct_answers) >= 3,
        },
      ];
      res.json({
        profile,
        rank: {
          xp: profile.rank_position,
          competitive: profile.competitive_rank_position,
        },
        recentMatches,
        mastery,
        achievements: deriveAchievements(profile, learningTotals),
        dailyGoals,
        rankedLimit: {
          matchesPerDay: MAX_RANKED_MATCHES_PER_DAY,
          playedToday: Number(daily.ranked_matches),
          remaining: Math.max(0, MAX_RANKED_MATCHES_PER_DAY - Number(daily.ranked_matches)),
        },
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
    const score = req.body?.score;
    const opponentScore = req.body?.opponentScore;
    const includesResult = score !== undefined || opponentScore !== undefined;
    if (!validBotMatchId(matchId)
      || (includesResult && (!validScore(score) || !validScore(opponentScore)))) {
      res.status(400).json({ error: 'Invalid bot match result' });
      return;
    }
    try {
      const session = await getSession(req);
      const result = await withTransaction(async (client) => {
        const match = await client.query(
          `insert into matches (id, mode) values ($1, 'bot')
           on conflict (id) do nothing returning id`,
          [matchId],
        );
        const persistedMatch = await client.query(
          'select mode from matches where id = $1 for update',
          [matchId],
        );
        if (persistedMatch.rows[0]?.mode !== 'bot') {
          throw requestError('Match ID belongs to a different game mode', 409);
        }
        let historyRecorded = false;
        if (session?.user?.id && includesResult) {
          const history = await client.query(`
            insert into match_results (
              match_id, user_id, score, opponent_score, won
            ) values ($1, $2, $3, $4, $5)
            on conflict (match_id, user_id) do nothing
            returning match_id
          `, [matchId, session.user.id, score, opponentScore, score > opponentScore]);
          historyRecorded = Boolean(history.rowCount);
        }
        return { matchRecorded: Boolean(match.rowCount), historyRecorded };
      });
      if (result.matchRecorded) notifyStats();
      res.json({
        recorded: result.matchRecorded,
        historyRecorded: result.historyRecorded,
        ranked: false,
      });
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
    const resolvedScore = authorization.score;
    const resolvedOpponentScore = authorization.opponentScore;

    try {
      const session = await getSession(req);
      if (authorization.userId && authorization.userId !== session?.user?.id) {
        res.status(403).json({ error: 'This match ticket belongs to a different account' });
        return;
      }
      const rankedParticipants = authorization.ranked
        && authorization.userId === session?.user?.id
        && Array.isArray(authorization.participants)
        && authorization.participants.length === 2
        && new Set(authorization.participants.map((participant) => participant.userId)).size === 2
        && authorization.participants.every((participant) => (
          participant.userId
          && validMatchParticipant(matchId, participant.playerId)
          && validScore(participant.score)
          && validScore(participant.opponentScore)
        ))
        ? authorization.participants
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
        if (!rankedParticipants) {
          return {
            matchInserted: Boolean(match.rowCount),
            resultInserted: false,
            resultPersisted: false,
            ranked: false,
            stats: null,
          };
        }

        const participantUserIds = rankedParticipants
          .map((participant) => participant.userId)
          .sort();
        const lockedProfiles = await client.query(`
          select user_id
          from player_profiles
          where user_id = any($1::uuid[])
          order by user_id
          for update
        `, [participantUserIds]);
        if (lockedProfiles.rowCount !== participantUserIds.length) {
          throw requestError('Ranked match profiles are incomplete', 409);
        }

        const existingResults = await client.query(
          'select user_id from match_results where match_id = $1',
          [matchId],
        );
        const persistedUsers = new Set(existingResults.rows.map((row) => row.user_id));
        const newParticipants = rankedParticipants.filter(
          (participant) => !persistedUsers.has(participant.userId),
        );
        if (newParticipants.length) {
          const dailyCounts = await client.query(`
            select requested.user_id, count(human_match.id)::integer as count
            from unnest($1::uuid[]) as requested(user_id)
            left join match_results as result
              on result.user_id = requested.user_id
             and result.created_at >= date_trunc('day', now())
            left join matches as human_match
              on human_match.id = result.match_id and human_match.mode = 'human'
            group by requested.user_id
          `, [newParticipants.map((participant) => participant.userId)]);
          if (dailyCounts.rows.some((row) => (
            Number(row.count) >= MAX_RANKED_MATCHES_PER_DAY
          ))) {
            throw requestError('Daily ranked match limit reached', 429);
          }
        }
        let insertedCount = 0;
        for (const participant of newParticipants) {
          const didWin = participant.score > participant.opponentScore;
          const didLose = participant.score < participant.opponentScore;
          const inserted = await client.query(
            `insert into match_results (
               match_id, user_id, participant_id, score, opponent_score, won
             ) values ($1, $2, $3, $4, $5, $6)
             on conflict do nothing
             returning match_id`,
            [
              matchId,
              participant.userId,
              participant.playerId,
              participant.score,
              participant.opponentScore,
              didWin,
            ],
          );
          if (!inserted.rowCount) continue;
          insertedCount += 1;
          await client.query(`
            update player_profiles
            set
              total_score = total_score + $2,
              wins = wins + case when $3 then 1 else 0 end,
              losses = losses + case when $4 then 1 else 0 end,
              matches_played = matches_played + 1,
              streak = case when $3 then streak + 1 else 0 end,
              best_streak = greatest(best_streak, case when $3 then streak + 1 else 0 end),
              updated_at = now()
            where user_id = $1
          `, [participant.userId, participant.score, didWin, didLose]);
        }

        await settleMatchRatings(client, matchId, insertedCount > 0);

        const [profile, persistedResult] = await Promise.all([
          client.query(`
            select streak, total_score, competitive_rating, peak_rating,
                   rating_games, rating_wins
            from player_profiles where user_id = $1
          `, [session.user.id]),
          client.query(`
            select rating_before, rating_after, rating_change
            from match_results where match_id = $1 and user_id = $2
          `, [matchId, session.user.id]),
        ]);
        const ratingResult = persistedResult.rows[0];
        return {
          matchInserted: Boolean(match.rowCount),
          resultInserted: insertedCount > 0,
          resultPersisted: Boolean(ratingResult),
          ranked: true,
          stats: {
            xpGained: resolvedScore,
            streak: Number(profile.rows[0]?.streak || 0),
            totalXp: Number(profile.rows[0]?.total_score || 0),
            competitiveRating: Number(profile.rows[0]?.competitive_rating || 1200),
            peakRating: Number(profile.rows[0]?.peak_rating || 1200),
            ratingGames: Number(profile.rows[0]?.rating_games || 0),
            ratingWins: Number(profile.rows[0]?.rating_wins || 0),
            ratingBefore: ratingResult?.rating_before === null
              ? null
              : Number(ratingResult?.rating_before),
            ratingAfter: ratingResult?.rating_after === null
              ? null
              : Number(ratingResult?.rating_after),
            ratingChange: ratingResult?.rating_change === null
              ? null
              : Number(ratingResult?.rating_change),
            ratingPending: ratingResult?.rating_after === null,
          },
        };
      });

      if (result.ranked && result.resultPersisted) {
        completeMatchTicket({ ticket, matchId });
      }
      if (result.matchInserted || result.resultInserted) notifyStats();
      res.json({
        recorded: result.resultPersisted || result.matchInserted,
        resultInserted: result.resultInserted,
        ranked: result.ranked,
        score: resolvedScore,
        opponentScore: resolvedOpponentScore,
        stats: result.stats,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/learning/attempts', requireOrigin, async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (!allowRequest(req, `learning-attempt:${session.user.id}`, 120)) {
      res.status(429).json({ error: 'Too many learning attempts' });
      return;
    }
    const attempt = normalizeLearningAttempt(req.body);
    if (!attempt) {
      res.status(400).json({ error: 'Invalid learning attempt' });
      return;
    }
    try {
      const result = await withTransaction(async (client) => {
        const inserted = await client.query(`
          insert into learning_attempts (
            attempt_id, user_id, question_key, category, difficulty, correct, response_ms
          ) values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (attempt_id) do nothing
          returning attempt_id
        `, [
          attempt.attemptId,
          session.user.id,
          attempt.questionKey,
          attempt.category,
          attempt.difficulty,
          attempt.correct,
          attempt.responseMs,
        ]);

        if (!inserted.rowCount) {
          const existing = await client.query(`
            select user_id, question_key, category, difficulty, correct, response_ms
            from learning_attempts where attempt_id = $1
          `, [attempt.attemptId]);
          const row = existing.rows[0];
          if (!row || row.user_id !== session.user.id || row.question_key !== attempt.questionKey
            || row.category !== attempt.category || row.difficulty !== attempt.difficulty
            || row.correct !== attempt.correct || Number(row.response_ms) !== attempt.responseMs) {
            throw requestError('Attempt ID has already been used', 409);
          }
        } else {
          await client.query(`
            insert into learning_mastery (
              user_id, category, difficulty, attempts, correct_answers,
              current_streak, best_streak, mastery_score, last_attempt_at
            ) values (
              $1, $2, $3, 1, $4,
              case when $5 then 1 else 0 end,
              case when $5 then 1 else 0 end,
              case when $5 then 100 else 0 end,
              now()
            )
            on conflict (user_id, category, difficulty) do update
            set attempts = learning_mastery.attempts + 1,
                correct_answers = learning_mastery.correct_answers + excluded.correct_answers,
                current_streak = case
                  when $5 then learning_mastery.current_streak + 1 else 0
                end,
                best_streak = greatest(
                  learning_mastery.best_streak,
                  case when $5 then learning_mastery.current_streak + 1 else 0 end
                ),
                mastery_score = round(
                  100.0 * (learning_mastery.correct_answers + excluded.correct_answers)
                    / (learning_mastery.attempts + 1),
                  2
                ),
                last_attempt_at = now()
          `, [
            session.user.id,
            attempt.category,
            attempt.difficulty,
            attempt.correct ? 1 : 0,
            attempt.correct,
          ]);
        }

        const summary = await client.query(`
          select category, difficulty, attempts, correct_answers, current_streak,
                 best_streak, mastery_score, last_attempt_at
          from learning_mastery
          where user_id = $1 and category = $2 and difficulty = $3
        `, [session.user.id, attempt.category, attempt.difficulty]);
        return { recorded: Boolean(inserted.rowCount), summary: learningSummary(summary.rows[0]) };
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/chat/reports', requireOrigin, async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (!allowRequest(req, `chat-report:${session.user.id}`, 10, 10 * 60_000)) {
      res.status(429).json({ error: 'Too many chat reports' });
      return;
    }
    const report = normalizeChatReport(req.body);
    if (!report) {
      res.status(400).json({ error: 'Invalid chat report' });
      return;
    }
    try {
      const evidence = verifyChatReportToken({
        token: report.reportToken,
        reporterUserId: session.user.id,
      });
      if (!evidence) {
        res.status(400).json({ error: 'This chat message can no longer be verified' });
        return;
      }
      const inserted = await pool.query(`
        insert into chat_reports (
          reporter_user_id, message_id, target_player_id, target_user_id,
          target_name, channel, reason, excerpt
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (reporter_user_id, message_id) do nothing
        returning id, status, created_at
      `, [
        session.user.id,
        evidence.messageId,
        evidence.targetPlayerId,
        evidence.targetUserId,
        evidence.targetName,
        evidence.channel,
        report.reason,
        evidence.excerpt,
      ]);
      const persisted = inserted.rowCount
        ? inserted
        : await pool.query(`
            select id, status, created_at from chat_reports
            where reporter_user_id = $1 and message_id = $2
          `, [session.user.id, evidence.messageId]);
      res.json({
        recorded: Boolean(inserted.rowCount),
        report: {
          id: persisted.rows[0].id,
          status: persisted.rows[0].status,
          createdAt: persisted.rows[0].created_at,
        },
      });
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

  router.get('/admin/chat-reports', async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (!isAdmin(session)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    const status = String(req.query.status || 'pending').trim().toLowerCase();
    const requestedLimit = Number(req.query.limit) || 100;
    const requestedOffset = Number(req.query.offset) || 0;
    if (!CHAT_REPORT_STATUSES.has(status)) {
      res.status(400).json({ error: 'Invalid report status' });
      return;
    }
    const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 200));
    const offset = Math.max(0, Math.min(Math.trunc(requestedOffset), 100_000));
    try {
      const [reports, counts] = await Promise.all([
        pool.query(`
          select reports.id, reports.message_id, reports.target_player_id,
                 reports.target_name, reports.channel, reports.reason, reports.excerpt,
                 reports.status, reports.created_at, reports.reviewed_at,
                 reports.reporter_user_id, reporter.name as reporter_name,
                 reports.target_user_id, target.name as target_account_name,
                 reports.reviewed_by_user_id, reviewer.name as reviewer_name
          from chat_reports as reports
          join app_users as reporter on reporter.id = reports.reporter_user_id
          left join app_users as target on target.id = reports.target_user_id
          left join app_users as reviewer on reviewer.id = reports.reviewed_by_user_id
          where ($1::text = 'all' or reports.status = $1::text)
          order by reports.created_at desc
          limit $2 offset $3
        `, [status, limit, offset]),
        pool.query(`
          select
            (count(*) filter (where $1::text = 'all' or status = $1::text))::integer as total,
            (count(*) filter (where status = 'pending'))::integer as pending_total
          from chat_reports
        `, [status]),
      ]);
      const total = Number(counts.rows[0]?.total || 0);
      const pendingTotal = Number(counts.rows[0]?.pending_total || 0);
      res.json({
        reports: reports.rows.map((row) => ({
          id: row.id,
          messageId: row.message_id,
          targetPlayerId: row.target_player_id,
          targetName: row.target_name,
          channel: row.channel,
          reason: row.reason,
          excerpt: row.excerpt,
          status: row.status,
          createdAt: row.created_at,
          reviewedAt: row.reviewed_at,
          reporter: { id: row.reporter_user_id, battleName: row.reporter_name },
          targetAccount: row.target_user_id
            ? { id: row.target_user_id, battleName: row.target_account_name }
            : null,
          reviewedBy: row.reviewed_by_user_id
            ? { id: row.reviewed_by_user_id, battleName: row.reviewer_name }
            : null,
        })),
        total,
        pendingTotal,
        pagination: {
          limit,
          offset,
          hasMore: offset + reports.rows.length < total,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/admin/chat-reports/:id', requireOrigin, async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    if (!isAdmin(session)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    if (!allowRequest(req, `chat-report-moderation:${session.user.id}`, 60)) {
      res.status(429).json({ error: 'Too many moderation updates' });
      return;
    }
    const reportId = boundedText(
      req.params.id,
      36,
      36,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const status = normalizeChatReportStatus(req.body?.status);
    if (!reportId || !status) {
      res.status(400).json({ error: 'Invalid moderation update' });
      return;
    }
    try {
      const updated = await pool.query(`
        update chat_reports
        set status = $2, reviewed_at = now(), reviewed_by_user_id = $3
        where id = $1
        returning id, status, reviewed_at, reviewed_by_user_id
      `, [reportId, status, session.user.id]);
      if (!updated.rowCount) {
        res.status(404).json({ error: 'Chat report not found' });
        return;
      }
      res.json({
        report: {
          id: updated.rows[0].id,
          status: updated.rows[0].status,
          reviewedAt: updated.rows[0].reviewed_at,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export { getSession, isAdmin, trustedOrigin };
