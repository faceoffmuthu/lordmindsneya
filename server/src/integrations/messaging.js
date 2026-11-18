// WhatsApp Cloud API + Telegram Bot API, and the unified chat inbox both feed.
const crypto = require('crypto');
const db = require('../db');
const store = require('../store');
const { safeEqual } = require('../crypto');
const { can } = require('../permissions');

const GRAPH = 'https://graph.facebook.com/v21.0';

// ── inbox storage ──
function upsertChat(userId, channel, externalId, name) {
  db.prepare(`INSERT INTO chats (user_id, channel, external_id, name) VALUES (?,?,?,?)
              ON CONFLICT (user_id, channel, external_id) DO UPDATE SET name = COALESCE(excluded.name, chats.name)`)
    .run(userId, channel, String(externalId), name || null);
  return db.prepare('SELECT * FROM chats WHERE user_id = ? AND channel = ? AND external_id = ?').get(userId, channel, String(externalId));
}

function recordMessage(chat, { direction, externalId, kind = 'text', text, status, at }) {
  const ts = at || new Date().toISOString();
  const r = db.prepare(`INSERT OR IGNORE INTO chat_messages (chat_id, direction, external_id, kind, text, status, at) VALUES (?,?,?,?,?,?,?)`)
    .run(chat.id, direction, externalId || null, kind, text || '', status || null, ts);
  if (!r.changes) return false; // a webhook re-delivery
  db.prepare(`UPDATE chats SET last_at = ?, last_text = ?, unread = unread + ?, last_inbound_at = CASE WHEN ? = 'in' THEN ? ELSE last_inbound_at END WHERE id = ?`)
    .run(ts, (text || `[${kind}]`).slice(0, 200), direction === 'in' ? 1 : 0, direction, ts, chat.id);
  return true;
}

// ── WhatsApp ──
async function waGraph(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error?.error_user_msg || b.error?.message || `WhatsApp API error ${res.status}`);
  return b;
}

async function waTest(phoneNumberId, accessToken) {
  const b = await waGraph(accessToken, `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`);
  return { displayPhone: b.display_phone_number || null, verifiedName: b.verified_name || null };
}

function waVerifySignature(appSecret, rawBody, sigHeader) {
  if (!appSecret) return true; // optional — README recommends setting it
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody || '').digest('hex');
  return safeEqual(expected, sigHeader || '');
}

function waText(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'image': case 'video': case 'document': case 'audio': case 'sticker':
      return m[m.type]?.caption || `[${m.type}]`;
    case 'location': return `[location ${m.location?.latitude},${m.location?.longitude}]`;
    default: return `[${m.type}]`;
  }
}

function waIngest(userId, body) {
  let n = 0;
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const chat = upsertChat(userId, 'whatsapp', m.from, names[m.from]);
        const text = waText(m);
        if (recordMessage(chat, { direction: 'in', externalId: m.id, kind: m.type, text, at: new Date(Number(m.timestamp) * 1000).toISOString() })) {
          n++;
          runAutoReply(userId, 'whatsapp', chat, m.id, text).catch(e => console.error('[flows] WhatsApp auto-reply failed:', e.message));
        }
      }
      for (const s of v.statuses || []) {
        db.prepare(`UPDATE chat_messages SET status = ? WHERE external_id = ? AND direction = 'out'
                    AND chat_id IN (SELECT id FROM chats WHERE user_id = ?)`).run(s.status, s.id, userId);
      }
    }
  }
  return n;
}

async function waSend(userId, to, text) {
  const wa = store.get(userId, 'whatsapp');
  if (!wa.config.phoneNumberId || !wa.secret.accessToken) throw new Error('WhatsApp is not set up. Open Settings → WhatsApp.');
  const b = await waGraph(wa.secret.accessToken, `/${encodeURIComponent(wa.config.phoneNumberId)}/messages`, {
    method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), type: 'text', text: { body: text, preview_url: true } },
  });
  return b.messages?.[0]?.id || null;
}

