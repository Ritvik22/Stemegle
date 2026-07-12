const ATTRIBUTION_KEY = 'stemegle_analytics_attribution';
const ACTIVE_GAME_KEY = 'stemegle_analytics_active_game';

function createId() {
  return globalThis.crypto?.randomUUID?.()
    ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (digit) => (
      Number(digit) ^ (Math.random() * 16 >> Number(digit) / 4)
    ).toString(16));
}

function readStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Analytics must never stop the game when storage is unavailable.
  }
}

function removeStorage(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore browsers that block storage.
  }
}

function sanitizeReferrer(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
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

function captureAttribution() {
  const existing = readStorage(sessionStorage, ATTRIBUTION_KEY);
  if (existing) {
    try {
      return JSON.parse(existing);
    } catch {
      // Replace malformed session data below.
    }
  }
  const query = new URLSearchParams(window.location.search);
  const attribution = {
    source: query.get('utm_source')?.slice(0, 120) || '',
    medium: query.get('utm_medium')?.slice(0, 120) || '',
    campaign: query.get('utm_campaign')?.slice(0, 240) || '',
    term: query.get('utm_term')?.slice(0, 240) || '',
    content: query.get('utm_content')?.slice(0, 240) || '',
    referrer: sanitizeReferrer(document.referrer),
  };
  writeStorage(sessionStorage, ATTRIBUTION_KEY, JSON.stringify(attribution));
  return attribution;
}

const privacyOptOut = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
const directAdminVisit = window.location.pathname.startsWith('/admin');
const attribution = privacyOptOut || directAdminVisit ? {
  source: '', medium: '', campaign: '', term: '', content: '', referrer: '',
} : captureAttribution();
let initialized = false;
let currentPath = '';
let deliveryQueue = Promise.resolve();

function virtualPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return '/';
  return path.split('?')[0].split('#')[0].slice(0, 240) || '/';
}

function readActiveGame() {
  const raw = readStorage(localStorage, ACTIVE_GAME_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    removeStorage(localStorage, ACTIVE_GAME_KEY);
    return null;
  }
}

function updateActiveGame(eventName, properties) {
  if (eventName === 'game_started') {
    writeStorage(localStorage, ACTIVE_GAME_KEY, JSON.stringify({
      game_id: properties.game_id,
      attempt_id: properties.attempt_id,
      mode: properties.mode,
      total_rounds: properties.total_rounds,
      round: 0,
      started_at: Date.now(),
    }));
    return;
  }
  if (eventName === 'game_question_answered') {
    const active = readActiveGame();
    if (!active) return;
    writeStorage(localStorage, ACTIVE_GAME_KEY, JSON.stringify({
      ...active,
      round: Math.max(Number(active.round) || 0, Number(properties.round) || 0),
    }));
    return;
  }
  if (eventName === 'game_completed' || eventName === 'game_abandoned') {
    removeStorage(localStorage, ACTIVE_GAME_KEY);
  }
}

function deliver(body, keepalive) {
  return fetch('/api/analytics/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    credentials: 'same-origin',
    keepalive: Boolean(keepalive),
    body: JSON.stringify(body),
  }).then((response) => {
    if (!response.ok && response.status !== 503 && import.meta.env.DEV) {
      console.warn(`Analytics event was not accepted (${response.status})`);
    }
  }).catch(() => {
    // Telemetry is best effort and must never surface as a product error.
  });
}

export function trackAnalyticsEvent(eventName, properties = {}, options = {}) {
  if (privacyOptOut || window.location.pathname.startsWith('/admin')) return Promise.resolve();
  if (!options.skipGameState) updateActiveGame(eventName, properties);

  const body = {
    event_id: createId(),
    event_name: eventName,
    path: virtualPath(options.path || currentPath || window.location.pathname),
    referrer: attribution.referrer,
    attribution: {
      source: attribution.source,
      medium: attribution.medium,
      campaign: attribution.campaign,
      term: attribution.term,
      content: attribution.content,
    },
    properties,
  };

  if (options.keepalive) return deliver(body, true);
  deliveryQueue = deliveryQueue.catch(() => {}).then(() => deliver(body, false));
  return deliveryQueue;
}

export function trackPageView(path, properties = {}) {
  const nextPath = virtualPath(path);
  if (nextPath.startsWith('/admin') || currentPath === nextPath) return Promise.resolve();
  currentPath = nextPath;
  return trackAnalyticsEvent('page_view', properties, { path: nextPath });
}

export function initializeAnalytics(initialPath = '/') {
  if (initialized || privacyOptOut || directAdminVisit) return;
  initialized = true;

  const abandoned = readActiveGame();
  if (abandoned) {
    trackAnalyticsEvent('game_abandoned', {
      ...abandoned,
      reason: 'session_ended',
      recovered: true,
    }, { skipGameState: true });
    removeStorage(localStorage, ACTIVE_GAME_KEY);
  }

  trackAnalyticsEvent('session_started', {}, { path: virtualPath(initialPath) });
  trackPageView(initialPath);

  const heartbeat = () => {
    if (document.visibilityState === 'visible') trackAnalyticsEvent('session_heartbeat');
  };
  const heartbeatTimer = setInterval(heartbeat, 60000);
  window.addEventListener('visibilitychange', heartbeat);

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    const active = readActiveGame();
    if (!active) return;
    trackAnalyticsEvent('game_abandoned', {
      ...active,
      reason: 'page_exit',
    }, { keepalive: true });
  });
  return () => {
    clearInterval(heartbeatTimer);
    window.removeEventListener('visibilitychange', heartbeat);
  };
}
