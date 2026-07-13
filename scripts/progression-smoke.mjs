import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createLearningSession } from '../src/data/learning.js';
import { getQuestionsForMatch } from '../src/data/questions.js';
import { battleNameToAccountEmail } from '../src/lib/accountIdentity.js';

const baseUrl = new URL(process.env.STEMEGLE_URL || 'http://127.0.0.1:8097');
const requestOrigin = new URL(process.env.STEMEGLE_ORIGIN || baseUrl.origin).origin;
const socketUrl = new URL('/api/realtime', baseUrl);
socketUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';

if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  throw new Error('STEMEGLE_URL must use http or https');
}

const HTTP_TIMEOUT_MS = 15_000;
const REALTIME_TIMEOUT_MS = 12_000;
const openPeers = new Set();

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseError(data) {
  const candidate = data?.error || data?.message;
  return typeof candidate === 'string' && candidate.length <= 240 ? `: ${candidate}` : '';
}

class CookieJar {
  #cookies = new Map();

  absorb(headers) {
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);

    for (const value of values) {
      const [pair, ...attributes] = value.split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      const removed = !cookieValue || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (removed) this.#cookies.delete(name);
      else this.#cookies.set(name, cookieValue);
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get size() {
    return this.#cookies.size;
  }
}

async function apiRequest(jar, path, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: requestOrigin,
  };
  if (jar?.size) headers.Cookie = jar.header();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  jar?.absorb(response.headers);
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`${method} ${path} returned non-JSON (${response.status})`);
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status})${responseError(data)}`);
  }
  return data;
}

function profileNumber(hub, snakeCase, camelCase) {
  const value = hub?.profile?.[snakeCase] ?? hub?.profile?.[camelCase];
  const numeric = Number(value);
  expect(Number.isFinite(numeric), `Player hub omitted ${snakeCase}`);
  return numeric;
}

function assertHub(hub, battleName) {
  expect(hub && typeof hub === 'object', 'Player hub response is missing');
  expect(hub.profile && typeof hub.profile === 'object', 'Player hub profile is missing');
  const returnedName = hub.profile.battle_name ?? hub.profile.battleName;
  expect(returnedName === battleName, `Player hub returned the wrong profile for ${battleName}`);
  profileNumber(hub, 'competitive_rating', 'competitiveRating');
  profileNumber(hub, 'rating_games', 'ratingGames');
  profileNumber(hub, 'matches_played', 'matchesPlayed');
  expect(Array.isArray(hub.recentMatches), 'Player hub omitted recent matches');
  expect(Array.isArray(hub.mastery), 'Player hub omitted learning mastery');
  expect(Array.isArray(hub.dailyGoals), 'Player hub omitted daily goals');
}

async function createAccount(label, runToken) {
  const name = `Smoke${label}-${runToken}`;
  const password = `Smk1!${randomBytes(24).toString('base64url')}`;
  const jar = new CookieJar();
  const signup = await apiRequest(jar, '/api/auth/sign-up/email', {
    method: 'POST',
    body: {
      name,
      email: battleNameToAccountEmail(name),
      password,
    },
  });
  expect(signup?.user?.name === name, `Signup did not create ${name}`);
  expect(jar.size > 0, `Signup did not set a session cookie for ${name}`);

  const session = await apiRequest(jar, '/api/auth/get-session');
  expect(session?.user?.id, `Session lookup failed for ${name}`);
  expect(session.user.name === name, `Session lookup returned the wrong user for ${name}`);
  return { name, userId: session.user.id, jar };
}

class RealtimePeer {
  constructor(socket, label) {
    this.socket = socket;
    this.label = label;
    this.messages = [];
    this.waiters = new Set();
    this.failure = null;
    this.closing = false;

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.fail(new Error(`${this.label} received an unexpected binary realtime message`));
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        this.fail(new Error(`${this.label} received invalid realtime JSON`));
        return;
      }
      if (message.type === 'error') {
        this.fail(new Error(
          `${this.label} realtime request failed (${message.code || 'unknown'}): ${message.message || 'no detail'}`,
        ));
        return;
      }
      const waiter = [...this.waiters].find(({ predicate }) => predicate(message));
      if (!waiter) {
        this.messages.push(message);
        return;
      }
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
    socket.on('error', (error) => this.fail(new Error(`${this.label} WebSocket failed: ${error.message}`)));
    socket.on('close', (code) => {
      if (!this.closing) this.fail(new Error(`${this.label} WebSocket closed unexpectedly (${code})`));
    });
  }

  static async open(account, label) {
    expect(account.jar.size > 0, `${label} has no authenticated cookie`);
    const socket = new WebSocket(socketUrl, {
      origin: requestOrigin,
      headers: { Cookie: account.jar.header() },
      perMessageDeflate: false,
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} WebSocket open timed out`)), REALTIME_TIMEOUT_MS);
      const opened = () => {
        clearTimeout(timer);
        socket.off('error', failed);
        socket.off('unexpected-response', rejected);
        resolve();
      };
      const failed = (error) => {
        clearTimeout(timer);
        socket.off('open', opened);
        socket.off('unexpected-response', rejected);
        reject(new Error(`${label} WebSocket open failed: ${error.message}`));
      };
      const rejected = (_request, response) => {
        clearTimeout(timer);
        socket.off('open', opened);
        socket.off('error', failed);
        reject(new Error(`${label} WebSocket upgrade was rejected (${response.statusCode})`));
      };
      socket.once('open', opened);
      socket.once('error', failed);
      socket.once('unexpected-response', rejected);
    });
    const peer = new RealtimePeer(socket, label);
    openPeers.add(peer);
    return peer;
  }

  fail(error) {
    if (!this.failure) this.failure = error;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
    this.waiters.clear();
  }

  send(message) {
    if (this.failure) throw this.failure;
    expect(this.socket.readyState === WebSocket.OPEN, `${this.label} WebSocket is not open`);
    this.socket.send(JSON.stringify(message));
  }

  next(predicate, description, timeoutMs = REALTIME_TIMEOUT_MS) {
    if (this.failure) return Promise.reject(this.failure);
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`${this.label} timed out waiting for ${description}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async sendForAck(message) {
    this.send(message);
    return this.next(
      (candidate) => candidate.type === 'ack' && candidate.ref === message.ref,
      `ack ${message.ref}`,
    );
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    openPeers.delete(this);
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolve) => this.socket.once('close', resolve));
    if (this.socket.readyState === WebSocket.CONNECTING) this.socket.terminate();
    else this.socket.close(1000, 'Smoke complete');
    await Promise.race([closed, sleep(1500)]);
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}

function subscription(channelId, topic, presenceKey) {
  return {
    type: 'subscribe',
    ref: `sub-${channelId}`,
    channelId,
    topic,
    presence: true,
    presenceKey,
    selfBroadcast: true,
  };
}

async function subscribeAndTrack(peer, { channelId, topic, playerId, name, partyLeader }) {
  const subscribe = subscription(channelId, topic, playerId);
  peer.send(subscribe);
  await peer.next(
    (message) => message.type === 'subscribed' && message.ref === subscribe.ref,
    `subscription ${channelId}`,
  );
  await peer.sendForAck({
    type: 'presence.track',
    ref: `track-${channelId}`,
    channelId,
    state: {
      playerId,
      name,
      joinedAt: Date.now(),
      ...(typeof partyLeader === 'boolean' ? { lastSeen: Date.now(), partyLeader } : {}),
    },
  });
}

async function verifyPartyReport(reporter, sender, runToken) {
  const partyCode = randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  const topic = `stemegle:party:${partyCode}`;
  const reporterPlayerId = `party-a-${runToken}`;
  const senderPlayerId = `party-b-${runToken}`;
  const reporterPeer = await RealtimePeer.open(reporter, 'party reporter');
  const senderPeer = await RealtimePeer.open(sender, 'party sender');

  try {
    await subscribeAndTrack(reporterPeer, {
      channelId: `party-a-${runToken}`,
      topic,
      playerId: reporterPlayerId,
      name: 'Untrusted Reporter Name',
      partyLeader: true,
    });
    await subscribeAndTrack(senderPeer, {
      channelId: `party-b-${runToken}`,
      topic,
      playerId: senderPlayerId,
      name: 'Untrusted Sender Name',
      partyLeader: false,
    });

    const clientMessageId = `msg-${runToken}`;
    const chatText = `Progression smoke evidence ${runToken}`;
    await senderPeer.sendForAck({
      type: 'broadcast',
      ref: `chat-${runToken}`,
      channelId: `party-b-${runToken}`,
      event: 'party-chat',
      payload: {
        id: clientMessageId,
        playerId: senderPlayerId,
        name: 'Forged Sender Name',
        text: chatText,
      },
    });
    const chat = await reporterPeer.next(
      (message) => message.type === 'broadcast'
        && message.event === 'party-chat'
        && message.payload?.clientMessageId === clientMessageId,
      'canonical party chat evidence',
    );
    expect(chat.payload.id !== clientMessageId, 'Realtime server did not replace the chat message ID');
    expect(chat.payload.playerId === senderPlayerId, 'Realtime server returned the wrong chat sender');
    expect(chat.payload.name === sender.name, 'Realtime server did not use the signed sender name');
    expect(chat.payload.text === chatText, 'Realtime server changed the chat evidence text');
    expect(/^[A-Za-z0-9_-]{43}$/.test(chat.payload.reportToken), 'Realtime server omitted a report token');

    const result = await apiRequest(reporter.jar, '/api/chat/reports', {
      method: 'POST',
      body: { reportToken: chat.payload.reportToken, reason: 'spam' },
    });
    expect(result?.recorded === true, 'Canonical chat report was not recorded');
    expect(result?.report?.id, 'Canonical chat report omitted its report ID');
    return result.report.id;
  } finally {
    await Promise.allSettled([reporterPeer.close(), senderPeer.close()]);
  }
}

async function answerQuestion(peer, channelId, playerId, questionIndex, selectedIndex) {
  await peer.sendForAck({
    type: 'broadcast',
    ref: `answer-${channelId}-${questionIndex}`,
    channelId,
    event: 'answer',
    payload: {
      playerId,
      questionIndex,
      selected: selectedIndex,
      responseMs: 0,
    },
  });
}

async function verifyRankedMatch(first, second, runToken, beforeFirst, beforeSecond) {
  const firstPlayerId = `rank-a-${runToken}`;
  const secondPlayerId = `rank-b-${runToken}`;
  const matchId = `${firstPlayerId}--${secondPlayerId}`;
  const topic = `stemegle:match:${matchId}`;
  const firstChannel = `match-a-${runToken}`;
  const secondChannel = `match-b-${runToken}`;
  const firstPeer = await RealtimePeer.open(first, 'ranked host');
  const secondPeer = await RealtimePeer.open(second, 'ranked rival');

  try {
    await Promise.all([
      subscribeAndTrack(firstPeer, {
        channelId: firstChannel,
        topic,
        playerId: firstPlayerId,
        name: 'Forged Ranked Host',
      }),
      subscribeAndTrack(secondPeer, {
        channelId: secondChannel,
        topic,
        playerId: secondPlayerId,
        name: 'Forged Ranked Rival',
      }),
    ]);
    const [firstTicket, secondTicket] = await Promise.all([
      firstPeer.next((message) => message.type === 'match_ticket', 'host match ticket'),
      secondPeer.next((message) => message.type === 'match_ticket', 'rival match ticket'),
    ]);
    expect(firstTicket.matchId === matchId && firstTicket.playerId === firstPlayerId, 'Host match ticket is misbound');
    expect(secondTicket.matchId === matchId && secondTicket.playerId === secondPlayerId, 'Rival match ticket is misbound');
    expect(firstTicket.ranked === true && secondTicket.ranked === true, 'Signed match was not ranked');

    const questions = getQuestionsForMatch(matchId);
    const startRef = `start-${runToken}`;
    const startedAt = Date.now();
    await firstPeer.sendForAck({
      type: 'broadcast',
      ref: startRef,
      channelId: firstChannel,
      event: 'start',
      payload: { startsAt: Date.now() + 500, questions },
    });
    await secondPeer.next(
      (message) => message.type === 'broadcast' && message.event === 'start',
      'ranked match start',
    );

    await sleep(650);
    for (let index = 0; index < questions.length; index += 1) {
      await Promise.all([
        answerQuestion(firstPeer, firstChannel, firstPlayerId, index, questions[index].answer),
        answerQuestion(secondPeer, secondChannel, secondPlayerId, index, -1),
      ]);
      if (index < questions.length - 1) await sleep(550);
    }
    const remainingPlayWindow = startedAt + 3900 - Date.now();
    if (remainingPlayWindow > 0) await sleep(remainingPlayWindow);

    await Promise.all([
      firstPeer.sendForAck({
        type: 'broadcast',
        ref: `finish-a-${runToken}`,
        channelId: firstChannel,
        event: 'finish',
        payload: { playerId: firstPlayerId, score: 0 },
      }),
      secondPeer.sendForAck({
        type: 'broadcast',
        ref: `finish-b-${runToken}`,
        channelId: secondChannel,
        event: 'finish',
        payload: { playerId: secondPlayerId, score: 6000 },
      }),
    ]);

    // A single participant submits once. The server ticket supplies both
    // trusted scores and persists both signed accounts atomically.
    const result = await apiRequest(first.jar, '/api/matches/result', {
      method: 'POST',
      body: {
        matchId,
        playerId: firstPlayerId,
        ticket: firstTicket.ticket,
        score: 0,
        opponentScore: 6000,
      },
    });
    expect(result?.recorded === true && result?.ranked === true, 'Ranked result was not recorded');
    expect(result.resultInserted === true, 'Ranked result did not insert both participants');
    expect(result.score > 0 && result.opponentScore === 0, 'HTTP result did not use realtime-owned scores');

    const [afterFirst, afterSecond] = await Promise.all([
      apiRequest(first.jar, '/api/player/hub'),
      apiRequest(second.jar, '/api/player/hub'),
    ]);
    assertHub(afterFirst, first.name);
    assertHub(afterSecond, second.name);
    expect(
      profileNumber(afterFirst, 'rating_games', 'ratingGames')
        === profileNumber(beforeFirst, 'rating_games', 'ratingGames') + 1,
      'Host rating game count did not advance',
    );
    expect(
      profileNumber(afterSecond, 'rating_games', 'ratingGames')
        === profileNumber(beforeSecond, 'rating_games', 'ratingGames') + 1,
      'Rival rating game count did not advance from the single HTTP submission',
    );
    expect(
      profileNumber(afterFirst, 'matches_played', 'matchesPlayed')
        === profileNumber(beforeFirst, 'matches_played', 'matchesPlayed') + 1,
      'Host ranked history did not advance',
    );
    expect(
      profileNumber(afterSecond, 'matches_played', 'matchesPlayed')
        === profileNumber(beforeSecond, 'matches_played', 'matchesPlayed') + 1,
      'Rival ranked history did not advance atomically',
    );

    const firstHistory = afterFirst.recentMatches.find((match) => match.matchId === matchId);
    const secondHistory = afterSecond.recentMatches.find((match) => match.matchId === matchId);
    expect(firstHistory?.mode === 'human' && secondHistory?.mode === 'human', 'Ranked match is missing from a hub');
    expect(firstHistory.score === result.score && firstHistory.opponentScore === result.opponentScore, 'Host history score is wrong');
    expect(secondHistory.score === result.opponentScore && secondHistory.opponentScore === result.score, 'Rival history score is wrong');
    expect(firstHistory.opponent?.battleName === second.name, 'Host history omitted the rival name');
    expect(secondHistory.opponent?.battleName === first.name, 'Rival history omitted the host name');
    expect(firstHistory.ratingChange > 0 && secondHistory.ratingChange < 0, 'Fair ratings did not move in opposite directions');
    expect(
      profileNumber(afterFirst, 'competitive_rating', 'competitiveRating') === firstHistory.ratingAfter,
      'Host hub rating does not match ranked history',
    );
    expect(
      profileNumber(afterSecond, 'competitive_rating', 'competitiveRating') === secondHistory.ratingAfter,
      'Rival hub rating does not match ranked history',
    );
    return {
      matchId,
      hostRating: firstHistory.ratingAfter,
      rivalRating: secondHistory.ratingAfter,
    };
  } finally {
    await Promise.allSettled([firstPeer.close(), secondPeer.close()]);
  }
}

async function main() {
  const runToken = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const first = await createAccount('A', runToken);
  const second = await createAccount('B', runToken);
  console.log(`PROGRESSION_SIGNUP_OK: ${first.name}, ${second.name}`);
  console.log('PROGRESSION_SESSION_OK: two independent cookie sessions verified');

  const [initialFirstHub, initialSecondHub] = await Promise.all([
    apiRequest(first.jar, '/api/player/hub'),
    apiRequest(second.jar, '/api/player/hub'),
  ]);
  assertHub(initialFirstHub, first.name);
  assertHub(initialSecondHub, second.name);
  console.log('PROGRESSION_HUB_OK: both new player profiles loaded');

  const learningQuestion = createLearningSession({
    subject: 'Mathematics',
    difficulty: 'Easy',
    seed: `smoke-${runToken}`,
    count: 1,
  })[0];
  const learning = await apiRequest(first.jar, '/api/learning/attempts', {
    method: 'POST',
    body: {
      attemptId: randomUUID(),
      questionKey: learningQuestion.key,
      selectedIndex: learningQuestion.answer,
      responseMs: 750,
      category: 'Forged category',
      difficulty: 'Hard',
      correct: false,
    },
  });
  expect(learning?.recorded === true, 'Trusted learning attempt was not recorded');
  expect(learning.summary?.category === learningQuestion.category, 'Learning category was not server-derived');
  expect(learning.summary?.difficulty === learningQuestion.difficulty, 'Learning difficulty was not server-derived');
  expect(learning.summary?.correct === 1, 'Trusted correct answer did not update mastery');
  console.log(`PROGRESSION_LEARNING_OK: ${learningQuestion.category} / ${learningQuestion.difficulty}`);

  const botMatchId = `bot-smoke-${runToken}`;
  const bot = await apiRequest(first.jar, '/api/matches/bot', {
    method: 'POST',
    body: { matchId: botMatchId, score: 1500, opponentScore: 900 },
  });
  expect(bot?.historyRecorded === true && bot?.ranked === false, 'Bot match history was not recorded as unranked');
  const afterBotHub = await apiRequest(first.jar, '/api/player/hub');
  assertHub(afterBotHub, first.name);
  const botHistory = afterBotHub.recentMatches.find((match) => match.matchId === botMatchId);
  expect(botHistory?.mode === 'bot', 'Bot match is missing from recent history');
  expect(botHistory.score === 1500 && botHistory.opponentScore === 900, 'Bot history score is wrong');
  for (const [snakeCase, camelCase] of [
    ['competitive_rating', 'competitiveRating'],
    ['rating_games', 'ratingGames'],
    ['matches_played', 'matchesPlayed'],
    ['total_score', 'totalScore'],
  ]) {
    expect(
      profileNumber(afterBotHub, snakeCase, camelCase) === profileNumber(initialFirstHub, snakeCase, camelCase),
      `Bot practice incorrectly changed ${snakeCase}`,
    );
  }
  console.log(`PROGRESSION_BOT_MATCH_OK: ${botMatchId}`);

  const reportId = await verifyPartyReport(first, second, runToken);
  console.log(`PROGRESSION_CHAT_REPORT_OK: report ${reportId}`);

  const [beforeRankedFirst, beforeRankedSecond] = await Promise.all([
    apiRequest(first.jar, '/api/player/hub'),
    apiRequest(second.jar, '/api/player/hub'),
  ]);
  const ranked = await verifyRankedMatch(
    first,
    second,
    runToken,
    beforeRankedFirst,
    beforeRankedSecond,
  );
  console.log(
    `PROGRESSION_RANKED_MATCH_OK: ${ranked.matchId}, ratings ${ranked.hostRating}/${ranked.rivalRating}`,
  );
  console.log(
    `PROGRESSION_SMOKE_OK: battle names ${first.name}, ${second.name}; report ${reportId}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`PROGRESSION_SMOKE_FAILED: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...openPeers].map((peer) => peer.close()));
}
