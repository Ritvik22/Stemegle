import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ANALYTICS_COOKIE_SECRET = 'test-only-cookie-secret-that-is-at-least-32-bytes';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-role-key';
const {
  buildRpcPayload,
  handleRequest,
  normalizeSource,
  parseUserAgent,
  requestIdentity,
  sanitizePath,
  sanitizeReferrer,
} = await import('./server.mjs');

test('paths never retain query strings, hashes, or protocol-relative values', () => {
  assert.equal(sanitizePath('/party?party=SECRET#token'), '/party');
  assert.equal(sanitizePath('//attacker.example/path'), '/');
  assert.equal(sanitizePath('https://example.com/path'), '/');
});

test('referrers keep useful page identifiers while removing secrets and hashes', () => {
  assert.equal(
    sanitizeReferrer('https://person:secret@www.reddit.com/r/math/?token=secret#comment'),
    'https://www.reddit.com/r/math/',
  );
  assert.equal(sanitizeReferrer('javascript:alert(1)'), '');
  assert.equal(sanitizeReferrer('https://youtube.com/watch?v=abc123&token=secret'), 'https://youtube.com/watch?v=abc123');
});

test('source normalization prefers campaign attribution and recognizes platforms', () => {
  assert.equal(normalizeSource('summer-newsletter', 'google.com'), 'summer-newsletter');
  assert.equal(normalizeSource('', 'm.youtube.com'), 'YouTube');
  assert.equal(normalizeSource('', ''), 'Direct');
});

test('user agent parsing returns coarse device, browser, and OS only', () => {
  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'),
    { device_type: 'Mobile', browser: 'Safari', operating_system: 'iOS' },
  );
  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'),
    { device_type: 'Desktop', browser: 'Chrome', operating_system: 'Windows' },
  );
});

test('RPC payload uses coarse Cloudflare headers and drops sensitive properties', () => {
  const payload = buildRpcPayload({
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
      'cf-ipcountry': 'US',
      'cf-region': 'New York',
      'cf-ipcity': 'New%20York',
      'cf-timezone': 'America/New_York',
    },
  }, {
    event_id: '21b89b6e-dde8-42c2-96c5-ebd5f7d8967f',
    event_name: 'game_started',
    path: '/game?party=SECRET',
    referrer: 'https://www.google.com/search?q=private',
    attribution: { campaign: 'summer-stem' },
    properties: { mode: 'human', game_id: 'game-1', password: 'never-store-me', question: 'also-private' },
  }, {
    visitorId: '3a1622a9-d4a4-4627-bf91-ecf3776ad07e',
    sessionId: 'db3ee29b-3dc5-4827-8c88-9dbdff7150da',
  }, 'aaff70a4-6d1c-4a20-a6d4-1ea8d7dc9fc1');

  assert.equal(payload.p_path, '/game');
  assert.equal(payload.p_referrer_url, 'https://www.google.com/search');
  assert.equal(payload.p_context.source, 'Google');
  assert.equal(payload.p_context.city, 'New York');
  assert.equal(payload.p_context.device_type, 'Desktop');
  assert.equal(payload.p_user_id, 'aaff70a4-6d1c-4a20-a6d4-1ea8d7dc9fc1');
  assert.deepEqual(payload.p_properties, { mode: 'human', game_id: 'game-1' });
  assert.equal(JSON.stringify(payload).includes('SECRET'), false);
  assert.equal(JSON.stringify(payload).includes('never-store-me'), false);
});

test('signed visitor identity persists while the session rotates when the actor changes', () => {
  const baseRequest = { headers: {}, socket: {} };
  const anonymous = requestIdentity(baseRequest, null);
  const cookieHeader = anonymous.cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  const returning = requestIdentity({ headers: { cookie: cookieHeader }, socket: {} }, null);
  const signedIn = requestIdentity({ headers: { cookie: cookieHeader }, socket: {} }, 'aaff70a4-6d1c-4a20-a6d4-1ea8d7dc9fc1');

  assert.equal(returning.visitorId, anonymous.visitorId);
  assert.equal(returning.sessionId, anonymous.sessionId);
  assert.equal(signedIn.visitorId, anonymous.visitorId);
  assert.notEqual(signedIn.sessionId, anonymous.sessionId);
});

test('readiness returns healthy when the database RPC returns true', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
  let statusCode;
  let body;
  const response = {
    writeHead(status) { statusCode = status; },
    end(payload) { body = JSON.parse(payload); },
  };
  try {
    await handleRequest({ url: '/health', method: 'GET', headers: {}, socket: {} }, response);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { ok: true, configured: true });
});
