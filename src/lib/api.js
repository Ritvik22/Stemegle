import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export class ApiError extends Error {
  constructor(message, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    throw new ApiError(
      data?.error || `Request failed with status ${response.status}`,
      response.status,
      data,
    );
  }

  return data;
}

export function fetchStats() {
  return request('/api/stats');
}

export async function recordBotMatch(matchId) {
  if (!matchId) return null;
  return request('/api/matches/bot', {
    method: 'POST',
    body: JSON.stringify({ matchId }),
  });
}

export async function recordMatchResult(matchId, playerId, ticket, score, opponentScore) {
  if (!matchId || !playerId || !ticket) return null;
  const result = await request('/api/matches/result', {
    method: 'POST',
    body: JSON.stringify({ matchId, playerId, ticket, score, opponentScore }),
  });
  return result?.stats || null;
}

export async function fetchAdminAccess() {
  const result = await request('/api/admin/access');
  return Boolean(result?.allowed);
}

export function fetchAdminDashboard(days) {
  const range = Math.max(1, Math.min(Number(days) || 30, 3650));
  return request(`/api/admin/analytics?days=${range}`);
}
