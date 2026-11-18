// Settings → every user's own credentials. Secrets go in, never come back out:
// the browser only learns whether each one is set (and its last 4 characters).
const express = require('express');
const db = require('../db');
const store = require('../store');
const baseUrl = require('../baseUrl');
const { randomToken } = require('../crypto');
const llm = require('../integrations/llm');
const google = require('../integrations/google');
const msg = require('../integrations/messaging');
const live = require('../assistant/live');
const n8n = require('../integrations/n8n');
const instagram = require('../integrations/instagram');
const messenger = require('../integrations/messenger');
const { can, requirePermission } = require('../permissions');
const { N8N_LOCAL_URL } = require('../config');

const router = express.Router();
const s = (v) => (typeof v === 'string' ? v.trim() : v);

function view(req) {
  const uid = req.user.id;
  const base = baseUrl(req);
  const model = store.get(uid, 'model');
  const voice = store.get(uid, 'voice');
  const g = store.get(uid, 'google');
  const wa = store.get(uid, 'whatsapp');
  const ms = store.get(uid, 'messenger');
  const tg = store.get(uid, 'telegram');
  const automation = store.get(uid, 'n8n');
  const ig = store.get(uid, 'instagram');
  return {
    model: {
      provider: model.config.provider || null, model: model.config.model || null,
      baseUrl: model.config.baseUrl || llm.OLLAMA_DEFAULT_URL,
      apiKey: store.mask(model.secret.apiKey), status: model.status, lastError: model.lastError,
      defaults: llm.DEFAULT_MODELS,
    },
    voice: {
      apiKey: store.mask(voice.secret.apiKey), model: voice.config.model || live.DEFAULT_MODEL,
      voice: voice.config.voice || live.DEFAULT_VOICE, language: voice.config.language || 'English',
      voices: live.VOICES, status: voice.status, lastError: voice.lastError,
    },
    google: {
      clientId: g.config.clientId || '', clientSecret: store.mask(g.secret.clientSecret),
      connected: !!g.secret.refreshToken && g.status === 'connected', status: g.status, lastError: g.lastError,
      driveConnected: !!g.secret.refreshToken && g.status === 'connected' && (g.config.scopes || []).includes('https://www.googleapis.com/auth/drive.readonly'),
      youtubeUpload: !!g.secret.refreshToken && g.status === 'connected' && (g.config.scopes || []).includes('https://www.googleapis.com/auth/youtube.upload'),
      youtubeComments: !!g.secret.refreshToken && g.status === 'connected' && (g.config.scopes || []).includes('https://www.googleapis.com/auth/youtube.force-ssl'),
      email: g.config.email || null, scopes: g.config.scopes || [], redirectUri: `${base}/api/google/callback`,
      javascriptOrigin: base,
    },
    whatsapp: {
      phoneNumberId: wa.config.phoneNumberId || '', displayPhone: wa.config.displayPhone || null,
      accessToken: store.mask(wa.secret.accessToken), verifyToken: wa.secret.verifyToken || '',
      appSecret: store.mask(wa.secret.appSecret), status: wa.status, lastError: wa.lastError,
      callbackUrl: wa.hookId ? `${base}/api/webhooks/whatsapp/${wa.hookId}` : null,
      lastEventAt: wa.config.lastEventAt || null,
    },
    messenger: {
      pageId: ms.config.pageId || '', pageName: ms.config.pageName || null,
      accessToken: store.mask(ms.secret.accessToken), appSecret: store.mask(ms.secret.appSecret),
      verifyToken: ms.secret.verifyToken || '', status: ms.status, lastError: ms.lastError,
      callbackUrl: ms.hookId ? `${base}/api/webhooks/messenger/${ms.hookId}` : null,
      lastEventAt: ms.config.lastEventAt || null,
    },
    telegram: {
      botToken: store.mask(tg.secret.botToken), botUsername: tg.config.botUsername || null,
      webhookUrl: tg.config.webhookUrl || null, status: tg.status, lastError: tg.lastError,
      lastEventAt: tg.config.lastEventAt || null,
    },
    n8n: {
      baseUrl: automation.config.baseUrl || '', apiKey: store.mask(automation.secret.apiKey),
      localBaseUrl: N8N_LOCAL_URL, status: automation.status, lastError: automation.lastError,
    },
    instagram: {
      accountId: ig.config.accountId || '', username: ig.config.username || null,
      accessToken: store.mask(ig.secret.accessToken), appSecret: store.mask(ig.secret.appSecret),
      verifyToken: ig.secret.verifyToken || '', status: ig.status, lastError: ig.lastError,
      callbackUrl: ig.hookId ? `${base}/api/webhooks/instagram/${ig.hookId}` : null,
      lastEventAt: ig.config.lastEventAt || null,
    },
  };
}

