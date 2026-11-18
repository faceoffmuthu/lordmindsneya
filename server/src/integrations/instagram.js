const db = require('../db');
const store = require('../store');
const msg = require('./messaging');
const { can } = require('../permissions');
const GRAPH = 'https://graph.facebook.com/v27.0';

async function graph(userId, path, { method = 'GET', body } = {}) {
  const config = store.get(userId, 'instagram');
  if (!config.secret.accessToken) throw new Error('Instagram is not connected.');
  const response = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.secret.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.error_user_msg || data.error?.message || `Instagram API error ${response.status}`);
  return data;
}

function cleanAccountId(value) {
  const id = String(value || '').trim();
  if (!/^\d{5,30}$/.test(id)) throw new Error('Enter the numeric Instagram professional account ID.');
  return id;
}

async function testConnection(accountId, accessToken) {
  const id = cleanAccountId(accountId);
  const response = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=id,username`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.error_user_msg || data.error?.message || `Instagram API error ${response.status}`);
  return { accountId: String(data.id || id), username: data.username || null };
}

async function privateReply(userId, commentId, text) {
  const instagram = store.get(userId, 'instagram');
  const id = instagram.config.accountId;
  if (!id || !instagram.secret.accessToken) throw new Error('Instagram is not connected.');
  return graph(userId, `/${encodeURIComponent(id)}/messages`, {
    method: 'POST', body: { recipient: { comment_id: String(commentId) }, message: { text: String(text).slice(0, 1000) } },
  });
}

async function listMedia(userId) {
  const accountId = store.get(userId, 'instagram').config.accountId;
  if (!accountId) throw new Error('Connect an Instagram professional account in Settings → Instagram.');
  const result = await graph(userId, `/${encodeURIComponent(accountId)}/media?fields=id,caption,media_type,timestamp,permalink,thumbnail_url&limit=50`);
  return (result.data || []).map(item => ({
    id: String(item.id),
    caption: String(item.caption || '').slice(0, 160),
    mediaType: item.media_type || 'POST',
    timestamp: item.timestamp || null,
    permalink: item.permalink || null,
    thumbnailUrl: item.thumbnail_url || null,
  }));
}

async function handleComment(userId, commentId, username, commentText, eventTime, mediaId) {
  const user = db.prepare('SELECT role, permissions FROM users WHERE id=?').get(userId);
  if (!can(user, 'instagram') || !can(user, 'write')) return false;
  const message = String(commentText || '').trim();
  if (!commentId || !message) return false;
  const flows = db.prepare('SELECT * FROM instagram_comment_flows WHERE user_id=? AND active=1 ORDER BY updated_at DESC,id DESC').all(userId);
  const match = message.toLocaleLowerCase();
  const matches = flows.filter(item => {
    if (item.media_id && (!mediaId || String(item.media_id) !== String(mediaId))) return false;
    let words = []; try { words = JSON.parse(item.keywords); } catch { /* ignore malformed */ }
    return words.some(word => match.includes(String(word).toLocaleLowerCase()));
  });
  const flow = matches.find(item => item.media_id) || matches[0];
  if (!flow) return false;
  if (flow.meta_flow_id && (!can(user, 'whatsapp') || !can(user, 'messenger') || !store.get(userId, 'whatsapp').secret.accessToken || !store.get(userId, 'instagram').secret.accessToken || !store.get(userId, 'messenger').secret.accessToken)) return false;
  const claimed = db.prepare(`INSERT OR IGNORE INTO instagram_flow_runs (user_id,flow_id,comment_id,media_id,username,comment,status,reply_text,error) VALUES (?,?,?,?,?,?,'failed',?,'Sending…')`)
    .run(userId, flow.id, String(commentId), mediaId ? String(mediaId) : null, username || null, message.slice(0, 1000), flow.reply_text);
  if (!claimed.changes) return false;
  const runId = Number(claimed.lastInsertRowid);
  try {
    const parsedTime = eventTime ? (typeof eventTime === 'number' || /^\d+$/.test(String(eventTime))
      ? (Number(eventTime) < 1e12 ? Number(eventTime) * 1000 : Number(eventTime))
      : new Date(eventTime).getTime()) : NaN;
    if (Number.isFinite(parsedTime) && Date.now() - parsedTime > 7 * 24 * 3600 * 1000) throw new Error('Instagram private replies are limited to seven days after a comment.');
    const result = await privateReply(userId, commentId, flow.reply_text);
    db.prepare(`UPDATE instagram_flow_runs SET status='sent',error=NULL WHERE id=?`).run(runId);
    return !!result;
  } catch (error) {
    db.prepare(`UPDATE instagram_flow_runs SET status='failed',error=? WHERE id=?`).run(String(error.message || 'Could not send private reply.').slice(0, 500), runId);
    return false;
  }
}

function ingest(userId, body) {
  const expectedAccountId = store.get(userId, 'instagram').config.accountId;
  for (const entry of body?.entry || []) {
    if (expectedAccountId && String(entry.id) !== String(expectedAccountId)) continue;
    for (const change of entry.changes || []) {
      if (change.field !== 'comments') continue;
      const value = change.value || {};
      handleComment(userId, value.id, value.from?.username, value.text, value.created_time || value.timestamp, value.media?.id)
        .catch(error => console.error('[instagram] private reply failed:', error.message));
    }
  }
  return true;
}

function list(userId) {
  const flows = db.prepare('SELECT * FROM instagram_comment_flows WHERE user_id=? ORDER BY updated_at DESC,id DESC').all(userId).map(f => ({ ...f, keywords: JSON.parse(f.keywords || '[]'), active: !!f.active }));
  const runs = db.prepare(`SELECT r.id,r.flow_id,f.name AS flow_name,f.meta_flow_id,r.media_id,r.username,r.comment,r.status,r.reply_text,r.error,r.created_at
    FROM instagram_flow_runs r LEFT JOIN instagram_comment_flows f ON f.id=r.flow_id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 100`).all(userId);
  return { flows, runs };
}

module.exports = { graph, cleanAccountId, testConnection, privateReply, listMedia, handleComment, ingest, list, verifySignature: msg.waVerifySignature };
