import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { getQuestionsForMatch } from '../src/data/questions.js';

export const REALTIME_PATH = '/api/realtime';
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_BROADCAST_PAYLOAD_BYTES = 128 * 1024;
export const MAX_PRESENCE_BYTES = 4 * 1024;

const MAX_TOPIC_LENGTH = 256;
const MAX_EVENT_LENGTH = 64;
const MAX_CHANNEL_ID_LENGTH = 100;
const MAX_PRESENCE_KEY_LENGTH = 200;
const MAX_CHAT_LENGTH = 500;
const MAX_GAME_SCORE = 6000;
const DEFAULT_MAX_CONNECTIONS = 10_000;
// School and campus networks can legitimately place many players behind one
// public address. Keep a per-IP ceiling without turning a classroom into one
// oversized client.
const DEFAULT_MAX_CONNECTIONS_PER_IP = 250;
const DEFAULT_MAX_MESSAGES_PER_MINUTE = 600;
const DEFAULT_MATCH_TICKET_TTL_MS = 45 * 60 * 1000;
const DEFAULT_MINIMUM_MATCH_DURATION_MS = 3000;
const DEFAULT_QUESTION_TRANSITION_MS = 500;
const MATCH_EVENTS = new Set(['ready', 'start', 'answer', 'score', 'finish', 'chat']);
const PARTY_EVENTS = new Set([
  'party-start',
  'party-answer',
  'party-timeout',
  'party-duel-answer',
  'party-duel-result',
  'party-chat',
]);
const DATABASE_TABLES = new Set(['matches', 'profiles']);
const DATABASE_EVENTS = new Set(['INSERT', 'UPDATE', 'DELETE', '*']);
const PRESENCE_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;
const WIRE_ID_PATTERN = /^[A-Za-z0-9._~:-]+$/;
const PARTY_TOPIC_PATTERN = /^stemegle:party:[A-Z0-9]{5}$/;
const MATCH_TOPIC_PREFIX = 'stemegle:match:';
const PARTY_TOPIC_PREFIX = 'stemegle:party:';

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchParticipants(topic) {
  if (typeof topic !== 'string' || !topic.startsWith(MATCH_TOPIC_PREFIX)) return null;
  const matchId = topic.slice(MATCH_TOPIC_PREFIX.length);
  const separator = matchId.indexOf('--');
  if (separator <= 0 || separator !== matchId.lastIndexOf('--')) return null;
  const players = [matchId.slice(0, separator), matchId.slice(separator + 2)];
  if (players.some((player) => !validIdentifier(
    player,
    MAX_PRESENCE_KEY_LENGTH,
    PRESENCE_KEY_PATTERN,
  ))) return null;
  return players;
}

function normalizedOrigin(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function requestIp(request) {
  const forwarded = request.headers['cf-connecting-ip'] || request.headers['x-real-ip'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value || request.socket.remoteAddress || 'unknown').slice(0, 100);
}

function rejectUpgrade(socket, statusCode, reason) {
  if (socket.destroyed) return;
  const body = `${reason}\n`;
  socket.end(
    `HTTP/1.1 ${statusCode} ${reason}\r\n`
      + 'Connection: close\r\n'
      + 'Content-Type: text/plain; charset=utf-8\r\n'
      + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
      + body,
  );
}

export function isAllowedRealtimeTopic(topic) {
  if (typeof topic !== 'string' || topic.length === 0 || topic.length > MAX_TOPIC_LENGTH) return false;
  return topic === 'stemegle:visitors'
    || topic === 'stemegle:ranked-stats'
    || topic === 'stemegle:lobby:v1'
    || Boolean(matchParticipants(topic))
    || PARTY_TOPIC_PATTERN.test(topic);
}

function allowedEventsForTopic(topic) {
  if (topic.startsWith('stemegle:match:')) return MATCH_EVENTS;
  if (topic.startsWith('stemegle:party:')) return PARTY_EVENTS;
  return null;
}

function validIdentifier(value, maxLength, pattern) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && (!pattern || pattern.test(value));
}

