import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { auth } from './auth.mjs';
import { createApiRouter } from './api.mjs';
import { purgeExpiredAnalytics } from './analytics.mjs';
import { pool } from './db.mjs';
import { attachRealtimeServer } from './realtime.mjs';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const JSON_BODY_LIMIT = '192kb';
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 10_000;

function parsePort(value) {
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseRetentionDays(value) {
  return Math.max(30, Math.min(Number(value) || 400, 730));
}

function asOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function configuredOrigins(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_URL) {
    throw new Error('BETTER_AUTH_URL is required in production');
  }

  const candidates = [
    env.BETTER_AUTH_URL || 'http://localhost:5173',
    ...String(env.APP_ALLOWED_ORIGINS || '').split(','),
    ...String(env.REALTIME_ALLOWED_ORIGINS || '').split(','),
    ...(env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ];
  const origins = [...new Set(candidates.map(asOrigin).filter(Boolean))];
  if (!origins.length) throw new Error('At least one trusted application origin is required');
  return origins;
}

function errorStatus(error) {
  if (error?.type === 'entity.too.large') return 413;
  if (error?.type === 'entity.parse.failed') return 400;
  const requested = Number(error?.statusCode || error?.status);
  return Number.isInteger(requested) && requested >= 400 && requested < 500 ? requested : 500;
}

function clientErrorMessage(error, status) {
  if (status === 400 && error?.type === 'entity.parse.failed') return 'Request body must be valid JSON';
  if (status === 413) return 'Request body is too large';
  if (status >= 400 && status < 500 && typeof error?.message === 'string') return error.message;
  return 'Internal server error';
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createMaintenanceScheduler({ env, logger, purgeAnalytics }) {
  const retentionDays = parseRetentionDays(env.ANALYTICS_RETENTION_DAYS);
  let stopped = false;
  let running = null;

  const run = () => {
    if (stopped || running) return running;
    running = Promise.resolve()
      .then(() => purgeAnalytics(retentionDays))
      .then((removed) => {
        const total = Object.values(removed || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (total > 0) logger.info?.('Expired analytics data purged', removed);
      })
      .catch((error) => {
        logger.error?.('Analytics retention cleanup failed', error);
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const startupTimer = setTimeout(run, 1_000);
  const interval = setInterval(run, MAINTENANCE_INTERVAL_MS);
  startupTimer.unref?.();
  interval.unref?.();

  return async () => {
    stopped = true;
    clearTimeout(startupTimer);
    clearInterval(interval);
    await running;
  };
}

export function createBackendRuntime(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const databasePool = options.databasePool || pool;
  const authHandler = options.authHandler || toNodeHandler(auth);
  const apiRouterFactory = options.apiRouterFactory || createApiRouter;
  const purgeAnalytics = options.purgeAnalytics || purgeExpiredAnalytics;
  const app = express();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  });

  app.get('/health', async (_req, res) => {
    try {
      await databasePool.query('select 1');
      res.json({ ok: true });
    } catch (error) {
      logger.error?.('Database health check failed', error);
      res.status(503).json({ ok: false });
    }
  });

  // Better Auth must receive the untouched request stream so it can validate
  // its own payloads and signatures. Register both the base and child paths.
  app.all('/api/auth', authHandler);
  app.all('/api/auth/*splat', authHandler);

  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  const server = createServer(app);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  const realtime = attachRealtimeServer(server, {
    allowedOrigins: configuredOrigins(env),
    async getSessionUserId(request) {
      if (!request.headers.cookie) return null;
      try {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
        return session?.user?.id || null;
      } catch {
        return null;
      }
    },
    ...options.realtimeOptions,
  });

  app.use('/api', apiRouterFactory({
    getOnlineCount: () => realtime.getPresenceCount('stemegle:visitors'),
    notifyStats: () => realtime.publishDatabaseChange({ table: 'matches', event: 'INSERT' }),
    verifyMatchTicket: (ticket) => realtime.verifyMatchTicket(ticket),
  }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use((error, req, res, _next) => {
    if (res.headersSent) {
      req.socket.destroy();
      return;
    }
    const status = errorStatus(error);
    if (status >= 500) {
      logger.error?.('Unhandled backend request error', {
        method: req.method,
        path: req.path,
        error: error instanceof Error ? error.stack : String(error),
      });
    }
    res.status(status).json({ error: clientErrorMessage(error, status) });
  });

  let stopMaintenance = async () => {};
  let closePromise = null;

  async function listen({
    host = env.HOST || DEFAULT_HOST,
    port = parsePort(env.PORT),
  } = {}) {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    stopMaintenance = createMaintenanceScheduler({ env, logger, purgeAnalytics });
    return server.address();
  }

  async function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      await stopMaintenance();
      const httpClose = closeHttpServer(server);
      const forceTimer = setTimeout(() => server.closeAllConnections?.(), SHUTDOWN_GRACE_MS);
      forceTimer.unref?.();
      try {
        const [realtimeResult, httpResult] = await Promise.allSettled([
          realtime.close(),
          httpClose,
        ]);
        if (realtimeResult.status === 'rejected') throw realtimeResult.reason;
        if (httpResult.status === 'rejected') throw httpResult.reason;
      } finally {
        clearTimeout(forceTimer);
        if (options.closeDatabase !== false) await databasePool.end?.();
      }
    })();
    return closePromise;
  }

  return { app, server, realtime, listen, close };
}

function installShutdownHandlers(runtime, logger = console) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.off('SIGTERM', onSigterm);
    process.off('SIGINT', onSigint);
    logger.info?.(`Received ${signal}; shutting down`);
    runtime.close().catch((error) => {
      logger.error?.('Graceful shutdown failed', error);
      process.exitCode = 1;
    });
  };
  const onSigterm = () => shutdown('SIGTERM');
  const onSigint = () => shutdown('SIGINT');
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);
}

export async function startBackend(options = {}) {
  const logger = options.logger || console;
  const runtime = createBackendRuntime(options);
  try {
    const address = await runtime.listen(options.listen);
    const location = typeof address === 'string'
      ? address
      : `${address?.address || DEFAULT_HOST}:${address?.port || DEFAULT_PORT}`;
    logger.info?.(`Stemegle backend listening on ${location}`);
    if (options.installSignalHandlers !== false) installShutdownHandlers(runtime, logger);
    return runtime;
  } catch (error) {
    await runtime.close().catch(() => {});
    throw error;
  }
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  startBackend().catch((error) => {
    console.error('Stemegle backend failed to start', error);
    process.exitCode = 1;
  });
}
