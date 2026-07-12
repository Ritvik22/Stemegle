import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import WebSocket from 'ws';
import { getQuestionsForMatch } from '../src/data/questions.js';
import { createRealtimeClient } from '../src/lib/realtime.js';
import {
  attachRealtimeServer,
  MAX_BROADCAST_PAYLOAD_BYTES,
  REALTIME_PATH,
} from './realtime.mjs';

const TEST_TIMEOUT_MS = 2000;

class Peer {
  constructor(socket) {
    this.socket = socket;
    this.messages = [];
    this.waiters = new Set();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      for (const waiter of this.waiters) {
        if (!waiter.predicate(message)) continue;
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      this.messages.push(message);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  next(predicate = () => true, timeoutMs = TEST_TIMEOUT_MS) {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Timed out waiting for WebSocket message.'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolve) => this.socket.once('close', resolve));
    this.socket.close();
    await closed;
  }
}

async function openPeer(url, options) {
  const socket = new WebSocket(url, options);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return new Peer(socket);
}

async function trackPeer(peer, channelId, state) {
  const ref = `track-${channelId}`;
  peer.send({
    type: 'presence.track',
    ref,
    channelId,
    state,
  });
  await peer.next((message) => message.type === 'ack' && message.ref === ref);
}

async function answerMatch(peer, channelId, playerId, matchId, correct) {
  const questions = getQuestionsForMatch(matchId);
  let score = 0;
  for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
    const ref = `answer-${channelId}-${questionIndex}`;
    const selected = correct ? questions[questionIndex].answer : -1;
    const responseMs = 15_000;
    if (correct) score += 500;
    peer.send({
      type: 'broadcast',
      ref,
      channelId,
      event: 'answer',
      payload: { playerId, questionIndex, selected, responseMs },
    });
    await peer.next((message) => message.type === 'ack' && message.ref === ref);
  }
  return score;
}

async function createFixture(options = {}) {
  const counts = [];
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const realtime = attachRealtimeServer(server, {
    ...options,
    getSessionUserId: options.getSessionUserId
      || ((request) => request.headers['x-test-user'] || null),
    onConnectionCount(count) {
      counts.push(count);
      options.onConnectionCount?.(count);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `ws://127.0.0.1:${address.port}${REALTIME_PATH}`;
  return {
    counts,
    realtime,
    server,
    url,
    async close() {
      await realtime.close();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function subscription(channelId, topic, presenceKey = null, selfBroadcast = true) {
  return {
    type: 'subscribe',
    ref: `subscribe-${channelId}`,
    channelId,
    topic,
    presence: Boolean(presenceKey),
    presenceKey,
    selfBroadcast,
  };
}

async function waitUntil(predicate, timeoutMs = TEST_TIMEOUT_MS) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('presence heartbeats replace their meta and disconnects clean the roster', async () => {
  const fixture = await createFixture();
  const first = await openPeer(fixture.url);
  const second = await openPeer(fixture.url);
  try {
    first.send(subscription('channel-a', 'stemegle:lobby:v1', 'player-a'));
    second.send(subscription('channel-b', 'stemegle:lobby:v1', 'player-b'));
    await first.next((message) => message.type === 'subscribed');
    await second.next((message) => message.type === 'subscribed');

    first.send({
      type: 'presence.track',
      ref: 'track-a-1',
      channelId: 'channel-a',
      state: { playerId: 'player-a', name: 'Alpha', joinedAt: 10 },
    });
    await first.next((message) => message.type === 'ack' && message.ref === 'track-a-1');
    const firstRoster = await second.next(
      (message) => message.type === 'presence.sync' && message.state['player-a']?.[0]?.name === 'Alpha',
    );

    first.send({
      type: 'presence.track',
      ref: 'track-a-2',
      channelId: 'channel-a',
      state: { playerId: 'player-a', name: 'Alpha Updated', joinedAt: 10 },
    });
    const replaced = await second.next(
      (message) => message.type === 'presence.sync'
        && message.revision > firstRoster.revision
        && message.state['player-a']?.[0]?.name === 'Alpha Updated',
    );
    assert.equal(replaced.state['player-a'].length, 1, 'heartbeat must replace, not append, a meta');

    second.send({
      type: 'presence.track',
      ref: 'track-b',
      channelId: 'channel-b',
      state: { playerId: 'player-b', name: 'Beta', joinedAt: 20 },
    });
    await second.next((message) => message.type === 'ack' && message.ref === 'track-b');
    await second.next(
      (message) => message.type === 'presence.sync'
        && Object.keys(message.state).length === 2
        && message.state['player-a']
        && message.state['player-b'],
    );

    await first.close();
    const afterDisconnect = await second.next(
      (message) => message.type === 'presence.sync'
        && !message.state['player-a']
        && Boolean(message.state['player-b']),
    );
    assert.deepEqual(Object.keys(afterDisconnect.state), ['player-b']);
    assert.ok(fixture.counts.includes(2));
  } finally {
    await second.close();
    await fixture.close();
  }
  assert.equal(fixture.counts.at(-1), 0);
});

test('broadcasts echo to self, reach peers, dedupe event ids, and reject invalid payloads', async () => {
  const fixture = await createFixture();
  const first = await openPeer(fixture.url);
  const second = await openPeer(fixture.url);
  const topic = 'stemegle:match:player-a--player-b';
  try {
    first.send(subscription('match-a', topic, 'player-a', true));
    second.send(subscription('match-b', topic, 'player-b', true));
    await first.next((message) => message.type === 'subscribed');
    await second.next((message) => message.type === 'subscribed');
    await trackPeer(first, 'match-a', { playerId: 'player-a', name: 'Alpha', joinedAt: 10 });
    await trackPeer(second, 'match-b', { playerId: 'player-b', name: 'Beta', joinedAt: 20 });

    first.send({
      type: 'broadcast',
      ref: 'start-before-score',
      channelId: 'match-a',
      event: 'start',
      payload: {
        startsAt: Date.now() + 100,
        questions: getQuestionsForMatch('player-a--player-b'),
      },
    });
    await first.next((message) => message.type === 'ack' && message.ref === 'start-before-score');
    await second.next((message) => message.type === 'broadcast' && message.event === 'start');

    const scoreMessage = {
      type: 'broadcast',
      ref: 'score-1',
      channelId: 'match-a',
      eventId: 'event-score-1',
      event: 'score',
      payload: { playerId: 'player-a', score: 777, questionIndex: 0 },
    };
    first.send(scoreMessage);
    await first.next((message) => message.type === 'ack' && message.ref === 'score-1');
    const selfEcho = await first.next(
      (message) => message.type === 'broadcast' && message.eventId === 'event-score-1',
    );
    const peerEcho = await second.next(
      (message) => message.type === 'broadcast' && message.eventId === 'event-score-1',
    );
    assert.deepEqual(selfEcho.payload, scoreMessage.payload);
    assert.deepEqual(peerEcho.payload, scoreMessage.payload);

    first.send({ ...scoreMessage, ref: 'score-duplicate' });
    await first.next((message) => message.type === 'ack' && message.ref === 'score-duplicate');
    await assert.rejects(
      second.next((message) => message.type === 'broadcast' && message.eventId === 'event-score-1', 100),
      /Timed out/,
    );

    first.send({
      type: 'broadcast',
      ref: 'bad-event',
      channelId: 'match-a',
      event: 'party-start',
      payload: {},
    });
    const eventError = await first.next((message) => message.ref === 'bad-event');
    assert.equal(eventError.code, 'invalid_event');

    first.send({
      type: 'broadcast',
      ref: 'large-payload',
      channelId: 'match-a',
      event: 'chat',
      payload: { text: 'x'.repeat(MAX_BROADCAST_PAYLOAD_BYTES + 1) },
    });
    const payloadError = await first.next((message) => message.ref === 'large-payload');
    assert.equal(payloadError.code, 'payload_too_large');
  } finally {
    await first.close();
    await second.close();
    await fixture.close();
  }
});

test('match topics bind participants, accounts, lifecycle, and host-only events', async () => {
  const fixture = await createFixture({ minimumMatchDurationMs: 0, questionTransitionMs: 0 });
  const host = await openPeer(fixture.url, { headers: { 'x-test-user': 'user-a' } });
  const guest = await openPeer(fixture.url, { headers: { 'x-test-user': 'user-b' } });
  const intruder = await openPeer(fixture.url);
  const topic = 'stemegle:match:player-a--player-b';
  try {
    intruder.send(subscription('match-intruder', topic, 'player-c'));
    const participantError = await intruder.next((message) => message.type === 'error');
    assert.equal(participantError.code, 'invalid_participant');

    host.send(subscription('match-host', topic, 'player-a'));
    guest.send(subscription('match-guest', topic, 'player-b'));
    await host.next((message) => message.type === 'subscribed');
    await guest.next((message) => message.type === 'subscribed');
    await trackPeer(host, 'match-host', { playerId: 'player-a', name: 'Alpha', joinedAt: 10 });
    await trackPeer(guest, 'match-guest', { playerId: 'player-b', name: 'Beta', joinedAt: 20 });
    const hostTicket = await host.next((message) => message.type === 'match_ticket');
    const guestTicket = await guest.next((message) => message.type === 'match_ticket');
    assert.notEqual(hostTicket.ticket, guestTicket.ticket);
    const authorization = fixture.realtime.verifyMatchTicket({
      ticket: hostTicket.ticket,
      matchId: 'player-a--player-b',
      playerId: 'player-a',
    });
    assert.equal(authorization.userId, 'user-a');
    assert.equal(authorization.ranked, true);
    assert.equal(authorization.pending, true);
    assert.equal(fixture.realtime.verifyMatchTicket({
      ticket: hostTicket.ticket,
      matchId: 'player-a--player-b',
      playerId: 'player-b',
    }), null);

    guest.send({
      type: 'broadcast',
      ref: 'guest-start',
      channelId: 'match-guest',
      event: 'start',
      payload: {
        startsAt: Date.now() + 1000,
        questions: getQuestionsForMatch('player-a--player-b'),
      },
    });
    const startError = await guest.next((message) => message.ref === 'guest-start');
    assert.equal(startError.code, 'forbidden_sender');

    guest.send({
      type: 'broadcast',
      ref: 'spoofed-score',
      channelId: 'match-guest',
      event: 'score',
      payload: { playerId: 'player-a', score: 100, questionIndex: 0 },
    });
    const scoreError = await guest.next((message) => message.ref === 'spoofed-score');
    assert.equal(scoreError.code, 'forbidden_sender');

    host.send({
      type: 'broadcast',
      ref: 'host-start',
      channelId: 'match-host',
      event: 'start',
      payload: {
        startsAt: Date.now() + 50,
        questions: getQuestionsForMatch('player-a--player-b'),
      },
    });
    await host.next((message) => message.type === 'ack' && message.ref === 'host-start');
    const start = await guest.next((message) => message.type === 'broadcast' && message.event === 'start');
    assert.equal(start.payload.questions.length, 5);

    host.send({
      type: 'broadcast',
      ref: 'out-of-order-answer',
      channelId: 'match-host',
      event: 'answer',
      payload: { playerId: 'player-a', questionIndex: 1, selected: 0, responseMs: 0 },
    });
    const orderError = await host.next((message) => message.ref === 'out-of-order-answer');
    assert.equal(orderError.code, 'forbidden_sender');

    host.send({
      type: 'broadcast',
      ref: 'answer-before-start',
      channelId: 'match-host',
      event: 'answer',
      payload: { playerId: 'player-a', questionIndex: 0, selected: 0, responseMs: 0 },
    });
    const timingError = await host.next((message) => message.ref === 'answer-before-start');
    assert.equal(timingError.code, 'forbidden_sender');
    await new Promise((resolve) => setTimeout(resolve, 60));

    guest.send({
      type: 'broadcast',
      ref: 'premature-finish',
      channelId: 'match-guest',
      event: 'finish',
      payload: { playerId: 'player-b', score: 0 },
    });
    const prematureFinish = await guest.next((message) => message.ref === 'premature-finish');
    assert.equal(prematureFinish.code, 'forbidden_sender');

    const hostScore = await answerMatch(
      host,
      'match-host',
      'player-a',
      'player-a--player-b',
      true,
    );
    const guestScore = await answerMatch(
      guest,
      'match-guest',
      'player-b',
      'player-a--player-b',
      false,
    );

    guest.send({
      type: 'broadcast',
      ref: 'guest-finish',
      channelId: 'match-guest',
      event: 'finish',
      payload: { playerId: 'player-b', score: guestScore },
    });
    await guest.next((message) => message.type === 'ack' && message.ref === 'guest-finish');
    host.send({
      type: 'broadcast',
      ref: 'host-finish',
      channelId: 'match-host',
      event: 'finish',
      payload: { playerId: 'player-a', score: hostScore },
    });
    await host.next((message) => message.type === 'ack' && message.ref === 'host-finish');
    const completedAuthorization = fixture.realtime.verifyMatchTicket({
      ticket: hostTicket.ticket,
      matchId: 'player-a--player-b',
      playerId: 'player-a',
    });
    assert.equal(completedAuthorization.pending, false);
    assert.ok(completedAuthorization.score > 0 && completedAuthorization.score <= 5875);
    assert.equal(completedAuthorization.opponentScore, 0);
  } finally {
    await host.close();
    await guest.close();
    await intruder.close();
    await fixture.close();
  }
});

test('one account cannot manufacture a ranked match or duplicate a participant', async () => {
  const fixture = await createFixture();
  const first = await openPeer(fixture.url, { headers: { 'x-test-user': 'same-user' } });
  const second = await openPeer(fixture.url, { headers: { 'x-test-user': 'same-user' } });
  const duplicate = await openPeer(fixture.url, { headers: { 'x-test-user': 'another-user' } });
  const topic = 'stemegle:match:player-a--player-b';
  try {
    first.send(subscription('same-account-a', topic, 'player-a'));
    await first.next((message) => message.type === 'subscribed');

    duplicate.send(subscription('duplicate-player', topic, 'player-a'));
    const duplicateError = await duplicate.next((message) => message.type === 'error');
    assert.equal(duplicateError.code, 'duplicate_participant');

    second.send(subscription('same-account-b', topic, 'player-b'));
    await second.next((message) => message.type === 'subscribed');
    await trackPeer(first, 'same-account-a', { playerId: 'player-a', name: 'Alpha', joinedAt: 10 });
    await trackPeer(second, 'same-account-b', { playerId: 'player-b', name: 'Beta', joinedAt: 20 });
    const firstTicket = await first.next((message) => message.type === 'match_ticket');
    const authorization = fixture.realtime.verifyMatchTicket({
      ticket: firstTicket.ticket,
      matchId: 'player-a--player-b',
      playerId: 'player-a',
    });
    assert.equal(firstTicket.ranked, false);
    assert.equal(authorization.ranked, false);
    assert.equal(authorization.userId, null);
  } finally {
    await first.close();
    await second.close();
    await duplicate.close();
    await fixture.close();
  }
});

test('browser-compatible channels expose server-issued match authorization', async () => {
  const fixture = await createFixture();
  const options = {
    url: fixture.url,
    WebSocketImpl: WebSocket,
    reconnectDelayMs: 20,
    subscribeTimeoutMs: 500,
    ackTimeoutMs: 500,
  };
  const firstClient = createRealtimeClient(options);
  const secondClient = createRealtimeClient(options);
  const firstStatuses = [];
  const secondStatuses = [];
  const first = firstClient.channel('stemegle:match:client-a--client-b', {
    config: { presence: { key: 'client-a' } },
  });
  const second = secondClient.channel('stemegle:match:client-a--client-b', {
    config: { presence: { key: 'client-b' } },
  });
  first.subscribe((status) => firstStatuses.push(status));
  second.subscribe((status) => secondStatuses.push(status));
  try {
    await waitUntil(() => firstStatuses.includes('SUBSCRIBED') && secondStatuses.includes('SUBSCRIBED'));
    assert.equal(await first.track({ playerId: 'client-a', name: 'Alpha', joinedAt: 1 }), 'ok');
    assert.equal(await second.track({ playerId: 'client-b', name: 'Beta', joinedAt: 2 }), 'ok');
    await waitUntil(() => first.matchAuthorization() && second.matchAuthorization());
    assert.deepEqual(
      {
        matchId: first.matchAuthorization().matchId,
        playerId: first.matchAuthorization().playerId,
      },
      { matchId: 'client-a--client-b', playerId: 'client-a' },
    );
    assert.notEqual(first.matchAuthorization().ticket, second.matchAuthorization().ticket);
    assert.equal(first.matchAuthorization().ranked, false);
  } finally {
    await firstClient.removeAllChannels();
    await secondClient.removeAllChannels();
    await fixture.close();
  }
});

test('party leader and sender-bound events cannot be impersonated', async () => {
  const fixture = await createFixture();
  const leader = await openPeer(fixture.url);
  const member = await openPeer(fixture.url);
  const topic = 'stemegle:party:ABCDE';
  try {
    leader.send(subscription('party-leader', topic, 'leader-id'));
    member.send(subscription('party-member', topic, 'member-id'));
    await leader.next((message) => message.type === 'subscribed');
    await member.next((message) => message.type === 'subscribed');
    await trackPeer(leader, 'party-leader', {
      playerId: 'leader-id',
      name: 'Leader',
      joinedAt: 10,
      lastSeen: 10,
      partyLeader: true,
    });
    await trackPeer(member, 'party-member', {
      playerId: 'member-id',
      name: 'Member',
      joinedAt: 20,
      lastSeen: 20,
      partyLeader: false,
    });

    member.send({
      type: 'broadcast',
      ref: 'member-start',
      channelId: 'party-member',
      event: 'party-start',
      payload: {
        config: {
          type: 'team',
          partyCode: 'ABCDE',
          leaderId: 'leader-id',
          startsAt: Date.now() + 1000,
        },
      },
    });
    assert.equal(
      (await member.next((message) => message.ref === 'member-start')).code,
      'forbidden_sender',
    );

    member.send({
      type: 'broadcast',
      ref: 'spoofed-answer',
      channelId: 'party-member',
      event: 'party-answer',
      payload: { playerId: 'leader-id', roundId: 'round-1' },
    });
    assert.equal(
      (await member.next((message) => message.ref === 'spoofed-answer')).code,
      'forbidden_sender',
    );

    leader.send({
      type: 'broadcast',
      ref: 'leader-timeout',
      channelId: 'party-leader',
      event: 'party-timeout',
      payload: { playerId: 'member-id', roundId: 'round-1' },
    });
    await leader.next((message) => message.type === 'ack' && message.ref === 'leader-timeout');
    const timeout = await member.next(
      (message) => message.type === 'broadcast' && message.event === 'party-timeout',
    );
    assert.equal(timeout.payload.playerId, 'member-id');
  } finally {
    await leader.close();
    await member.close();
    await fixture.close();
  }
});

test('upgrade path, origin, and per-connection message rate are enforced', async () => {
  const fixture = await createFixture({
    allowedOrigins: ['https://stemegle.example'],
    maxMessagesPerMinute: 2,
  });
  try {
    await assert.rejects(openPeer(`${fixture.url}-wrong`, { origin: 'https://stemegle.example' }), /404/);
    await assert.rejects(openPeer(fixture.url, { origin: 'https://attacker.example' }), /403/);

    const peer = await openPeer(fixture.url, { origin: 'https://stemegle.example' });
    try {
      peer.send(subscription('limited-channel', 'stemegle:lobby:v1', 'limited-player'));
      await peer.next((message) => message.type === 'subscribed');
      peer.send({ type: 'unknown', ref: 'unknown-one' });
      await peer.next((message) => message.ref === 'unknown-one');
      peer.send({ type: 'unknown', ref: 'unknown-two' });
      const limited = await peer.next((message) => message.code === 'rate_limited');
      assert.equal(limited.fatal, true);
    } finally {
      await peer.close();
    }
  } finally {
    await fixture.close();
  }
});

test('topic validation and ranked-stat invalidation are explicit', async () => {
  const fixture = await createFixture();
  const invalid = await openPeer(fixture.url);
  const stats = await openPeer(fixture.url);
  try {
    invalid.send(subscription('bad-channel', 'anything:goes', 'player-a'));
    const invalidTopic = await invalid.next((message) => message.type === 'error');
    assert.equal(invalidTopic.code, 'invalid_topic');
    assert.equal(invalidTopic.fatal, true);

    stats.send(subscription('stats-channel', 'stemegle:ranked-stats'));
    await stats.next((message) => message.type === 'subscribed');
    fixture.realtime.publishDatabaseChange({ table: 'matches', event: 'insert' });
    const change = await stats.next((message) => message.type === 'db_change');
    assert.deepEqual(
      { schema: change.schema, table: change.table, event: change.event },
      { schema: 'public', table: 'matches', event: 'INSERT' },
    );
    assert.throws(
      () => fixture.realtime.publishDatabaseChange({ table: 'private_data', event: 'INSERT' }),
      /Invalid database change/,
    );
  } finally {
    await invalid.close();
    await stats.close();
    await fixture.close();
  }
});

test('browser-compatible client reconnects, resubscribes, and retracks presence', async () => {
  const fixture = await createFixture();
  const statuses = [];
  const client = createRealtimeClient({
    url: fixture.url,
    WebSocketImpl: WebSocket,
    reconnectDelayMs: 20,
    maxReconnectDelayMs: 40,
    subscribeTimeoutMs: 500,
    ackTimeoutMs: 500,
  });
  const channel = client.channel('stemegle:lobby:v1', {
    config: { presence: { key: 'client-player' } },
  });
  let syncCount = 0;
  channel
    .on('presence', { event: 'sync' }, () => {
      syncCount += 1;
    })
    .subscribe((status) => statuses.push(status));

  try {
    await waitUntil(() => statuses.includes('SUBSCRIBED'));
    assert.equal(await channel.track({
      playerId: 'client-player',
      name: 'Reconnectable',
      joinedAt: 100,
    }), 'ok');
    await waitUntil(() => channel.presenceState()['client-player']?.[0]?.name === 'Reconnectable');

    const firstSocket = [...fixture.realtime.wss.clients][0];
    firstSocket.terminate();
    await waitUntil(() => statuses.filter((status) => status === 'SUBSCRIBED').length >= 2);
    await waitUntil(() => channel.presenceState()['client-player']?.[0]?.name === 'Reconnectable');
    assert.ok(syncCount >= 2);

    await client.removeChannel(channel);
    await waitUntil(() => fixture.realtime.getConnectionCount() === 0);
    const subscribedCount = statuses.filter((status) => status === 'SUBSCRIBED').length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(statuses.filter((status) => status === 'SUBSCRIBED').length, subscribedCount);
  } finally {
    await client.removeAllChannels();
    await fixture.close();
  }
});

test('ping/pong terminates a dead connection and removes its presence', async () => {
  const fixture = await createFixture({ pingIntervalMs: 20 });
  const live = await openPeer(fixture.url);
  const dead = await openPeer(fixture.url, { autoPong: false });
  try {
    live.send(subscription('live-channel', 'stemegle:lobby:v1', 'live-player'));
    dead.send(subscription('dead-channel', 'stemegle:lobby:v1', 'dead-player'));
    await live.next((message) => message.type === 'subscribed');
    await dead.next((message) => message.type === 'subscribed');
    live.send({
      type: 'presence.track',
      ref: 'live-track',
      channelId: 'live-channel',
      state: { playerId: 'live-player', name: 'Live', joinedAt: 1 },
    });
    dead.send({
      type: 'presence.track',
      ref: 'dead-track',
      channelId: 'dead-channel',
      state: { playerId: 'dead-player', name: 'Dead', joinedAt: 2 },
    });
    await dead.next((message) => message.type === 'ack' && message.ref === 'dead-track');
    await live.next(
      (message) => message.type === 'presence.sync'
        && message.state['live-player']
        && message.state['dead-player'],
    );

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Dead socket was not terminated.')), 500);
      dead.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const cleaned = await live.next(
      (message) => message.type === 'presence.sync'
        && message.state['live-player']
        && !message.state['dead-player'],
    );
    assert.deepEqual(Object.keys(cleaned.state), ['live-player']);
  } finally {
    await live.close();
    await dead.close();
    await fixture.close();
  }
});
