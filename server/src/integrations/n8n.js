const store = require('../store');
const { N8N_LOCAL_URL, N8N_INTERNAL_URL } = require('../config');

function cleanBase(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a valid workflow editor URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an http(s) workflow editor URL without credentials, query parameters, or fragments.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Use HTTPS for remote workflow editors.');
  return url.toString().replace(/\/+$/, '');
}

async function request(base, key) {
  const rows = [];
  let cursor = null;
  let apiBase = base;
  if (N8N_INTERNAL_URL) {
    try {
      if (new URL(base).origin === new URL(N8N_LOCAL_URL).origin) apiBase = N8N_INTERNAL_URL;
    } catch { /* cleanBase validates the public URL before request() */ }
  }
  for (let page = 0; page < 4; page += 1) {
    const url = new URL(`${apiBase}/api/v1/workflows`);
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: { 'X-N8N-API-KEY': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'The Lord Minds editor rejected the access key or its permissions.' : `The Lord Minds editor returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    const result = await response.json();
    rows.push(...(Array.isArray(result.data) ? result.data : []));
    cursor = result.nextCursor || null;
    if (!cursor) break;
  }
  return rows.map(w => ({
    id: String(w.id), name: String(w.name || 'Untitled workflow'), active: !!w.active,
    updatedAt: w.updatedAt || null, createdAt: w.createdAt || null,
  }));
}

async function list(userId) {
  const integration = store.get(userId, 'n8n');
  if (!integration.config.baseUrl || !integration.secret.apiKey) throw Object.assign(new Error('Connect the Lord Minds automation editor in Settings first.'), { status: 409 });
  try {
    const workflows = await request(integration.config.baseUrl, integration.secret.apiKey);
    store.save(userId, 'n8n', { status: 'connected', lastError: null });
    return { workflows, baseUrl: integration.config.baseUrl };
  } catch (error) {
    store.save(userId, 'n8n', { status: 'error', lastError: error.message });
    throw error;
  }
}

module.exports = { cleanBase, request, list };
