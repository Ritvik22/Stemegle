import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANALYTICS_COOKIE_SECRET = process.env.ANALYTICS_COOKIE_SECRET || '';
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_PER_MINUTE = 180;
const VISITOR_COOKIE = 'stemegle_av';
const SESSION_COOKIE = 'stemegle_as';
const ACTOR_COOKIE = 'stemegle_aa';
const VISITOR_MAX_AGE = 60 * 60 * 24 * 180;
const SESSION_MAX_AGE = 60 * 30;
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && ANALYTICS_COOKIE_SECRET.length >= 32);

const ALLOWED_EVENTS = new Set([
  'session_started',
  'session_heartbeat',
  'page_view',
  'signup_started',
  'signup_succeeded',
  'login_succeeded',
  'queue_started',
  'queue_connected',
  'opponent_found',
  'queue_abandoned',
  'bot_selected',
  'game_started',
  'game_question_answered',
  'game_completed',
  'game_abandoned',
  'opponent_disconnected',
  'party_created',
  'party_join_requested',
  'party_joined',
  'party_left',
  'party_game_started',
  'result_viewed',
]);

const PROPERTY_KEYS = new Set([
  'mode',
  'game_id',
  'attempt_id',
  'round',
  'total_rounds',
  'category',
  'correct',
  'timed_out',
  'response_ms',
  'score',
  'opponent_score',
  'outcome',
  'wait_seconds',
  'status',
  'destination',
  'reason',
  'party_size',
  'game_type',
  'persisted',
  'recovered',
]);

const rateBuckets = new Map();

function safeText(value, maxLength = 240) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

export function sanitizePath(value) {
  const path = safeText(value, 240);
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path.split('?')[0].split('#')[0].slice(0, 240) || '/';
}

export function sanitizeReferrer(value) {
  const referrer = safeText(value, 1200);
  if (!referrer) return '';
  try {
    const url = new URL(referrer);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (!/^(utm_(source|medium|campaign|term|content)|ref|source|campaign|v|t|context)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.toString().slice(0, 1000);
  } catch {
    return '';
  }
}

function referrerHost(referrer) {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeSource(utmSource, host) {
  const campaignSource = safeText(utmSource, 120);
  if (campaignSource) return campaignSource;
  if (!host) return 'Direct';
  const sources = [
    ['google.', 'Google'],
    ['bing.com', 'Bing'],
    ['duckduckgo.com', 'DuckDuckGo'],
    ['youtube.com', 'YouTube'],
    ['youtu.be', 'YouTube'],
    ['instagram.com', 'Instagram'],
    ['tiktok.com', 'TikTok'],
    ['facebook.com', 'Facebook'],
    ['fb.com', 'Facebook'],
    ['twitter.com', 'X'],
    ['x.com', 'X'],
    ['reddit.com', 'Reddit'],
    ['linkedin.com', 'LinkedIn'],
    ['discord.com', 'Discord'],
    ['github.com', 'GitHub'],
  ];
  return sources.find(([needle]) => host.includes(needle))?.[1] || host;
}

export function parseUserAgent(userAgent = '') {
  const ua = safeText(userAgent, 600);
  const isBot = /bot|crawler|spider|headless|lighthouse|preview/i.test(ua);
  const deviceType = isBot
    ? 'Bot'
    : /ipad|tablet|kindle|silk/i.test(ua)
      ? 'Tablet'
      : /mobi|iphone|android/i.test(ua)
        ? 'Mobile'
        : 'Desktop';

  let browser = 'Unknown';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua)) browser = 'Opera';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/crios\//i.test(ua)) browser = 'Chrome';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua)) browser = 'Safari';

  let operatingSystem = 'Unknown';
  if (/windows nt/i.test(ua)) operatingSystem = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) operatingSystem = 'iOS';
  else if (/android/i.test(ua)) operatingSystem = 'Android';
  else if (/cros/i.test(ua)) operatingSystem = 'ChromeOS';
  else if (/mac os x|macintosh/i.test(ua)) operatingSystem = 'macOS';
  else if (/linux/i.test(ua)) operatingSystem = 'Linux';

  return { device_type: deviceType, browser, operating_system: operatingSystem };
}

