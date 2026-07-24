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

export async function startCodegleBotMatch(playerId, difficulty, kind) {
  const result = await request('/api/codegle/bot/start', {
    method: 'POST',
    body: JSON.stringify({ playerId, difficulty, kind }),
  });
  return result?.match || null;
}

export async function finishCodegleBotMatch(matchId, playerId, ticket) {
  return request('/api/codegle/bot/finish', {
    method: 'POST',
    body: JSON.stringify({ matchId, playerId, ticket }),
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

export async function fetchQuestionPacks() {
  const result = await request('/api/question-packs');
  return result?.packs || [];
}

export async function fetchQuestionPack(packId) {
  const result = await request(`/api/question-packs/${encodeURIComponent(packId)}`);
  return result?.pack || null;
}

export async function saveQuestionPack(pack) {
  const path = pack.id
    ? `/api/question-packs/${encodeURIComponent(pack.id)}`
    : '/api/question-packs';
  return request(path, {
    method: pack.id ? 'PUT' : 'POST',
    body: JSON.stringify({ title: pack.title, questions: pack.questions }),
  });
}

export function deleteQuestionPack(packId) {
  return request(`/api/question-packs/${encodeURIComponent(packId)}`, { method: 'DELETE' });
}

export async function uploadQuestionPackImage(file) {
  const response = await fetch('/api/question-pack-images', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': file.type },
    body: file,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error || `Upload failed with status ${response.status}`, response.status, data);
  }
  return data;
}

export function submitCodegleSolution({ matchId, playerId, ticket, language, source }) {
  return request('/api/codegle/submit', {
    method: 'POST',
    body: JSON.stringify({ matchId, playerId, ticket, language, source }),
  });
}
