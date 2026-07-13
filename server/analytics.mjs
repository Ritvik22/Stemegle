import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAnalyticsDashboard } from './dashboard.mjs';
import { withTransaction } from './db.mjs';

const COOKIE_SECRET = process.env.ANALYTICS_COOKIE_SECRET
  || (process.env.NODE_ENV === 'production' ? '' : 'local-analytics-cookie-secret-change-me');
const VISITOR_COOKIE = 'stemegle_av';
const SESSION_COOKIE = 'stemegle_as';
const ACTOR_COOKIE = 'stemegle_aa';
const VISITOR_MAX_AGE = 60 * 60 * 24 * 180;
const SESSION_MAX_AGE = 60 * 30;

if (process.env.NODE_ENV === 'production' && COOKIE_SECRET.length < 32) {
  throw new Error('ANALYTICS_COOKIE_SECRET must contain at least 32 characters');
}

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
  'lesson_started',
  'lesson_completed',
  'lesson_abandoned',
  'learning_question_answered',
  'chat_reported',
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
  'difficulty',
  'channel_type',
  'questions_answered',
  'correct_answers',
  'accuracy',
]);

function safeText(value, maxLength = 240) {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

export function sanitizePath(value) {
  const path = safeText(value, 240);
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path.split('?')[0].split('#')[0].slice(0, 240) || '/';
}

export function shouldSkipAnalyticsRequest(req, body) {
  const dnt = safeText(req.headers.dnt, 8);
  const globalPrivacyControl = safeText(req.headers['sec-gpc'], 8);
  return dnt === '1'
    || globalPrivacyControl === '1'
    || sanitizePath(body?.path).startsWith('/admin');
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
  else if (/crios\//i.test(ua) || /chrome\//i.test(ua)) browser = 'Chrome';
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
  const signature = createHmac('sha256', COOKIE_SECRET).update(value).digest('base64url');
  return `${Buffer.from(value).toString('base64url')}.${signature}`;
}

function verifyCookieValue(signedValue) {
  if (!signedValue || !COOKIE_SECRET) return '';
  const [encoded, suppliedSignature] = String(signedValue).split('.');
  if (!encoded || !suppliedSignature) return '';
  let value;
  let supplied;
  try {
    value = Buffer.from(encoded, 'base64url').toString();
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return '';
  }
  const expected = createHmac('sha256', COOKIE_SECRET).update(value).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? value : '';
}

function cookieHeader(req, name, value, maxAge) {
  const forwardedProto = safeText(req.headers['x-forwarded-proto'], 20);
  const secure = process.env.NODE_ENV === 'production'
    || forwardedProto === 'https'
    || Boolean(req.socket.encrypted);
  return `${name}=${signCookieValue(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function requestIdentity(req, userId) {
  const cookies = parseCookies(req);
  const existingVisitor = verifyCookieValue(cookies[VISITOR_COOKIE]);
  const existingSession = verifyCookieValue(cookies[SESSION_COOKIE]);
  const existingActor = verifyCookieValue(cookies[ACTOR_COOKIE]);
  const actor = userId || 'anonymous';
  const visitorId = isUuid(existingVisitor) ? existingVisitor : randomUUID();
  const firstAuthentication = Boolean(userId && existingActor === 'anonymous');
  const sessionId = isUuid(existingSession)
    && (existingActor === actor || firstAuthentication)
    ? existingSession
    : randomUUID();
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

export function buildAnalyticsPayload(req, body, identity, userId = null) {
  if (!isUuid(body?.event_id) || !isUuid(identity.visitorId) || !isUuid(identity.sessionId)) {
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
    eventId: body.event_id,
    visitorId: identity.visitorId,
    sessionId: identity.sessionId,
    userId,
    eventName: body.event_name,
    path,
    referrer: referrer || null,
    context: {
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
    properties: sanitizeProperties(body.properties),
  };
}

async function ingestEvent(payload) {
  return withTransaction(async (client) => {
    const duplicate = await client.query(
      'select 1 from analytics_events where event_id = $1',
      [payload.eventId],
    );
    if (duplicate.rowCount) return false;

    const context = payload.context;
    await client.query(`
      insert into analytics_visitors (
        visitor_id, user_id, first_landing_path, last_path,
        first_referrer_url, first_referrer_host, first_source,
        first_medium, first_campaign, first_country_code, first_region,
        first_city, first_timezone, first_device_type, first_browser,
        first_os, last_event
      ) values (
        $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      on conflict (visitor_id) do update set
        user_id = coalesce(analytics_visitors.user_id, excluded.user_id),
        last_seen_at = now(),
        last_path = excluded.last_path,
        last_event = excluded.last_event
    `, [
      payload.visitorId,
      payload.userId,
      payload.path,
      payload.referrer,
      context.referrer_host,
      context.source,
      context.medium,
      context.campaign,
      context.country_code,
      context.region,
      context.city,
      context.timezone,
      context.device_type,
      context.browser,
      context.operating_system,
      payload.eventName,
    ]);

    const insertedSession = await client.query(`
      insert into analytics_sessions (
        session_id, visitor_id, user_id, landing_path, exit_path,
        referrer_url, referrer_host, acquisition_source, acquisition_medium,
        acquisition_campaign, utm_term, utm_content, country_code, region,
        city, timezone, device_type, browser, operating_system
      ) values (
        $1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      ) on conflict (session_id) do nothing
      returning session_id
    `, [
      payload.sessionId,
      payload.visitorId,
      payload.userId,
      payload.path,
      payload.referrer,
      context.referrer_host,
      context.source,
      context.medium,
      context.campaign,
      context.term,
      context.content,
      context.country_code,
      context.region,
      context.city,
      context.timezone,
      context.device_type,
      context.browser,
      context.operating_system,
    ]);

    const session = await client.query(`
      update analytics_sessions
      set
        user_id = coalesce($3, user_id),
        last_seen_at = now(),
        exit_path = $4
      where session_id = $1 and visitor_id = $2
      returning *
    `, [payload.sessionId, payload.visitorId, payload.userId, payload.path]);
    if (!session.rowCount) {
      throw Object.assign(new Error('Analytics session does not belong to visitor'), { statusCode: 400 });
    }

    if (payload.userId) {
      if (payload.eventName === 'signup_succeeded') {
        await client.query(`
          update analytics_events
          set user_id = $1
          where session_id = $2 and visitor_id = $3 and user_id is null
        `, [payload.userId, payload.sessionId, payload.visitorId]);
      }
      await client.query(`
        insert into analytics_user_attribution (
          user_id, visitor_id, session_id, attribution_kind, attributed_at,
          landing_path, referrer_url, referrer_host, acquisition_source,
          acquisition_medium, acquisition_campaign, country_code, region,
          city, timezone, device_type, browser, operating_system
        )
        select
          $1, visitor_id, session_id,
          case when $2 = 'signup_succeeded' then 'signup' else 'authenticated_return' end,
          now(), landing_path, referrer_url, referrer_host, acquisition_source,
          acquisition_medium, acquisition_campaign, country_code, region,
          city, timezone, device_type, browser, operating_system
        from analytics_sessions where session_id = $3
        on conflict (user_id) do nothing
      `, [payload.userId, payload.eventName, payload.sessionId]);
    }

    const event = await client.query(`
      insert into analytics_events (
        event_id, session_id, visitor_id, user_id, event_name, path, properties
      ) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (event_id) do nothing
      returning id
    `, [
      payload.eventId,
      payload.sessionId,
      payload.visitorId,
      payload.userId,
      payload.eventName,
      payload.path,
      payload.properties,
    ]);
    if (!event.rowCount) return false;

    await client.query(`
      update analytics_visitors
      set
        last_seen_at = now(),
        last_path = $2,
        last_event = $3,
        pageview_count = pageview_count + case when $3 = 'page_view' then 1 else 0 end,
        session_count = session_count + $4
      where visitor_id = $1
    `, [payload.visitorId, payload.path, payload.eventName, insertedSession.rowCount ? 1 : 0]);

    if (payload.eventName === 'page_view') {
      await client.query(
        'update analytics_sessions set pageview_count = pageview_count + 1 where session_id = $1',
        [payload.sessionId],
      );
    }
    return true;
  });
}

export async function ingestAnalyticsRequest(req, res, body, userId) {
  if (shouldSkipAnalyticsRequest(req, body)) {
    res.status(204).end();
    return;
  }
  const identity = requestIdentity(req, userId);
  const payload = buildAnalyticsPayload(req, body, identity, userId);
  await ingestEvent(payload);
  identity.cookies.forEach((cookie) => res.append('Set-Cookie', cookie));
  res.status(202).json({ accepted: true });
}

export async function purgeExpiredAnalytics(retentionDays = 400) {
  const days = Math.max(30, Math.min(Number(retentionDays) || 400, 730));
  return withTransaction(async (client) => {
    const authSessions = await client.query(
      'delete from auth_sessions where expires_at < now()',
    );
    const events = await client.query(
      `delete from analytics_events where occurred_at < now() - make_interval(days => $1)`,
      [days],
    );
    const sessions = await client.query(`
      delete from analytics_sessions
      where last_seen_at < now() - make_interval(days => $1)
    `, [days]);
    const visitors = await client.query(`
      delete from analytics_visitors as visitor
      where visitor.last_seen_at < now() - make_interval(days => $1)
        and visitor.user_id is null
        and not exists (
          select 1 from analytics_sessions as session
          where session.visitor_id = visitor.visitor_id
        )
        and not exists (
          select 1 from analytics_user_attribution as attribution
          where attribution.visitor_id = visitor.visitor_id
        )
    `, [days]);
    return {
      authSessions: authSessions.rowCount,
      events: events.rowCount,
      sessions: sessions.rowCount,
      visitors: visitors.rowCount,
    };
  });
}

export { getAnalyticsDashboard };