function validatePresence(topic, presenceKey, presence) {
  if (!isPlainObject(presence)) return 'Presence state must be an object.';
  if (jsonBytes(presence) > MAX_PRESENCE_BYTES) return 'Presence state is too large.';

  if (topic === 'stemegle:visitors') {
    return Number.isFinite(presence.joinedAt) ? null : 'Visitor presence requires joinedAt.';
  }

  if (presence.playerId !== presenceKey) return 'Presence playerId must match its presence key.';
  if (typeof presence.name !== 'string' || !presence.name.trim() || presence.name.length > 64) {
    return 'Presence name must be between 1 and 64 characters.';
  }
  if (!Number.isFinite(presence.joinedAt)) return 'Presence joinedAt must be a number.';

  if (topic.startsWith('stemegle:party:')) {
    if (typeof presence.partyLeader !== 'boolean') return 'Party presence requires partyLeader.';
    if (!Number.isFinite(presence.lastSeen)) return 'Party presence requires lastSeen.';
  }
  return null;
}

function validateChatPayload(state, payload) {
  if (payload.playerId !== state.presenceKey) return 'Chat playerId must match the sender.';
  if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > MAX_CHAT_LENGTH) {
    return `Chat text must be between 1 and ${MAX_CHAT_LENGTH} characters.`;
  }
  if (payload.name !== undefined
    && (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 64)) {
    return 'Chat name must be between 1 and 64 characters.';
  }
  return null;
}

function validateScorePayload(state, payload) {
  if (payload.playerId !== state.presenceKey) return 'Score playerId must match the sender.';
  if (!Number.isInteger(payload.score) || payload.score < 0 || payload.score > MAX_GAME_SCORE) {
    return 'Score is outside the allowed range.';
  }
  return null;
}

function validatedMatchQuestions(matchId, questions) {
  if (!Array.isArray(questions) || questions.length !== 5) return null;
  const expected = getQuestionsForMatch(matchId, 5);
  return JSON.stringify(questions) === JSON.stringify(expected) ? expected : null;
}

function callConnectionCount(callback, count) {
  if (typeof callback !== 'function') return;
  try {
    const result = callback(count);
    result?.catch?.(() => {});
  } catch {
    // Metrics callbacks must never take down the realtime service.
  }
}