router.get('/settings', (req, res) => res.json(view(req)));

router.put('/settings/n8n', requirePermission('n8n'), requirePermission('write'), async (req, res) => {
  const current = store.get(req.user.id, 'n8n');
  let baseUrl;
  try { baseUrl = n8n.cleanBase(req.body?.baseUrl || current.config.baseUrl); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const apiKey = s(req.body?.apiKey) || current.secret.apiKey;
  if (!apiKey) return res.status(400).json({ error: 'Paste a Lord Minds workflow editor access key.' });
  try { await n8n.request(baseUrl, apiKey); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  store.save(req.user.id, 'n8n', { config: { baseUrl }, secret: { apiKey }, status: 'connected', lastError: null });
  res.json(view(req));
});
router.delete('/settings/n8n', requirePermission('n8n'), requirePermission('write'), (req, res) => { store.clear(req.user.id, 'n8n'); res.json(view(req)); });

router.put('/settings/instagram', requirePermission('instagram'), requirePermission('write'), async (req, res) => {
  const current = store.get(req.user.id, 'instagram');
  const accessToken = s(req.body?.accessToken) || current.secret.accessToken;
  const appSecret = s(req.body?.appSecret) || current.secret.appSecret;
  if (!accessToken) return res.status(400).json({ error: 'Paste an Instagram access token.' });
  if (!appSecret) return res.status(400).json({ error: 'Paste the Meta app secret to verify Instagram webhooks.' });
  let account;
  try { account = await instagram.testConnection(req.body?.accountId || current.config.accountId, accessToken); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  store.save(req.user.id, 'instagram', {
    config: { accountId: account.accountId, username: account.username, lastEventAt: current.config.lastEventAt || null },
    secret: { accessToken, appSecret, verifyToken: s(req.body?.verifyToken) || current.secret.verifyToken || randomToken(20) },
    status: 'connected', lastError: null, ensureHook: true,
  });
  res.json(view(req));
});
router.delete('/settings/instagram', requirePermission('instagram'), requirePermission('write'), (req, res) => { store.clear(req.user.id, 'instagram'); res.json(view(req)); });

router.put('/settings/messenger', requirePermission('messenger'), requirePermission('write'), async (req, res) => {
  const current = store.get(req.user.id, 'messenger');
  const pageId = s(req.body?.pageId) || current.config.pageId;
  const accessToken = s(req.body?.accessToken) || current.secret.accessToken;
  const appSecret = s(req.body?.appSecret) || current.secret.appSecret;
  if (!accessToken) return res.status(400).json({ error: 'Paste a Facebook Page access token.' });
  if (!appSecret) return res.status(400).json({ error: 'Paste the Meta app secret to verify webhook signatures.' });
  let page;
  try { page = await messenger.testConnection(pageId, accessToken); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  store.save(req.user.id, 'messenger', {
    config: { pageId: page.pageId, pageName: page.pageName, lastEventAt: current.config.lastEventAt || null },
    secret: { accessToken, appSecret, verifyToken: s(req.body?.verifyToken) || current.secret.verifyToken || randomToken(20) },
    status: 'connected', lastError: null, ensureHook: true,
  });
  res.json(view(req));
});
router.delete('/settings/messenger', requirePermission('messenger'), requirePermission('write'), (req, res) => { store.clear(req.user.id, 'messenger'); res.json(view(req)); });

// ── model ──
router.put('/settings/model', requirePermission('assistant'), requirePermission('write'), async (req, res) => {
  const { provider, apiKey, model, baseUrl } = req.body || {};
  const cur = store.get(req.user.id, 'model');
  if (provider === 'ollama') {
    let localBase;
    try { localBase = llm.cleanOllamaBase(baseUrl || cur.config.baseUrl); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    let models;
    try { models = await llm.listModels('ollama', null, localBase); }
    catch (e) { return res.status(400).json({ error: `Could not connect to Ollama — ${e.message}` }); }
    if (!models.length) return res.status(400).json({ error: 'Ollama is running, but it has no local models installed. Pull a chat model in Ollama, then refresh this list.' });
    const chosen = s(model) || models[0];
    if (!chosen) return res.status(400).json({ error: 'Choose an installed Ollama model.' });
    if (models.length && !models.includes(chosen)) return res.status(400).json({ error: 'Choose a model installed in Ollama, or pull it before saving.' });
    store.save(req.user.id, 'model', { config: { provider, model: chosen, baseUrl: localBase }, secret: { apiKey: null }, status: 'connected', lastError: null });
    return res.json({ ...view(req), models });
  }
  if (!['openai', 'anthropic'].includes(provider)) return res.status(400).json({ error: 'Pick OpenAI, Anthropic, or Ollama.' });
  const switching = cur.config.provider && cur.config.provider !== provider;
  const key = s(apiKey) || (switching ? null : cur.secret.apiKey);
  if (!key) return res.status(400).json({ error: `Paste your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key.` });
  let models = [];
  try { models = await llm.listModels(provider, key); }
  catch (e) { return res.status(400).json({ error: `That key did not work — ${e.message}` }); }
  const chosen = s(model) || llm.DEFAULT_MODELS[provider][0];
  store.save(req.user.id, 'model', { config: { provider, model: chosen, baseUrl: null }, secret: { apiKey: key }, status: 'connected', lastError: null });
  res.json({ ...view(req), models });
});
router.get('/settings/model/models', requirePermission('assistant'), async (req, res) => {
  const m = store.get(req.user.id, 'model');
  if (req.query.provider === 'ollama' || m.config.provider === 'ollama') {
    try { return res.json({ models: await llm.listModels('ollama', null, req.query.baseUrl || m.config.baseUrl || llm.OLLAMA_DEFAULT_URL) }); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }
  if (!m.secret.apiKey) return res.json({ models: [] });
  try { res.json({ models: await llm.listModels(m.config.provider, m.secret.apiKey) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── voice (Gemini Live) ──
router.put('/settings/voice', requirePermission('voice'), requirePermission('write'), async (req, res) => {
  const { apiKey, model, voice, language } = req.body || {};
  const cur = store.get(req.user.id, 'voice');
  const key = s(apiKey) || cur.secret.apiKey;
  if (!key) return res.status(400).json({ error: 'Paste your Gemini API key.' });
  if (s(apiKey)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error?.message || `HTTP ${r.status}`); }
    } catch (e) { return res.status(400).json({ error: `That Gemini key did not work — ${e.message}` }); }
  }
  store.save(req.user.id, 'voice', {
    config: { model: s(model) || live.DEFAULT_MODEL, voice: live.VOICES.includes(voice) ? voice : live.DEFAULT_VOICE, language: s(language) || 'English' },
    secret: { apiKey: key }, status: 'connected', lastError: null,
  });
  res.json(view(req));
});

// ── Google ──
router.put('/settings/google', requirePermission('google'), requirePermission('write'), (req, res) => {
  const { clientId, clientSecret } = req.body || {};
  if (!s(clientId) || !/\.apps\.googleusercontent\.com$/.test(s(clientId))) return res.status(400).json({ error: 'The Client ID ends in .apps.googleusercontent.com — paste the whole value.' });
  const cur = store.get(req.user.id, 'google');
  if (!s(clientSecret) && !cur.secret.clientSecret) return res.status(400).json({ error: 'Paste the Client Secret too.' });
  const changedClient = cur.config.clientId && cur.config.clientId !== s(clientId);
  store.save(req.user.id, 'google', {
    config: { clientId: s(clientId), ...(changedClient ? { email: null, scopes: null, expiresAt: null } : {}) },
    secret: { clientSecret: s(clientSecret) || undefined, ...(changedClient ? { accessToken: null, refreshToken: null } : {}) },
    status: changedClient ? 'saved' : (cur.status || 'saved'),
  });
  res.json(view(req));
});
router.post('/settings/google/connect', requirePermission('google'), requirePermission('write'), (req, res) => {
  const g = store.get(req.user.id, 'google');
  if (!g.config.clientId || !g.secret.clientSecret) return res.status(400).json({ error: 'Save your Client ID and Secret first.' });
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 15 * 60000);
  const state = randomToken(24);
  db.prepare('INSERT INTO oauth_states (state, user_id, created_at) VALUES (?,?,?)').run(state, req.user.id, Date.now());
  res.json({ url: google.authUrl({ clientId: g.config.clientId, redirectUri: `${baseUrl(req)}/api/google/callback`, state }) });
});
router.post('/settings/youtube/connect', requirePermission('google'), requirePermission('youtube'), requirePermission('write'), (req, res) => {
  const g = store.get(req.user.id, 'google');
  if (!g.config.clientId || !g.secret.clientSecret) return res.status(400).json({ error: 'Save your Google OAuth client ID and secret first.' });
  db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 15 * 60000);
  const state = randomToken(24);
  db.prepare('INSERT INTO oauth_states (state, user_id, created_at) VALUES (?,?,?)').run(state, req.user.id, Date.now());
  res.json({ url: google.authUrl({ clientId: g.config.clientId, redirectUri: `${baseUrl(req)}/api/google/callback`, state, includeYoutube: true }) });
});
router.post('/settings/google/disconnect', requirePermission('google'), requirePermission('write'), (req, res) => {
  store.save(req.user.id, 'google', { config: { email: null, scopes: null, expiresAt: null }, secret: { accessToken: null, refreshToken: null }, status: 'saved', lastError: null });
  res.json(view(req));
});

// ── WhatsApp Cloud API ──
router.put('/settings/whatsapp', requirePermission('whatsapp'), requirePermission('write'), async (req, res) => {
  const { phoneNumberId, accessToken, verifyToken, appSecret } = req.body || {};
  const cur = store.get(req.user.id, 'whatsapp');
  const token = s(accessToken) || cur.secret.accessToken;
  if (!s(phoneNumberId) || !/^\d{6,}$/.test(s(phoneNumberId))) return res.status(400).json({ error: 'The Phone number ID is the long number from WhatsApp → API Setup (not the phone number itself).' });
  if (!token) return res.status(400).json({ error: 'Paste the access token.' });
  let info;
  try { info = await msg.waTest(s(phoneNumberId), token); }
  catch (e) { return res.status(400).json({ error: `Meta refused those details — ${e.message}` }); }
  store.save(req.user.id, 'whatsapp', {
    config: { phoneNumberId: s(phoneNumberId), displayPhone: info.displayPhone, verifiedName: info.verifiedName },
    secret: { accessToken: token, verifyToken: s(verifyToken) || cur.secret.verifyToken || randomToken(18), appSecret: s(appSecret) || undefined },
    status: 'connected', lastError: null, ensureHook: true,
  });
  res.json(view(req));
});
router.delete('/settings/whatsapp', requirePermission('whatsapp'), requirePermission('write'), (req, res) => { store.clear(req.user.id, 'whatsapp'); res.json(view(req)); });

// ── Telegram ──
router.put('/settings/telegram', requirePermission('telegram'), requirePermission('write'), async (req, res) => {
  const { botToken } = req.body || {};
  const cur = store.get(req.user.id, 'telegram');
  const token = s(botToken) || cur.secret.botToken;
  if (!token || !/^\d+:[\w-]{20,}$/.test(token)) return res.status(400).json({ error: 'A bot token looks like 123456789:AA… — get it from @BotFather.' });
  let me;
  try { me = await msg.tg(token, 'getMe'); }
  catch (e) { return res.status(400).json({ error: `Telegram refused that token — ${e.message}` }); }
  const saved = store.save(req.user.id, 'telegram', {
    config: { botUsername: me.username }, secret: { botToken: token, webhookSecret: cur.secret.webhookSecret || randomToken(24) },
    status: 'saved', ensureHook: true,
  });
  const url = `${baseUrl(req)}/api/webhooks/telegram/${saved.hookId}`;
  try {
    await msg.tg(token, 'setWebhook', { url, secret_token: saved.secret.webhookSecret, allowed_updates: ['message', 'edited_message', 'channel_post'], drop_pending_updates: false });
    store.save(req.user.id, 'telegram', { config: { webhookUrl: url }, status: 'connected', lastError: null });
  } catch (e) {
    store.save(req.user.id, 'telegram', { status: 'error', lastError: `Could not register the webhook: ${e.message}` });
  }
  res.json(view(req));
});
router.delete('/settings/telegram', requirePermission('telegram'), requirePermission('write'), async (req, res) => {
  const t = store.get(req.user.id, 'telegram');
  if (t.secret.botToken) { try { await msg.tg(t.secret.botToken, 'deleteWebhook', {}); } catch { /* best effort */ } }
  store.clear(req.user.id, 'telegram');
  res.json(view(req));
});

// Clear any single integration.
router.delete('/settings/:kind', (req, res, next) => {
  if (!['model', 'voice', 'google'].includes(req.params.kind)) return res.status(404).json({ error: 'Unknown setting.' });
  const permission = req.params.kind === 'model' ? 'assistant' : req.params.kind;
  if (!can(req.user, permission) || !can(req.user, 'write')) return res.status(403).json({ error: `Your account cannot change ${permission} settings. Ask an admin to change your access.` });
  next();
}, (req, res) => {
  store.clear(req.user.id, req.params.kind);
  res.json(view(req));
});

module.exports = router;
