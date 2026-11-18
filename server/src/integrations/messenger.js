const db = require('../db');
const store = require('../store');
const messaging = require('./messaging');
const { can } = require('../permissions');

const GRAPH = 'https://graph.facebook.com/v27.0';
async function graph(accountId, token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${GRAPH}/${encodeURIComponent(accountId)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.error_user_msg || data.error?.message || `Messenger API error ${response.status}`);
  return data;
}

function cleanPageId(value) {
  const pageId = String(value || '').trim();
  if (!/^\d{5,30}$/.test(pageId)) throw new Error('Enter the numeric Facebook Page ID.');
  return pageId;
}

async function testConnection(pageId, token) {
  const id = cleanPageId(pageId);
  const response = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=id,name`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.error_user_msg || data.error?.message || `Messenger API error ${response.status}`);
  return { pageId: String(data.id || id), pageName: data.name || null };
}

async function sendReply(userId, recipientId, text) {
  const config = store.get(userId, 'messenger');
  if (!config.config.pageId || !config.secret.accessToken) throw new Error('Facebook Messenger is not connected.');
  return graph(config.config.pageId, config.secret.accessToken, '/messages', {
    method: 'POST', body: { recipient: { id: String(recipientId) }, messaging_type: 'RESPONSE', message: { text: String(text).slice(0, 2000) } },
  });
}

async function handleMessage(userId, senderId, externalId, text) {
  const user = db.prepare('SELECT role,permissions FROM users WHERE id=?').get(userId);
  if (!can(user, 'flows') || !can(user, 'write') || !can(user, 'whatsapp') || !can(user, 'instagram') || !can(user, 'messenger')) return false;
  const message = String(text || '').trim();
  if (!message || !senderId || !externalId) return false;
  const flows = db.prepare('SELECT * FROM meta_message_flows WHERE user_id=? AND active=1 ORDER BY updated_at DESC,id DESC').all(userId);
  const normalized = message.toLocaleLowerCase();
  const flow = flows.find(candidate => {
    let words = []; try { words = JSON.parse(candidate.keywords || '[]'); } catch { /* ignore malformed flow */ }
    return words.some(word => normalized.includes(String(word).toLocaleLowerCase()));
  });
  if (!flow) return false;
  const result = db.prepare(`INSERT OR IGNORE INTO messenger_flow_runs (user_id,flow_id,external_id,sender_id,message,status,reply_text,error) VALUES (?,?,?,?,?,'failed',?,'Sending…')`)
    .run(userId, flow.id, String(externalId), String(senderId), message.slice(0, 5000), flow.reply_text);
  if (!result.changes) return false;
  const runId = Number(result.lastInsertRowid);
  try {
    const latest = db.prepare('SELECT role,permissions FROM users WHERE id=?').get(userId);
    if (!can(latest, 'flows') || !can(latest, 'write') || !can(latest, 'whatsapp') || !can(latest, 'instagram') || !can(latest, 'messenger')) throw new Error('Meta flow access was revoked before this reply was sent.');
    for (const kind of ['whatsapp', 'instagram', 'messenger']) if (!store.get(userId, kind).secret.accessToken) throw new Error(`Connect ${kind} before running a Meta flow.`);
    await sendReply(userId, senderId, flow.reply_text);
    db.prepare(`UPDATE messenger_flow_runs SET status='sent',error=NULL WHERE id=?`).run(runId);
    return true;
  } catch (error) {
    db.prepare(`UPDATE messenger_flow_runs SET status='failed',error=? WHERE id=?`).run(String(error.message || 'Could not send Messenger reply.').slice(0, 500), runId);
    return false;
  }
}

function ingest(userId, body) {
  const expectedPage = store.get(userId, 'messenger').config.pageId;
  for (const entry of body?.entry || []) {
    if (expectedPage && String(entry.id) !== String(expectedPage)) continue;
    for (const event of entry.messaging || []) {
      const message = event.message;
      if (!message || message.is_echo || !message.text) continue;
      handleMessage(userId, event.sender?.id, message.mid, message.text)
        .catch(error => console.error('[messenger] auto reply failed:', error.message));
    }
  }
  return true;
}

module.exports = { GRAPH, cleanPageId, testConnection, sendReply, handleMessage, ingest, verifySignature: messaging.waVerifySignature };