function safeHeader(req, name, maxLength = 160) {
  const raw = safeText(req.headers[name], maxLength);
  if (!raw) return '';
  try {
    return safeText(decodeURIComponent(raw), maxLength);
  } catch {
    return raw;
  }
}

function sanitizeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => PROPERTY_KEYS.has(key))
      .map(([key, item]) => {
        if (typeof item === 'string') return [key, safeText(item, 240)];
        if (typeof item === 'number' && Number.isFinite(item)) return [key, item];
        if (typeof item === 'boolean') return [key, item];
        return [key, null];
      })
      .filter(([, item]) => item !== null),
  );
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    if (index === -1) return ['', ''];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

function signCookieValue(value) {
  const signature = createHmac('sha256', ANALYTICS_COOKIE_SECRET).update(value).digest('base64url');
  return `${Buffer.from(value).toString('base64url')}.${signature}`;
}

function verifyCookieValue(signedValue) {
  if (!signedValue || !ANALYTICS_COOKIE_SECRET) return '';
  const [encoded, suppliedSignature] = String(signedValue).split('.');
  if (!encoded || !suppliedSignature) return '';
  let value;
  try {
    value = Buffer.from(encoded, 'base64url').toString();
  } catch {
    return '';
  }
  const expected = createHmac('sha256', ANALYTICS_COOKIE_SECRET).update(value).digest();
  let supplied;
  try {
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return '';
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? value : '';
}

function cookieHeader(req, name, value, maxAge) {
  const forwardedProto = safeText(req.headers['x-forwarded-proto'], 20);
  const forwardedHost = safeText(req.headers['x-forwarded-host'] || req.headers.host, 255).split(':')[0];
  const localHost = !forwardedHost || forwardedHost === 'localhost' || forwardedHost === '127.0.0.1' || forwardedHost === '::1';
  const secure = forwardedProto === 'https' || req.socket.encrypted || !localHost;
  return `${name}=${signCookieValue(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function requestIdentity(req, userId) {
  const cookies = parseCookies(req);
  const existingVisitor = verifyCookieValue(cookies[VISITOR_COOKIE]);
  const existingSession = verifyCookieValue(cookies[SESSION_COOKIE]);
  const existingActor = verifyCookieValue(cookies[ACTOR_COOKIE]);
  const actor = userId || 'anonymous';
  const visitorId = isUuid(existingVisitor) ? existingVisitor : randomUUID();
  const sessionId = isUuid(existingSession) && existingActor === actor ? existingSession : randomUUID();
  return {
    visitorId,
    sessionId,
    cookies: [
      cookieHeader(req, VISITOR_COOKIE, visitorId, VISITOR_MAX_AGE),
      cookieHeader(req, SESSION_COOKIE, sessionId, SESSION_MAX_AGE),
      cookieHeader(req, ACTOR_COOKIE, actor, SESSION_MAX_AGE),
    ],
  };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = safeText(req.headers['x-forwarded-host'] || req.headers.host, 255);
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function withinRateLimit(req) {
  const key = safeText(
    req.headers['cf-connecting-ip']
      || req.headers['x-real-ip']
      || req.socket.remoteAddress
      || 'unknown',
    100,
  );
  const minute = Math.floor(Date.now() / 60000);
  const current = rateBuckets.get(key);
  if (!current || current.minute !== minute) {
    rateBuckets.set(key, { minute, count: 1 });
    if (rateBuckets.size > 5000) {
      for (const [bucketKey, bucket] of rateBuckets) {
        if (bucket.minute < minute - 1) rateBuckets.delete(bucketKey);
      }
    }
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_PER_MINUTE;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

export function buildRpcPayload(req, body, identity = {}, userId = null) {
  if (!isUuid(body.event_id) || !isUuid(identity.visitorId) || !isUuid(identity.sessionId)) {
    throw Object.assign(new Error('Invalid analytics identifiers'), { statusCode: 400 });
  }
  if (!ALLOWED_EVENTS.has(body.event_name)) {
    throw Object.assign(new Error('Unsupported analytics event'), { statusCode: 400 });
  }

  const path = sanitizePath(body.path);
  const referrer = sanitizeReferrer(body.referrer);
  const host = referrerHost(referrer);
  const attribution = body.attribution && typeof body.attribution === 'object' ? body.attribution : {};
  const device = parseUserAgent(req.headers['user-agent']);
  const utmSource = safeText(attribution.source, 120);

  return {
    p_event_id: body.event_id,
    p_visitor_id: identity.visitorId,
    p_session_id: identity.sessionId,
    p_user_id: userId,
    p_event_name: body.event_name,
    p_path: path,
    p_referrer_url: referrer || null,
    p_context: {
      referrer_host: host || null,
      source: normalizeSource(utmSource, host),
      medium: safeText(attribution.medium, 120) || null,
      campaign: safeText(attribution.campaign, 240) || null,
      term: safeText(attribution.term, 240) || null,
      content: safeText(attribution.content, 240) || null,
      country_code: safeHeader(req, 'cf-ipcountry', 8) || null,
      region: safeHeader(req, 'cf-region', 160) || null,
      city: safeHeader(req, 'cf-ipcity', 160) || null,
      timezone: safeHeader(req, 'cf-timezone', 120) || null,
      ...device,
    },
    p_properties: sanitizeProperties(body.properties),
  };
}

async function callSupabaseRpc(name, payload, { minimal = false } = {}) {
  if (!isConfigured) {
    throw Object.assign(new Error('Analytics service is not configured'), { statusCode: 503 });
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(minimal ? { prefer: 'return=minimal' } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw Object.assign(new Error('Analytics storage rejected the event'), { statusCode: 502 });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function verifiedUserId(req) {
  const authorization = safeText(req.headers.authorization, 4096);
  if (!authorization.startsWith('Bearer ')) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization,
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const user = await response.json();
    return isUuid(user?.id) ? user.id : null;
  } catch {
    return null;
  }
}

export async function handleRequest(req, res) {
  if (req.url === '/health' || req.url === '/api/analytics/health') {
    if (!isConfigured) {
      sendJson(res, 503, { ok: false, configured: false });
      return;
    }
    try {
      const ready = await callSupabaseRpc('analytics_ingest_ready', {});
      sendJson(res, ready === true ? 200 : 503, { ok: ready === true, configured: true });
    } catch {
      sendJson(res, 503, { ok: false, configured: true });
    }
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const isEventRequest = req.method === 'POST' && req.url === '/api/analytics/events';
  const isSignupTokenRequest = req.method === 'POST' && req.url === '/api/analytics/signup-token';
  if (!isEventRequest && !isSignupTokenRequest) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: 'Cross-origin analytics requests are not accepted' });
    return;
  }
  if (!withinRateLimit(req)) {
    sendJson(res, 429, { error: 'Too many analytics requests' });
    return;
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendJson(res, 415, { error: 'JSON is required' });
    return;
  }

  try {
    const body = await readJson(req);
    const userId = await verifiedUserId(req);
    const identity = requestIdentity(req, userId);
    const responseHeaders = { 'set-cookie': identity.cookies };
    if (isSignupTokenRequest) {
      if (userId) {
        sendJson(res, 403, { error: 'Signup attribution is only issued before authentication' });
        return;
      }
      const token = randomUUID();
      await callSupabaseRpc('issue_analytics_signup_token', {
        p_token: token,
        p_visitor_id: identity.visitorId,
        p_session_id: identity.sessionId,
      }, { minimal: true });
      sendJson(res, 201, { token }, responseHeaders);
      return;
    }
    const payload = buildRpcPayload(req, body, identity, userId);
    await callSupabaseRpc('ingest_analytics_event', payload, { minimal: true });
    sendJson(res, 202, { accepted: true }, responseHeaders);
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    if (statusCode >= 500) console.error(`[analytics] ${error.message}`);
    sendJson(res, statusCode, { error: statusCode >= 500 ? 'Analytics is temporarily unavailable' : error.message });
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  createServer(handleRequest).listen(PORT, '0.0.0.0', () => {
    console.log(`[analytics] listening on ${PORT}`);
  });
  if (isConfigured) {
    const purge = () => callSupabaseRpc('purge_expired_analytics', { p_retention_days: 400 }, { minimal: true })
      .catch((error) => console.error(`[analytics] retention cleanup failed: ${error.message}`));
    setTimeout(purge, 5000);
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
  }
}