export function attachRealtimeServer(httpServer, options = {}) {
  if (!httpServer?.on) throw new TypeError('attachRealtimeServer requires a Node HTTP server.');

  const {
    allowedOrigins,
    onConnectionCount,
    path = REALTIME_PATH,
    pingIntervalMs = 15000,
    maxPayload = MAX_MESSAGE_BYTES,
    maxConnections = DEFAULT_MAX_CONNECTIONS,
    maxConnectionsPerIp = DEFAULT_MAX_CONNECTIONS_PER_IP,
    maxMessagesPerMinute = DEFAULT_MAX_MESSAGES_PER_MINUTE,
    matchTicketTtlMs = DEFAULT_MATCH_TICKET_TTL_MS,
    minimumMatchDurationMs = DEFAULT_MINIMUM_MATCH_DURATION_MS,
    questionTransitionMs = DEFAULT_QUESTION_TRANSITION_MS,
    getSessionUserId = async () => null,
  } = options;
  const originAllowlist = allowedOrigins === undefined
    ? null
    : new Set(allowedOrigins.map(normalizedOrigin).filter(Boolean));
  const wss = new WebSocketServer({ noServer: true, maxPayload });
  const topics = new Map();
  const revisions = new Map();
  const recentEvents = new Map();
  const matchTickets = new Map();
  const matchRuns = new Map();
  const ipConnections = new Map();
  let connectionCount = 0;
  let closing = false;

  function membersFor(topic) {
    let members = topics.get(topic);
    if (!members) {
      members = new Set();
      topics.set(topic, members);
    }
    return members;
  }

  function send(state, message) {
    if (state.socket.readyState !== WebSocket.OPEN) return false;
    try {
      state.socket.send(JSON.stringify({ ...message, channelId: state.channelId ?? message.channelId }));
      return true;
    } catch {
      return false;
    }
  }

  function sendError(state, ref, code, message, fatal = false) {
    send(state, { type: 'error', ref, code, message, fatal });
  }

  function presenceSnapshot(topic) {
    const snapshot = Object.create(null);
    for (const member of topics.get(topic) ?? []) {
      if (!member.presence || !member.presenceKey) continue;
      (snapshot[member.presenceKey] ??= []).push(member.presence);
    }
    return snapshot;
  }

  function sendPresence(state) {
    if (!state.topic || !state.presenceEnabled) return;
    send(state, {
      type: 'presence.sync',
      topic: state.topic,
      revision: revisions.get(state.topic) ?? 0,
      state: presenceSnapshot(state.topic),
    });
  }

  function broadcastPresence(topic) {
    for (const member of topics.get(topic) ?? []) sendPresence(member);
  }

  function bumpPresence(topic) {
    revisions.set(topic, (revisions.get(topic) ?? 0) + 1);
    broadcastPresence(topic);
  }

  function issueMatchTickets(topic) {
    const participants = matchParticipants(topic);
    if (!participants) return;
    const tracked = [...(topics.get(topic) ?? [])].filter((member) => member.presence);
    const participantStates = participants.map(
      (playerId) => tracked.find((member) => member.presenceKey === playerId),
    );
    if (participantStates.some((member) => !member)) return;
    const authenticatedUsers = participantStates.map((member) => member.userId).filter(Boolean);
    const ranked = authenticatedUsers.length === participants.length
      && new Set(authenticatedUsers).size === participants.length;

    for (const member of tracked) {
      if (member.matchTicket) continue;
      const ticket = randomBytes(32).toString('base64url');
      const authorization = {
        ticket,
        matchId: topic.slice(MATCH_TOPIC_PREFIX.length),
        playerId: member.presenceKey,
        userId: ranked ? member.userId : null,
        ranked,
        expiresAt: Date.now() + matchTicketTtlMs,
      };
      member.matchTicket = ticket;
      matchTickets.set(ticket, authorization);
      send(member, {
        type: 'match_ticket',
        ticket,
        matchId: authorization.matchId,
        playerId: authorization.playerId,
        ranked: authorization.ranked,
        expiresAt: authorization.expiresAt,
      });
    }
  }

  function broadcastTopic(topic, message, sender = null) {
    for (const member of topics.get(topic) ?? []) {
      if (member === sender && !sender.selfBroadcast) continue;
      send(member, message);
    }
  }

  function leaveTopic(state) {
    if (!state.topic) return;
    const topic = state.topic;
    const hadPresence = Boolean(state.presence);
    const members = topics.get(topic);
    members?.delete(state);
    state.topic = null;
    state.presence = null;
    if (members?.size === 0) {
      topics.delete(topic);
      revisions.delete(topic);
      return;
    }
    if (hadPresence) bumpPresence(topic);
  }

  function cleanupConnection(state) {
    if (state.cleaned) return;
    state.cleaned = true;
    leaveTopic(state);
    connectionCount = Math.max(0, connectionCount - 1);
    const countForIp = Math.max(0, (ipConnections.get(state.ip) ?? 1) - 1);
    if (countForIp) ipConnections.set(state.ip, countForIp);
    else ipConnections.delete(state.ip);
    callConnectionCount(onConnectionCount, connectionCount);
  }

  function partyLeader(topic) {
    const tracked = [...(topics.get(topic) ?? [])]
      .filter((member) => member.presence)
      .sort((a, b) => a.presence.joinedAt - b.presence.joinedAt
        || a.presenceKey.localeCompare(b.presenceKey));
    return tracked.find((member) => member.presence.partyLeader)?.presenceKey
      || tracked[0]?.presenceKey
      || null;
  }

  function handleSubscribe(state, message) {
    if (state.topic) {
      sendError(state, message.ref, 'already_subscribed', 'This socket is already subscribed.', true);
      return;
    }
    if (!isAllowedRealtimeTopic(message.topic)) {
      sendError(state, message.ref, 'invalid_topic', 'Realtime topic is not allowed.', true);
      return;
    }
    if (!validIdentifier(message.channelId, MAX_CHANNEL_ID_LENGTH, WIRE_ID_PATTERN)) {
      sendError(state, message.ref, 'invalid_channel', 'channelId is invalid.', true);
      return;
    }

    const presenceEnabled = Boolean(message.presence);
    const needsPresence = message.topic !== 'stemegle:ranked-stats';
    if (presenceEnabled !== needsPresence) {
      sendError(state, message.ref, 'invalid_presence_mode', 'Presence configuration does not match this topic.', true);
      return;
    }
    if (presenceEnabled && !validIdentifier(
      message.presenceKey,
      MAX_PRESENCE_KEY_LENGTH,
      PRESENCE_KEY_PATTERN,
    )) {
      sendError(state, message.ref, 'invalid_presence_key', 'presenceKey is invalid.', true);
      return;
    }
    const participants = matchParticipants(message.topic);
    if (participants && !participants.includes(message.presenceKey)) {
      sendError(state, message.ref, 'invalid_participant', 'Player is not a participant in this match.', true);
      return;
    }
    if (participants && [...(topics.get(message.topic) ?? [])].some(
      (member) => member.presenceKey === message.presenceKey,
    )) {
      sendError(state, message.ref, 'duplicate_participant', 'This player is already connected.', true);
      return;
    }
    if (message.topic.startsWith(PARTY_TOPIC_PREFIX)) {
      const distinctMembers = new Set(
        [...(topics.get(message.topic) ?? [])].map((member) => member.presenceKey),
      );
      if (!distinctMembers.has(message.presenceKey) && distinctMembers.size >= 32) {
        sendError(state, message.ref, 'party_full', 'This party has reached its player limit.', true);
        return;
      }
    }

    state.channelId = message.channelId;
    state.topic = message.topic;
    state.presenceKey = presenceEnabled ? message.presenceKey : null;
    state.presenceEnabled = presenceEnabled;
    state.selfBroadcast = message.selfBroadcast !== false;
    membersFor(state.topic).add(state);
    send(state, { type: 'subscribed', ref: message.ref, topic: state.topic });
    sendPresence(state);
  }

  function handleTrack(state, message) {
    if (!state.topic || !state.presenceEnabled) {
      sendError(state, message.ref, 'not_subscribed', 'Subscribe with presence before tracking.');
      return;
    }
    const validationError = validatePresence(state.topic, state.presenceKey, message.state);
    if (validationError) {
      sendError(state, message.ref, 'invalid_presence', validationError);
      return;
    }
    if (state.topic.startsWith(PARTY_TOPIC_PREFIX) && message.state.partyLeader) {
      const existingLeader = [...(topics.get(state.topic) ?? [])].find(
        (member) => member !== state
          && member.presence?.partyLeader
          && member.presenceKey !== state.presenceKey,
      );
      if (existingLeader) {
        sendError(state, message.ref, 'leader_claimed', 'This party already has a creator.');
        return;
      }
    }

    // A heartbeat replaces this connection's meta; it must not append forever.
    state.presence = message.state;
    send(state, { type: 'ack', ref: message.ref });
    bumpPresence(state.topic);
    issueMatchTickets(state.topic);
  }

  function handleUntrack(state, message) {
    const topic = state.topic;
    const hadPresence = Boolean(state.presence);
    state.presence = null;
    send(state, { type: 'ack', ref: message.ref });
    if (topic && hadPresence) bumpPresence(topic);
  }

  function eventWasSeen(state, eventId) {
    if (!eventId) return false;
    const now = Date.now();
    const key = `${state.topic}:${eventId}`;
    const previous = recentEvents.get(key);
    recentEvents.set(key, now);
    return previous !== undefined && now - previous < 60000;
  }

  function validateBroadcastSender(state, event, payload) {
    if (!state.presence) return 'Track presence before broadcasting.';

    const participants = matchParticipants(state.topic);
    if (participants) {
      if (event === 'start') {
        if (state.presenceKey !== participants[0]) return 'Only the match host can start the game.';
        if (!Number.isFinite(payload.startsAt)
          || !validatedMatchQuestions(state.topic.slice(MATCH_TOPIC_PREFIX.length), payload.questions)) {
          return 'Match start payload is invalid.';
        }
        const now = Date.now();
        if (payload.startsAt < now - 1000 || payload.startsAt > now + 10_000) {
          return 'Match start time is outside the allowed window.';
        }
        return null;
      }
      if (event === 'answer') {
        if (payload.playerId !== state.presenceKey) return 'Answer playerId must match the sender.';
        const run = matchRuns.get(state.topic.slice(MATCH_TOPIC_PREFIX.length));
        if (!run) return 'The match has not started.';
        if (!Number.isInteger(payload.questionIndex)
          || payload.questionIndex < 0
          || payload.questionIndex >= run.questionCount
          || !Number.isInteger(payload.selected)
          || payload.selected < -1
          || payload.selected > 3) {
          return 'Match answer payload is invalid.';
        }
        const progress = run.progress.get(state.presenceKey);
        if (payload.questionIndex !== progress.nextQuestionIndex) {
          return 'Match answers must be submitted in order.';
        }
        if (Date.now() < progress.questionAvailableAt) {
          return 'This question is not available yet.';
        }
        return null;
      }
      if (event === 'score' || event === 'finish') {
        const scoreError = validateScorePayload(state, payload);
        if (scoreError) return scoreError;
        const run = matchRuns.get(state.topic.slice(MATCH_TOPIC_PREFIX.length));
        if (!run) return 'The match has not started.';
        if (event === 'finish') {
          if (Date.now() < run.startsAt + minimumMatchDurationMs) {
            return 'The match finished before the minimum play window.';
          }
          if ((run.answers.get(state.presenceKey)?.size ?? 0) !== run.questionCount) {
            return 'Every match question must be answered before finishing.';
          }
        }
        return null;
      }
      if (event === 'chat') return validateChatPayload(state, payload);
      if (event === 'ready' && payload.playerId !== state.presenceKey) {
        return 'Ready playerId must match the sender.';
      }
      return null;
    }

    if (state.topic.startsWith(PARTY_TOPIC_PREFIX)) {
      const leader = partyLeader(state.topic);
      if (['party-start', 'party-timeout', 'party-duel-result'].includes(event)
        && state.presenceKey !== leader) {
        return 'Only the party leader can send this event.';
      }
      if (event === 'party-start') {
        const config = payload.config;
        if (!isPlainObject(config)
          || config.leaderId !== leader
          || config.partyCode !== state.topic.slice(PARTY_TOPIC_PREFIX.length)
          || !['team', 'tournament'].includes(config.type)
          || !Number.isFinite(config.startsAt)) {
          return 'Party start payload is invalid.';
        }
      }
      if (event === 'party-answer' || event === 'party-duel-answer') {
        if (payload.playerId !== state.presenceKey) return 'Answer playerId must match the sender.';
      }
      if (event === 'party-chat') return validateChatPayload(state, payload);
    }
    return null;
  }

  function handleBroadcast(state, message) {
    if (!state.topic) {
      sendError(state, message.ref, 'not_subscribed', 'Subscribe before broadcasting.');
      return;
    }
    const allowedEvents = allowedEventsForTopic(state.topic);
    if (!allowedEvents
      || typeof message.event !== 'string'
      || message.event.length === 0
      || message.event.length > MAX_EVENT_LENGTH
      || !allowedEvents.has(message.event)) {
      sendError(state, message.ref, 'invalid_event', 'Broadcast event is not allowed on this topic.');
      return;
    }
    if (!isPlainObject(message.payload)) {
      sendError(state, message.ref, 'invalid_payload', 'Broadcast payload must be an object.');
      return;
    }
    if (jsonBytes(message.payload) > MAX_BROADCAST_PAYLOAD_BYTES) {
      sendError(state, message.ref, 'payload_too_large', 'Broadcast payload is too large.');
      return;
    }
    if (message.eventId !== undefined && !validIdentifier(message.eventId, 100, WIRE_ID_PATTERN)) {
      sendError(state, message.ref, 'invalid_event_id', 'eventId is invalid.');
      return;
    }
    const senderError = validateBroadcastSender(state, message.event, message.payload);
    if (senderError) {
      sendError(state, message.ref, 'forbidden_sender', senderError);
      return;
    }

    const participants = matchParticipants(state.topic);
    if (participants && message.event === 'start') {
      const matchId = state.topic.slice(MATCH_TOPIC_PREFIX.length);
      if (!matchRuns.has(matchId)) {
        matchRuns.set(matchId, {
          participants,
          startsAt: message.payload.startsAt,
          questionCount: message.payload.questions.length,
          questions: validatedMatchQuestions(matchId, message.payload.questions),
          answers: new Map(participants.map((participant) => [participant, new Map()])),
          scores: new Map(participants.map((participant) => [participant, 0])),
          progress: new Map(participants.map((participant) => [participant, {
            nextQuestionIndex: 0,
            questionAvailableAt: message.payload.startsAt,
          }])),
          finishes: new Map(),
          expiresAt: Date.now() + matchTicketTtlMs,
        });
      }
    }
    if (participants && message.event === 'answer') {
      const matchId = state.topic.slice(MATCH_TOPIC_PREFIX.length);
      const run = matchRuns.get(matchId);
      const question = run.questions[message.payload.questionIndex];
      const progress = run.progress.get(state.presenceKey);
      const responseMs = Math.min(15_000, Math.max(0, Date.now() - progress.questionAvailableAt));
      const correct = message.payload.selected === question.answer;
      const remainingSeconds = (15_000 - responseMs) / 1000;
      const gain = correct ? 500 + Math.round(remainingSeconds * 45) : 0;
      run.answers.get(state.presenceKey).set(message.payload.questionIndex, {
        selected: message.payload.selected,
        responseMs,
        correct,
        gain,
      });
      run.scores.set(state.presenceKey, (run.scores.get(state.presenceKey) ?? 0) + gain);
      progress.nextQuestionIndex += 1;
      progress.questionAvailableAt = Date.now() + questionTransitionMs;
    }
    let broadcastPayload = message.payload;
    if (participants && message.event === 'finish') {
      const matchId = state.topic.slice(MATCH_TOPIC_PREFIX.length);
      const run = matchRuns.get(matchId);
      const serverScore = run.scores.get(state.presenceKey) ?? 0;
      run.finishes.set(state.presenceKey, serverScore);
      broadcastPayload = { ...message.payload, score: serverScore };
    }

    send(state, { type: 'ack', ref: message.ref });
    if (eventWasSeen(state, message.eventId)) return;
    broadcastTopic(state.topic, {
      type: 'broadcast',
      topic: state.topic,
      event: message.event,
      payload: broadcastPayload,
      eventId: message.eventId,
    }, state);
  }

  function handleMessage(state, data, isBinary) {
    const now = Date.now();
    if (now - state.messageWindowStartedAt >= 60_000) {
      state.messageWindowStartedAt = now;
      state.messagesInWindow = 0;
    }
    state.messagesInWindow += 1;
    if (state.messagesInWindow > maxMessagesPerMinute) {
      sendError(state, null, 'rate_limited', 'Realtime message rate limit exceeded.', true);
      state.socket.close(1008, 'Rate limit exceeded');
      return;
    }
    if (isBinary) {
      sendError(state, null, 'binary_not_supported', 'Binary realtime messages are not supported.', true);
      state.socket.close(1003, 'Text messages only');
      return;
    }
    if (data.length > maxPayload) {
      state.socket.close(1009, 'Message too large');
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendError(state, null, 'invalid_json', 'Realtime messages must be valid JSON.');
      return;
    }
    if (!isPlainObject(message) || typeof message.type !== 'string') {
      sendError(state, message?.ref, 'invalid_message', 'Realtime message is invalid.');
      return;
    }
    if (message.ref !== undefined && !validIdentifier(message.ref, 100, WIRE_ID_PATTERN)) {
      sendError(state, null, 'invalid_ref', 'Message ref is invalid.');
      return;
    }
    if (message.channelId && state.channelId && message.channelId !== state.channelId) {
      sendError(state, message.ref, 'channel_mismatch', 'channelId does not match this socket.');
      return;
    }

    if (message.type === 'subscribe') handleSubscribe(state, message);
    else if (message.type === 'presence.track') handleTrack(state, message);
    else if (message.type === 'presence.untrack') handleUntrack(state, message);
    else if (message.type === 'broadcast') handleBroadcast(state, message);
    else if (message.type === 'unsubscribe') {
      leaveTopic(state);
      state.socket.close(1000, 'Unsubscribed');
    } else {
      sendError(state, message.ref, 'unknown_message', 'Realtime message type is not supported.');
    }
  }

  wss.on('connection', (socket, request) => {
    const ip = requestIp(request);
    const state = {
      socket,
      ip,
      channelId: null,
      topic: null,
      presenceKey: null,
      presenceEnabled: false,
      presence: null,
      userId: request.realtimeUserId || null,
      selfBroadcast: true,
      isAlive: true,
      cleaned: false,
      messageWindowStartedAt: Date.now(),
      messagesInWindow: 0,
      matchTicket: null,
    };
    socket.realtimeState = state;
    connectionCount += 1;
    ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
    callConnectionCount(onConnectionCount, connectionCount);

    socket.on('pong', () => {
      state.isAlive = true;
    });
    socket.on('message', (data, isBinary) => handleMessage(state, data, isBinary));
    socket.on('close', () => cleanupConnection(state));
    socket.on('error', () => {
      // The close handler owns presence and connection-count cleanup.
    });
  });

  async function handleUpgrade(request, socket, head) {
    let pathname;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== path) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    if (originAllowlist) {
      const rawOrigin = Array.isArray(request.headers.origin)
        ? request.headers.origin[0]
        : request.headers.origin;
      if (!originAllowlist.has(normalizedOrigin(rawOrigin))) {
        rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }
    }
    const ip = requestIp(request);
    if (connectionCount >= maxConnections
      || (ipConnections.get(ip) ?? 0) >= maxConnectionsPerIp) {
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    try {
      request.realtimeUserId = await getSessionUserId(request);
    } catch {
      request.realtimeUserId = null;
    }
    if (socket.destroyed || closing) {
      if (!socket.destroyed) rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }
    if (connectionCount >= maxConnections
      || (ipConnections.get(ip) ?? 0) >= maxConnectionsPerIp) {
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request);
    });
  }

  httpServer.on('upgrade', handleUpgrade);

  const pingTimer = setInterval(() => {
    const expiry = Date.now() - 60000;
    for (const [key, seenAt] of recentEvents) {
      if (seenAt < expiry) recentEvents.delete(key);
    }
    const now = Date.now();
    for (const [ticket, authorization] of matchTickets) {
      if (authorization.expiresAt <= now) matchTickets.delete(ticket);
    }
    for (const [matchId, run] of matchRuns) {
      if (run.expiresAt <= now) matchRuns.delete(matchId);
    }
    for (const socket of wss.clients) {
      const state = socket.realtimeState;
      if (!state?.isAlive) {
        socket.terminate();
        continue;
      }
      state.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, pingIntervalMs);
  pingTimer.unref?.();

  function publishDatabaseChange({ schema = 'public', table, event }) {
    const normalizedEvent = String(event ?? '').toUpperCase();
    if (schema !== 'public' || !DATABASE_TABLES.has(table) || !DATABASE_EVENTS.has(normalizedEvent)) {
      throw new TypeError('Invalid database change notification.');
    }
    broadcastTopic('stemegle:ranked-stats', {
      type: 'db_change',
      schema,
      table,
      event: normalizedEvent,
    });
  }

  function verifyMatchTicket({ ticket, matchId, playerId }) {
    const authorization = matchTickets.get(ticket);
    if (!authorization) return false;
    if (authorization.expiresAt <= Date.now()) {
      matchTickets.delete(ticket);
      return false;
    }
    if (authorization.matchId !== matchId || authorization.playerId !== playerId) return null;
    const run = matchRuns.get(matchId);
    if (!run || run.finishes.size !== run.participants.length) {
      return { ...authorization, pending: true };
    }
    const opponentId = run.participants.find((participant) => participant !== playerId);
    const score = run.scores.get(playerId);
    const opponentScore = run.scores.get(opponentId);
    if (!Number.isInteger(score) || !Number.isInteger(opponentScore)) return null;
    return { ...authorization, pending: false, score, opponentScore };
  }

  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(pingTimer);
    httpServer.off('upgrade', handleUpgrade);
    for (const socket of wss.clients) socket.terminate();
    matchTickets.clear();
    matchRuns.clear();
    await new Promise((resolve) => {
      wss.close(() => resolve());
    });
  }

  return {
    wss,
    publishDatabaseChange,
    broadcastDatabaseChange: publishDatabaseChange,
    close,
    getConnectionCount: () => connectionCount,
    verifyMatchTicket,
    getPresenceCount(topic) {
      return new Set(
        [...(topics.get(topic) ?? [])]
          .filter((member) => member.presence && member.presenceKey)
          .map((member) => member.presenceKey),
      ).size;
    },
  };
}
