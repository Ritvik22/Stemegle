import { betterAuth } from 'better-auth';
import { pool } from './db.mjs';

const production = process.env.NODE_ENV === 'production';
const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:5173';
const secret = process.env.BETTER_AUTH_SECRET
  || (production ? '' : 'local-development-secret-change-before-production');

if (production && secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
}

const localOrigins = production
  ? []
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

const additionalOrigins = String(
  process.env.APP_ALLOWED_ORIGINS || process.env.REALTIME_ALLOWED_ORIGINS || '',
).split(',').map(normalizeOrigin).filter(Boolean);

export function normalizeBattleName(value) {
  const name = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 30 ? name : '';
}

export const auth = betterAuth({
  appName: 'Stemegle',
  baseURL,
  basePath: '/api/auth',
  secret,
  database: pool,
  trustedOrigins: [...new Set([
    normalizeOrigin(baseURL),
    ...additionalOrigins,
    ...localOrigins,
  ].filter(Boolean))],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  user: {
    modelName: 'app_users',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'user',
        input: false,
      },
    },
  },
  session: {
    modelName: 'auth_sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: 'auth_accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'auth_verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          const name = normalizeBattleName(user.name);
          return name ? { data: { ...user, name } } : false;
        },
      },
      update: {
        async before(user) {
          if (user.name === undefined) return undefined;
          const name = normalizeBattleName(user.name);
          return name ? { data: { ...user, name } } : false;
        },
      },
    },
  },
  advanced: {
    useSecureCookies: production,
    cookiePrefix: 'stemegle',
    database: {
      generateId: 'uuid',
    },
    ipAddress: {
      ipAddressHeaders: ['cf-connecting-ip', 'x-real-ip'],
    },
  },
});
