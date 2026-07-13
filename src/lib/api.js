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

export function fetchPlayerHub() {
  return request('/api/player/hub');
}

export async function recordBotMatch(matchId, score, opponentScore) {
  if (!matchId) return null;
  return request('/api/matches/bot', {
    method: 'POST',
    body: JSON.stringify({ matchId, score, opponentScore }),
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

export function recordLearningAttempt(attempt) {
  return request('/api/learning/attempts', {
    method: 'POST',
    body: JSON.stringify(attempt),
  });
}

export function recordChatReport({ reportToken, reason } = {}) {
  return request('/api/chat/reports', {
    method: 'POST',
    body: JSON.stringify({ reportToken, reason }),
  });
}

export async function fetchAdminAccess() {
  const result = await request('/api/admin/access');
  return Boolean(result?.allowed);
}

export function fetchAdminDashboard(days) {
  const range = Math.max(1, Math.min(Number(days) || 30, 3650));
  return request(`/api/admin/analytics?days=${range}`);
}

export function fetchAdminChatReports({ status = 'pending', limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({
    status,
    limit: String(Math.max(1, Math.min(Number(limit) || 100, 200))),
    offset: String(Math.max(0, Math.trunc(Number(offset) || 0))),
  });
  return request(`/api/admin/chat-reports?${params}`);
}

export function updateAdminChatReport(id, status) {
  return request(`/api/admin/chat-reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
