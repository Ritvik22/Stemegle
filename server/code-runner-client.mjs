const RUNNER_URL = process.env.CODE_RUNNER_URL || 'http://127.0.0.1:8080';

export async function executeCode(payload) {
  let response;
  try {
    response = await fetch(`${RUNNER_URL}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw Object.assign(new Error('The Codegle compiler is temporarily unavailable'), { statusCode: 503 });
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result.status !== 'string') {
    throw Object.assign(new Error('The Codegle compiler returned an invalid response'), { statusCode: 503 });
  }
  return result;
}
