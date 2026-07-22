import { fromNodeHeaders } from 'better-auth/node';
import { Router, raw } from 'express';
import { auth } from './auth.mjs';
import { getAnalyticsDashboard, ingestAnalyticsRequest } from './analytics.mjs';
import { executeCode } from './code-runner-client.mjs';
import { codegleTests } from './codegle-tests.mjs';
import { pool, withTransaction } from './db.mjs';
import { CODEGLE_LANGUAGES, getCodegleProblem } from '../src/data/codegleProblems.js';

const MAX_SCORE = 6000;
const MAX_RANKED_MATCHES_PER_DAY = 100;
const MAX_QUESTION_PACKS = 100;
const MAX_PACK_QUESTIONS = 50;
const MAX_PACK_IMAGES = 250;
const MAX_PACK_IMAGE_BYTES = 1024 * 1024;
const PACK_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const CODEGLE_LANGUAGE_IDS = new Set(CODEGLE_LANGUAGES.map((language) => language.id));
const MAX_CODEGLE_SOURCE_BYTES = 16 * 1024;
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

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeQuestionPackInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const title = typeof value.title === 'string' ? value.title.trim().replace(/\s+/g, ' ') : '';
  if (!title || title.length > 80 || !Array.isArray(value.questions)
    || value.questions.length < 1 || value.questions.length > MAX_PACK_QUESTIONS) return null;

  const questions = [];
  for (const entry of value.questions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim().replace(/\s+/g, ' ') : '';
    const choices = Array.isArray(entry.choices)
      ? entry.choices.map((choice) => typeof choice === 'string' ? choice.trim().replace(/\s+/g, ' ') : '')
      : [];
    const answerIndex = Number(entry.answerIndex);
    const imageId = entry.imageId == null || entry.imageId === '' ? null : entry.imageId;
    if (!prompt || prompt.length > 300
      || choices.length !== 4
      || choices.some((choice) => !choice || choice.length > 160)
      || new Set(choices.map((choice) => choice.toLocaleLowerCase())).size !== 4
      || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3
      || (imageId !== null && !validUuid(imageId))) return null;
    questions.push({ prompt, choices, answerIndex, imageId });
  }
  return { title, questions };
}

export function validQuestionPackImage(mimeType, body) {
  if (!PACK_IMAGE_TYPES.has(mimeType) || !Buffer.isBuffer(body)
    || body.length < 8 || body.length > MAX_PACK_IMAGE_BYTES) return false;
  if (mimeType === 'image/png') return body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (mimeType === 'image/gif') return ['GIF87a', 'GIF89a'].includes(body.subarray(0, 6).toString('ascii'));
  return body.subarray(0, 4).toString('ascii') === 'RIFF'
    && body.subarray(8, 12).toString('ascii') === 'WEBP';
}

