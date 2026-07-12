import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredOrigins, createBackendRuntime } from './index.mjs';

function rawAuthHandler(req, res) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => res.json({ body }));
}

function testApiRouter(req, res, next) {
  if (req.path === '/echo' && req.method === 'POST') {
    res.json({ body: req.body });
    return;
  }
  if (req.path === '/explode') {
    next(new Error('sensitive database detail'));
    return;
  }
  next();
}

async function createFixture() {
  const errors = [];
  let databaseHealthy = true;
  const runtime = createBackendRuntime({
    env: { NODE_ENV: 'test' },
    authHandler: rawAuthHandler,
    apiRouterFactory: () => testApiRouter,
    databasePool: {
      async query() {
        if (!databaseHealthy) throw new Error('database unavailable');
        return { rows: [{ '?column?': 1 }] };
      },
      async end() {},
    },
    purgeAnalytics: async () => ({ events: 0, sessions: 0, visitors: 0 }),
    closeDatabase: false,
    logger: {
      info() {},
      error(...items) {
        errors.push(items);
      },
    },
  });
  await runtime.listen({ host: '127.0.0.1', port: 0 });
  const address = runtime.server.address();
  return {
    errors,
    runtime,
    setDatabaseHealthy(value) {
      databaseHealthy = value;
    },
    url: `http://127.0.0.1:${address.port}`,
  };
}

test('trusted realtime origins are normalized and production fails closed', () => {
  assert.deepEqual(
    configuredOrigins({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://stemegle.example/account',
      APP_ALLOWED_ORIGINS: 'https://preview.example/path,not-a-url,https://stemegle.example',
    }),
    ['https://stemegle.example', 'https://preview.example'],
  );
  assert.throws(
    () => configuredOrigins({ NODE_ENV: 'production' }),
    /BETTER_AUTH_URL is required/,
  );
});

test('auth receives the raw body before JSON parsing and API requests are parsed afterward', async () => {
  const fixture = await createFixture();
  try {
    const rawResponse = await fetch(`${fixture.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    assert.equal(rawResponse.status, 200);
    assert.deepEqual(await rawResponse.json(), { body: '{not-json' });

    const apiResponse = await fetch(`${fixture.url}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: 42 }),
    });
    assert.equal(apiResponse.status, 200);
    assert.deepEqual(await apiResponse.json(), { body: { answer: 42 } });
    assert.equal(apiResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(apiResponse.headers.get('cache-control'), 'no-store');

    const malformed = await fetch(`${fixture.url}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'Request body must be valid JSON' });
  } finally {
    await fixture.runtime.close();
  }
});

test('health reflects database readiness and 500 responses hide internal details', async () => {
  const fixture = await createFixture();
  try {
    const healthy = await fetch(`${fixture.url}/health`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { ok: true });

    fixture.setDatabaseHealthy(false);
    const unhealthy = await fetch(`${fixture.url}/health`);
    assert.equal(unhealthy.status, 503);
    assert.deepEqual(await unhealthy.json(), { ok: false });

    const failed = await fetch(`${fixture.url}/api/explode`);
    assert.equal(failed.status, 500);
    const failureBody = await failed.json();
    assert.deepEqual(failureBody, { error: 'Internal server error' });
    assert.ok(fixture.errors.length >= 2);
    assert.ok(!JSON.stringify(failureBody).includes('sensitive database detail'));
  } finally {
    await fixture.runtime.close();
    await fixture.runtime.close();
  }
});