async function waSendTemplate(userId, to, name, language, parameters = []) {
  const wa = store.get(userId, 'whatsapp');
  if (!wa.config.phoneNumberId || !wa.secret.accessToken) throw new Error('WhatsApp is not set up. Open Settings → WhatsApp.');
  const template = { name, language: { code: language } };
  if (parameters.length) template.components = [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text })) }];
  const response = await waGraph(wa.secret.accessToken, `/${encodeURIComponent(wa.config.phoneNumberId)}/messages`, {
    method: 'POST', body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), type: 'template', template },
  });
  return response.messages?.[0]?.id || null;
}

// ── Telegram ──
async function tg(token, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(20000),
  });
  const b = await res.json().catch(() => ({}));
  if (!b.ok) throw new Error(b.description || `Telegram error ${res.status}`);
  return b.result;
}

function tgIngest(userId, update) {
  const m = update.message || update.edited_message || update.channel_post;
  if (!m) return 0;
  const chatName = m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || String(m.chat.id);
  const chat = upsertChat(userId, 'telegram', m.chat.id, chatName);
  const kind = m.text != null ? 'text' : m.photo ? 'image' : m.voice ? 'audio' : m.document ? 'document' : m.sticker ? 'sticker' : 'other';
  const text = m.text ?? m.caption ?? `[${kind}]`;
  const externalId = `${m.message_id}${update.edited_message ? '-e' : ''}`;
  if (!recordMessage(chat, { direction: 'in', externalId, kind, text, at: new Date(m.date * 1000).toISOString() })) return 0;
  runAutoReply(userId, 'telegram', chat, externalId, text).catch(e => console.error('[flows] Telegram auto-reply failed:', e.message));
  return 1;
}

async function tgSend(userId, chatId, text) {
  const t = store.get(userId, 'telegram');
  if (!t.secret.botToken) throw new Error('Telegram is not set up. Open Settings → Telegram.');
  const r = await tg(t.secret.botToken, 'sendMessage', { chat_id: chatId, text });
  return String(r.message_id);
}

// ── sending from the inbox (only ever called by a user action) ──
async function sendToChat(userId, chatId, text) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(Number(chatId), userId);
  if (!chat) throw new Error('That chat was not found.');
  if (!String(text || '').trim()) throw new Error('Type a message first.');
  if (chat.channel === 'whatsapp') {
    // Meta refuses free text more than 24h after the customer last wrote.
    const last = chat.last_inbound_at ? new Date(chat.last_inbound_at).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) throw new Error('WhatsApp only allows a free-text reply within 24 hours of the person\'s last message. Their window is closed.');
  }
  const extId = chat.channel === 'whatsapp' ? await waSend(userId, chat.external_id, text) : await tgSend(userId, chat.external_id, text);
  recordMessage(chat, { direction: 'out', externalId: extId, text, status: 'sent' });
  return { id: extId };
}

async function runAutoReply(userId, channel, chat, externalId, text) {
  const account = db.prepare('SELECT role, permissions FROM users WHERE id = ?').get(userId);
  if (!can(account, 'flows') || !can(account, channel) || !can(account, 'write')) return false;
  const message = String(text || '').trim().toLocaleLowerCase();
  if (!message) return false;
  const flows = db.prepare(`SELECT * FROM message_flows WHERE user_id = ? AND active = 1 AND channel IN (?, 'all') ORDER BY updated_at DESC, id DESC`).all(userId, channel);
  const flow = flows.find(f => {
    let keywords = []; try { keywords = JSON.parse(f.keywords); } catch { /* ignore corrupt flow */ }
    return keywords.some(k => message.includes(String(k).toLocaleLowerCase()));
  });
  if (!flow) return false;
  if (flow.meta_flow_id && (!can(account, 'instagram') || !can(account, 'messenger') || !store.get(userId, 'whatsapp').secret.accessToken || !store.get(userId, 'instagram').secret.accessToken || !store.get(userId, 'messenger').secret.accessToken)) return false;
  const claimed = db.prepare(`INSERT OR IGNORE INTO message_flow_runs (user_id, flow_id, channel, chat_id, external_id, status, reply_text, error) VALUES (?,?,?,?,?,'failed',?,'Sending…')`)
    .run(userId, flow.id, channel, chat.id, String(externalId), flow.reply_text);
  if (!claimed.changes) return false;
  const runId = Number(claimed.lastInsertRowid);
  try {
    await sendToChat(userId, chat.id, flow.reply_text);
    db.prepare(`UPDATE message_flow_runs SET status='sent', error=NULL WHERE id=?`).run(runId);
    return true;
  } catch (error) {
    db.prepare(`UPDATE message_flow_runs SET status='failed', error=? WHERE id=?`).run(String(error.message || 'Could not send reply.').slice(0, 500), runId);
    return false;
  }
}

