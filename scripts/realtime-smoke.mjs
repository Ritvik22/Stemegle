import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createRealtimeClient } from '../src/lib/realtime.js';

const baseUrl = new URL(process.env.STEMEGLE_URL || 'http://127.0.0.1:8787');
const socketUrl = new URL('/api/realtime', baseUrl);
socketUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';

function client() {
  return createRealtimeClient({
    url: socketUrl,
    webSocketFactory: (url) => new WebSocket(url, { origin: baseUrl.origin }),
    subscribeTimeoutMs: 5000,
    ackTimeoutMs: 5000,
  });
}

async function waitUntil(predicate, message, timeoutMs = 10_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const firstClient = client();
const secondClient = client();
const firstKey = randomUUID();
const secondKey = randomUUID();
const firstStatuses = [];
const secondStatuses = [];
const first = firstClient.channel('stemegle:visitors', {
  config: { presence: { key: firstKey } },
});
const second = secondClient.channel('stemegle:visitors', {
  config: { presence: { key: secondKey } },
});

first.subscribe((status) => firstStatuses.push(status));
second.subscribe((status) => secondStatuses.push(status));

try {
  await waitUntil(
    () => firstStatuses.includes('SUBSCRIBED') && secondStatuses.includes('SUBSCRIBED'),
    'Realtime peers did not subscribe',
  );
  if (await first.track({ joinedAt: Date.now() }) !== 'ok') {
    throw new Error('First realtime peer could not track presence');
  }
  if (await second.track({ joinedAt: Date.now() }) !== 'ok') {
    throw new Error('Second realtime peer could not track presence');
  }
  await waitUntil(
    () => first.presenceState()[firstKey] && first.presenceState()[secondKey],
    'Realtime presence roster did not converge',
  );
  console.log('REALTIME_SMOKE_OK: two peers subscribed and synchronized presence');
} finally {
  await Promise.allSettled([
    firstClient.removeAllChannels(),
    secondClient.removeAllChannels(),
  ]);
}
