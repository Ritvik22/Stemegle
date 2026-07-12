import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAnalyticsPayload,
  normalizeSource,
  parseUserAgent,
  requestIdentity,
  sanitizePath,
  sanitizeReferrer,
  shouldSkipAnalyticsRequest,
} from './analytics.mjs';

const VISITOR_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

function request(headers = {}) {
  return {
    headers,
    socket: { encrypted: false },
  };
}

test('paths and referrers discard unsafe or sensitive input', () => {
  assert.equal(sanitizePath('/game?token=secret#answer'), '/game');
  assert.equal(sanitizePath('//attacker.example/path'), '/');
  assert.equal(sanitizePath('https://attacker.example'), '/');

  const referrer = sanitizeReferrer(
    'https://www.google.com/search?q=private&utm_source=google&campaign=launch#fragment',
  );
  const parsed = new URL(referrer);
  assert.equal(parsed.hostname, 'www.google.com');
  assert.equal(parsed.searchParams.get('utm_source'), 'google');
  assert.equal(parsed.searchParams.get('campaign'), 'launch');
  assert.equal(parsed.searchParams.has('q'), false);
  assert.equal(parsed.hash, '');
});

test('privacy signals and admin paths are rejected server-side', () => {
  assert.equal(shouldSkipAnalyticsRequest(request({ dnt: '1' }), { path: '/' }), true);
  assert.equal(shouldSkipAnalyticsRequest(request({ 'sec-gpc': '1' }), { path: '/' }), true);
  assert.equal(shouldSkipAnalyticsRequest(request(), { path: '/admin?tab=users' }), true);
  assert.equal(shouldSkipAnalyticsRequest(request(), { path: '/game' }), false);
});

test('source and user-agent normalization stays coarse', () => {
  assert.equal(normalizeSource('', 'news.ycombinator.com'), 'news.ycombinator.com');
  assert.equal(normalizeSource('', 'm.youtube.com'), 'YouTube');
  assert.equal(normalizeSource('school-newsletter', 'google.com'), 'school-newsletter');

  assert.deepEqual(
    parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'),
    { device_type: 'Mobile', browser: 'Safari', operating_system: 'iOS' },
  );
  assert.equal(parseUserAgent('ExampleBot/1.0').device_type, 'Bot');
});

test('analytics payloads accept allowlisted context and properties only', () => {
  const payload = buildAnalyticsPayload(request({
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0',
    'cf-ipcountry': 'US',
    'cf-region': 'California',
    'cf-ipcity': 'San Jose',
    'cf-timezone': 'America/Los_Angeles',
  }), {
    event_id: EVENT_ID,
    event_name: 'game_completed',
    path: '/results?auth=secret',
    referrer: 'https://discord.com/channels/123?utm_source=discord&token=secret',
    attribution: { source: '', medium: 'social', campaign: 'launch' },
    properties: {
      mode: 'human',
      score: 4500,
      persisted: true,
      private_answer: 'never store this',
    },
  }, { visitorId: VISITOR_ID, sessionId: SESSION_ID }, USER_ID);

  assert.equal(payload.path, '/results');
  assert.equal(payload.context.source, 'Discord');
  assert.equal(payload.context.country_code, 'US');
  assert.equal(payload.context.device_type, 'Desktop');
  assert.deepEqual(payload.properties, { mode: 'human', score: 4500, persisted: true });
  assert.equal(payload.referrer.includes('token='), false);
});

test('signed cookies keep first-auth journeys together and isolate later actor changes', () => {
  const anonymous = requestIdentity(request(), null);
  const cookie = anonymous.cookies.map((header) => header.split(';')[0]).join('; ');
  const repeatAnonymous = requestIdentity(request({ cookie }), null);
  const authenticated = requestIdentity(request({ cookie }), USER_ID);
  const authenticatedCookie = authenticated.cookies.map((header) => header.split(';')[0]).join('; ');
  const signedOut = requestIdentity(request({ cookie: authenticatedCookie }), null);

  assert.equal(repeatAnonymous.visitorId, anonymous.visitorId);
  assert.equal(repeatAnonymous.sessionId, anonymous.sessionId);
  assert.equal(authenticated.visitorId, anonymous.visitorId);
  assert.equal(authenticated.sessionId, anonymous.sessionId);
  assert.equal(signedOut.visitorId, anonymous.visitorId);
  assert.notEqual(signedOut.sessionId, authenticated.sessionId);
});

test('unsupported event names are rejected', () => {
  assert.throws(() => buildAnalyticsPayload(request(), {
    event_id: EVENT_ID,
    event_name: 'password_captured',
    path: '/',
  }, { visitorId: VISITOR_ID, sessionId: SESSION_ID }), /Unsupported analytics event/);
});