const broadcastWorkers = new Set();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startBroadcast(broadcastId) {
  const id = Number(broadcastId);
  if (broadcastWorkers.has(id)) return;
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id=?').get(id);
  if (!broadcast || ['complete', 'partial', 'failed'].includes(broadcast.status)) return;
  broadcastWorkers.add(id);
  try {
    db.prepare(`UPDATE broadcasts SET status='running',updated_at=datetime('now') WHERE id=?`).run(id);
    const recipients = db.prepare(`SELECT * FROM broadcast_recipients WHERE broadcast_id=? AND status='queued' ORDER BY id`).all(id);
    let parameters = []; try { parameters = JSON.parse(broadcast.parameters); } catch { /* empty */ }
    for (const recipient of recipients) {
      db.prepare(`UPDATE broadcast_recipients SET status='sending',error=NULL,updated_at=datetime('now') WHERE id=?`).run(recipient.id);
      try {
        const user = db.prepare('SELECT role,permissions FROM users WHERE id=?').get(broadcast.user_id);
        if (!can(user, 'flows') || !can(user, 'crm') || !can(user, 'whatsapp') || !can(user, 'write')) throw new Error('Sending permissions changed before this recipient was sent.');
        const contact = db.prepare('SELECT whatsapp_opt_in FROM contacts WHERE id=? AND user_id=?').get(recipient.contact_id, broadcast.user_id);
        if (!contact?.whatsapp_opt_in) throw new Error('WhatsApp opt-in is no longer recorded for this contact.');
        const externalId = await waSendTemplate(broadcast.user_id, recipient.phone, broadcast.template_name, broadcast.language, parameters);
        db.prepare(`UPDATE broadcast_recipients SET status='sent',external_id=?,updated_at=datetime('now') WHERE id=?`).run(externalId, recipient.id);
        const chat = db.prepare(`SELECT * FROM chats WHERE user_id=? AND channel='whatsapp' AND external_id=?`).get(broadcast.user_id, recipient.phone);
        if (chat) recordMessage(chat, { direction: 'out', externalId: externalId || `broadcast-${id}-${recipient.id}`, kind: 'template', text: `[template: ${broadcast.template_name}]`, status: 'sent' });
      } catch (error) {
        db.prepare(`UPDATE broadcast_recipients SET status='failed',error=?,updated_at=datetime('now') WHERE id=?`).run(String(error.message || 'Could not send template.').slice(0, 500), recipient.id);
      }
      await wait(250);
    }
    const counts = db.prepare(`SELECT SUM(status='sent') sent,SUM(status='failed') failed,SUM(status IN ('queued','sending')) pending FROM broadcast_recipients WHERE broadcast_id=?`).get(id);
    const status = counts.pending ? 'queued' : counts.sent > 0 && counts.failed > 0 ? 'partial' : counts.sent > 0 ? 'complete' : 'failed';
    db.prepare(`UPDATE broadcasts SET status=?,updated_at=datetime('now') WHERE id=?`).run(status, id);
  } catch (error) {
    console.error('[broadcast] campaign worker failed:', error.message);
    db.prepare(`UPDATE broadcasts SET status='failed',updated_at=datetime('now') WHERE id=?`).run(id);
  } finally { broadcastWorkers.delete(id); }
}

function resumeBroadcasts() {
  db.prepare(`UPDATE broadcast_recipients SET status='failed',error='The server restarted while this send was in progress. Check delivery status in Meta before retrying.',updated_at=datetime('now') WHERE status='sending'`).run();
  db.prepare(`UPDATE broadcasts SET status='queued' WHERE status='running'`).run();
  for (const row of db.prepare(`SELECT id FROM broadcasts WHERE status='queued'`).all()) startBroadcast(row.id);
}

module.exports = { upsertChat, recordMessage, waTest, waVerifySignature, waIngest, waSend, waSendTemplate, tg, tgIngest, tgSend, sendToChat, runAutoReply, startBroadcast, resumeBroadcasts };