function packQuestionRow(row) {
  return {
    id: row.id,
    prompt: row.prompt,
    choices: row.choices,
    answerIndex: Number(row.answer_index),
    imageId: row.image_id || null,
    imageUrl: row.image_id ? `/api/question-pack-images/${row.image_id}` : null,
  };
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
  verifyCodegleTicket = () => false,
  markCodegleSolved = () => false,
  runCode = executeCode,
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
    const resolvedScore = authorization.score;
    const resolvedOpponentScore = authorization.opponentScore;

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

        const didWin = resolvedScore >= resolvedOpponentScore;
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
          [matchId, rankedUserId, playerId, resolvedScore, resolvedOpponentScore, didWin],
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
          `, [rankedUserId, resolvedScore, didWin]);
        }

        const profile = await client.query(
          'select streak, total_score from player_profiles where user_id = $1',
          [rankedUserId],
        );
        return {
          matchInserted: Boolean(match.rowCount),
          ranked: true,
          stats: {
            xpGained: inserted.rowCount ? resolvedScore : 0,
            streak: Number(profile.rows[0]?.streak || 0),
            totalXp: Number(profile.rows[0]?.total_score || 0),
          },
        };
      });

      if (result.matchInserted || result.stats?.xpGained) notifyStats();
      res.json({
        recorded: result.matchInserted,
        ranked: result.ranked,
        score: resolvedScore,
        opponentScore: resolvedOpponentScore,
        stats: result.stats,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/codegle/submit', requireOrigin, async (req, res, next) => {
    if (!allowRequest(req, 'codegle-submit', 30)) {
      res.status(429).json({ error: 'Too many Codegle submissions. Pause briefly and try again.' });
      return;
    }
    const matchId = req.body?.matchId;
    const playerId = req.body?.playerId;
    const ticket = req.body?.ticket;
    const language = req.body?.language;
    const source = req.body?.source;
    if (!validMatchId(matchId)
      || !validMatchParticipant(matchId, playerId)
      || !validMatchTicket(ticket)
      || !CODEGLE_LANGUAGE_IDS.has(language)
      || typeof source !== 'string'
      || !source.trim()
      || Buffer.byteLength(source) > MAX_CODEGLE_SOURCE_BYTES) {
      res.status(400).json({ error: 'Invalid Codegle submission' });
      return;
    }
    const authorization = verifyCodegleTicket({ ticket, matchId, playerId });
    if (!authorization) {
      res.status(403).json({ error: 'This Codegle match is not authorized' });
      return;
    }
    if (authorization.winner) {
      try {
        const inserted = await pool.query(
          `insert into matches (id, mode) values ($1, 'codegle')
           on conflict (id) do nothing returning id`,
          [matchId],
        );
        if (inserted.rowCount) notifyStats();
      } catch (error) {
        next(error);
        return;
      }
      if (authorization.winner.playerId === playerId) {
        res.json({ passed: true, status: 'accepted', message: 'All tests passed.', winner: authorization.winner, recorded: true });
        return;
      }
      res.status(409).json({ error: 'This Codegle match already has a winner', winner: authorization.winner });
      return;
    }
    const problem = getCodegleProblem(authorization.problemId);
    const tests = codegleTests(authorization.problemId);
    if (!problem || !tests.length) {
      res.status(409).json({ error: 'The Codegle problem is unavailable' });
      return;
    }
    try {
      const verdict = await runCode({ language, source, cases: tests });
      if (verdict.status !== 'accepted') {
        res.json({ passed: false, status: verdict.status, message: verdict.message || 'Try again.' });
        return;
      }
      const winner = markCodegleSolved({ ticket, matchId, playerId });
      if (!winner) {
        res.status(409).json({ error: 'The match could not accept this solution' });
        return;
      }
      const inserted = await pool.query(
        `insert into matches (id, mode) values ($1, 'codegle')
         on conflict (id) do nothing returning id`,
        [matchId],
      );
      if (inserted.rowCount) notifyStats();
      res.json({
        passed: true,
        status: 'accepted',
        message: verdict.message || 'All tests passed.',
        winner,
        recorded: Boolean(inserted.rowCount),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/question-packs', async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in to view your question packs' });
      return;
    }
    try {
      const result = await pool.query(`
        select packs.id, packs.title, packs.created_at, packs.updated_at,
               count(questions.id)::integer as question_count
        from question_packs as packs
        left join question_pack_questions as questions on questions.pack_id = packs.id
        where packs.owner_user_id = $1
        group by packs.id
        order by packs.updated_at desc, packs.id
      `, [session.user.id]);
      res.json({ packs: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        questionCount: Number(row.question_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/question-packs/:packId', async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in to view this question pack' });
      return;
    }
    if (!validUuid(req.params.packId)) {
      res.status(400).json({ error: 'Invalid question pack ID' });
      return;
    }
    try {
      const [pack, questions] = await Promise.all([
        pool.query(`select id, title, created_at, updated_at from question_packs
                    where id = $1 and owner_user_id = $2`, [req.params.packId, session.user.id]),
        pool.query(`select id, prompt, choices, answer_index, image_id
                    from question_pack_questions where pack_id = $1 order by position`, [req.params.packId]),
      ]);
      if (!pack.rowCount) {
        res.status(404).json({ error: 'Question pack not found' });
        return;
      }
      res.json({
        pack: {
          id: pack.rows[0].id,
          title: pack.rows[0].title,
          createdAt: pack.rows[0].created_at,
          updatedAt: pack.rows[0].updated_at,
          questions: questions.rows.map(packQuestionRow),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  async function saveQuestionPack(req, res, next) {
    if (!allowRequest(req, 'question-pack-save', 40)) {
      res.status(429).json({ error: 'Too many question pack changes' });
      return;
    }
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in to save question packs' });
      return;
    }
    const input = normalizeQuestionPackInput(req.body);
    const packId = req.params.packId || null;
    if (!input || (packId && !validUuid(packId))) {
      res.status(400).json({ error: 'Add a title and 1–50 complete questions with four unique options' });
      return;
    }
    try {
      const saved = await withTransaction(async (client) => {
        let resolvedPackId = packId;
        let replacedImageIds = [];
        if (resolvedPackId) {
          const owned = await client.query(
            'select id from question_packs where id = $1 and owner_user_id = $2 for update',
            [resolvedPackId, session.user.id],
          );
          if (!owned.rowCount) throw Object.assign(new Error('Question pack not found'), { statusCode: 404 });
          await client.query(
            'update question_packs set title = $1, updated_at = now() where id = $2',
            [input.title, resolvedPackId],
          );
          const replacedImages = await client.query(
            'select image_id::text from question_pack_questions where pack_id = $1 and image_id is not null',
            [resolvedPackId],
          );
          replacedImageIds = replacedImages.rows.map((row) => row.image_id);
          await client.query('delete from question_pack_questions where pack_id = $1', [resolvedPackId]);
        } else {
          const count = await client.query(
            'select count(*)::integer as count from question_packs where owner_user_id = $1',
            [session.user.id],
          );
          if (count.rows[0].count >= MAX_QUESTION_PACKS) {
            throw Object.assign(new Error(`Question pack limit reached (${MAX_QUESTION_PACKS})`), { statusCode: 409 });
          }
          const created = await client.query(
            'insert into question_packs (owner_user_id, title) values ($1, $2) returning id',
            [session.user.id, input.title],
          );
          resolvedPackId = created.rows[0].id;
        }

        const imageIds = [...new Set(input.questions.map((question) => question.imageId).filter(Boolean))];
        if (imageIds.length) {
          const images = await client.query(
            'select id::text from question_pack_images where owner_user_id = $1 and id = any($2::uuid[])',
            [session.user.id, imageIds],
          );
          if (images.rowCount !== imageIds.length) {
            throw Object.assign(new Error('One or more question images are unavailable'), { statusCode: 400 });
          }
        }

        for (const [position, question] of input.questions.entries()) {
          await client.query(`
            insert into question_pack_questions (
              pack_id, position, prompt, choices, answer_index, image_id
            ) values ($1, $2, $3, $4::jsonb, $5, $6)
          `, [
            resolvedPackId,
            position,
            question.prompt,
            JSON.stringify(question.choices),
            question.answerIndex,
            question.imageId,
          ]);
        }
        if (replacedImageIds.length) {
          await client.query(`
            delete from question_pack_images as images
            where images.owner_user_id = $1
              and images.id = any($2::uuid[])
              and not exists (
                select 1 from question_pack_questions as questions where questions.image_id = images.id
              )
          `, [session.user.id, replacedImageIds]);
        }
        return resolvedPackId;
      });
      res.status(packId ? 200 : 201).json({ id: saved });
    } catch (error) {
      next(error);
    }
  }

  router.post('/question-packs', requireOrigin, saveQuestionPack);
  router.put('/question-packs/:packId', requireOrigin, saveQuestionPack);

  router.delete('/question-packs/:packId', requireOrigin, async (req, res, next) => {
    const session = await getSession(req);
    if (!session?.user) {
      res.status(401).json({ error: 'Sign in to delete question packs' });
      return;
    }
    if (!validUuid(req.params.packId)) {
      res.status(400).json({ error: 'Invalid question pack ID' });
      return;
    }
    try {
      const removed = await withTransaction(async (client) => {
        const images = await client.query(
          'select image_id::text from question_pack_questions where pack_id = $1 and image_id is not null',
          [req.params.packId],
        );
        const result = await client.query(
          'delete from question_packs where id = $1 and owner_user_id = $2 returning id',
          [req.params.packId, session.user.id],
        );
        if (result.rowCount && images.rowCount) {
          await client.query(`
            delete from question_pack_images as pack_images
            where pack_images.owner_user_id = $1
              and pack_images.id = any($2::uuid[])
              and not exists (
                select 1 from question_pack_questions as questions where questions.image_id = pack_images.id
              )
          `, [session.user.id, images.rows.map((row) => row.image_id)]);
        }
        return Boolean(result.rowCount);
      });
      if (!removed) {
        res.status(404).json({ error: 'Question pack not found' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/question-pack-images',
    requireOrigin,
    raw({ type: [...PACK_IMAGE_TYPES], limit: MAX_PACK_IMAGE_BYTES }),
    async (req, res, next) => {
      if (!allowRequest(req, 'question-pack-image', 60)) {
        res.status(429).json({ error: 'Too many image uploads' });
        return;
      }
      const session = await getSession(req);
      if (!session?.user) {
        res.status(401).json({ error: 'Sign in to upload question images' });
        return;
      }
      const mimeType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (!validQuestionPackImage(mimeType, req.body)) {
        res.status(400).json({ error: 'Use a valid PNG, JPEG, WebP, or GIF image up to 1 MB' });
        return;
      }
      try {
        await pool.query(`
          delete from question_pack_images as images
          where images.owner_user_id = $1
            and images.created_at < now() - interval '24 hours'
            and not exists (
              select 1 from question_pack_questions as questions where questions.image_id = images.id
            )
        `, [session.user.id]);
        const count = await pool.query(
          'select count(*)::integer as count from question_pack_images where owner_user_id = $1',
          [session.user.id],
        );
        if (count.rows[0].count >= MAX_PACK_IMAGES) {
          res.status(409).json({ error: `Question image limit reached (${MAX_PACK_IMAGES})` });
          return;
        }
        const image = await pool.query(`
          insert into question_pack_images (owner_user_id, mime_type, byte_size, image_data)
          values ($1, $2, $3, $4) returning id
        `, [session.user.id, mimeType, req.body.length, req.body]);
        const id = image.rows[0].id;
        res.status(201).json({ id, url: `/api/question-pack-images/${id}` });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/question-pack-images/:imageId', async (req, res, next) => {
    if (!validUuid(req.params.imageId)) {
      res.status(404).end();
      return;
    }
    try {
      const image = await pool.query(
        'select mime_type, image_data from question_pack_images where id = $1',
        [req.params.imageId],
      );
      if (!image.rowCount) {
        res.status(404).end();
        return;
      }
      res.set({
        'Content-Type': image.rows[0].mime_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(image.rows[0].image_data);
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
