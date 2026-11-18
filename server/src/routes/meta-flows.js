const express = require('express');
const db = require('../db');
const store = require('../store');
const { can, requirePermission } = require('../permissions');

const router = express.Router();
const normalizeKeywords = value => Array.isArray(value)
  ? [...new Set(value.map(x => String(x).trim().slice(0, 80).toLocaleLowerCase()).filter(Boolean))].slice(0, 20)
  : [];
const view = flow => ({ ...flow, keywords: JSON.parse(flow.keywords || '[]'), active: !!flow.active, channel: 'meta' });
const canUseMeta = user => can(user, 'flows') && can(user, 'whatsapp') && can(user, 'instagram') && can(user, 'messenger');
const ensureConnected = userId => {
  if (!store.get(userId, 'whatsapp').secret.accessToken) throw new Error('Connect WhatsApp before turning a Meta flow live.');
  if (!store.get(userId, 'instagram').secret.accessToken) throw new Error('Connect Instagram before turning a Meta flow live.');
  if (!store.get(userId, 'messenger').secret.accessToken) throw new Error('Connect Facebook Messenger before turning a Meta flow live.');
};
const validate = body => {
  const name = String(body?.name || '').trim().slice(0, 100);
  const replyText = String(body?.replyText || '').trim().slice(0, 1000);
  const keywords = normalizeKeywords(body?.keywords);
  if (!name || !replyText || !keywords.length) throw new Error('Add a flow name, at least one keyword, and a reply.');
  return { name, replyText, keywords };
};

router.get('/meta/flows', requirePermission('flows'), requirePermission('whatsapp'), requirePermission('instagram'), requirePermission('messenger'), (req, res) => {
  const flows = db.prepare('SELECT * FROM meta_message_flows WHERE user_id=? ORDER BY updated_at DESC,id DESC').all(req.user.id).map(view);
  const runs = db.prepare(`SELECT * FROM (
      SELECT r.id,r.flow_id,f.name AS flow_name,'whatsapp' AS channel,c.name AS chat_name,r.status,r.reply_text,r.error,r.created_at
        FROM message_flow_runs r JOIN message_flows f ON f.id=r.flow_id LEFT JOIN chats c ON c.id=r.chat_id
        WHERE r.user_id=? AND f.meta_flow_id IS NOT NULL
      UNION ALL
      SELECT r.id,r.flow_id,f.name AS flow_name,'instagram' AS channel,CASE WHEN r.username IS NULL THEN 'Instagram comment' ELSE '@'||r.username END AS chat_name,r.status,r.reply_text,r.error,r.created_at
        FROM instagram_flow_runs r JOIN instagram_comment_flows f ON f.id=r.flow_id
        WHERE r.user_id=? AND f.meta_flow_id IS NOT NULL
      UNION ALL
      SELECT r.id,r.flow_id,f.name AS flow_name,'messenger' AS channel,'Facebook user '||r.sender_id AS chat_name,r.status,r.reply_text,r.error,r.created_at
        FROM messenger_flow_runs r JOIN meta_message_flows f ON f.id=r.flow_id
        WHERE r.user_id=?
    ) ORDER BY created_at DESC,id DESC LIMIT 100`).all(req.user.id, req.user.id, req.user.id);
  res.json({ flows, runs });
});

router.post('/meta/flows', requirePermission('flows'), requirePermission('whatsapp'), requirePermission('instagram'), requirePermission('messenger'), requirePermission('write'), (req, res) => {
  let clean;
  try { clean = validate(req.body); if (req.body?.active) ensureConnected(req.user.id); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const create = db.transaction(() => {
    const parent = db.prepare('INSERT INTO meta_message_flows (user_id,name,keywords,reply_text,active) VALUES (?,?,?,?,?)')
      .run(req.user.id, clean.name, JSON.stringify(clean.keywords), clean.replyText, req.body.active ? 1 : 0);
    const id = Number(parent.lastInsertRowid);
    db.prepare(`INSERT INTO message_flows (user_id,name,channel,keywords,reply_text,active,meta_flow_id) VALUES (?,?,'whatsapp',?,?,?,?)`)
      .run(req.user.id, clean.name, JSON.stringify(clean.keywords), clean.replyText, req.body.active ? 1 : 0, id);
    db.prepare('INSERT INTO instagram_comment_flows (user_id,name,keywords,reply_text,active,meta_flow_id) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, clean.name, JSON.stringify(clean.keywords), clean.replyText, req.body.active ? 1 : 0, id);
    return id;
  });
  const id = create();
  res.status(201).json({ flow: view(db.prepare('SELECT * FROM meta_message_flows WHERE id=? AND user_id=?').get(id, req.user.id)) });
});

router.patch('/meta/flows/:id', requirePermission('flows'), requirePermission('whatsapp'), requirePermission('instagram'), requirePermission('messenger'), requirePermission('write'), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM meta_message_flows WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!current) return res.status(404).json({ error: 'Meta flow not found.' });
  const body = req.body || {};
  let clean;
  try { clean = validate({ name: body.name ?? current.name, replyText: body.replyText ?? current.reply_text, keywords: body.keywords ?? JSON.parse(current.keywords) }); if (body.active && !current.active) ensureConnected(req.user.id); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const active = body.active === undefined ? !!current.active : !!body.active;
  const update = db.transaction(() => {
    db.prepare(`UPDATE meta_message_flows SET name=?,keywords=?,reply_text=?,active=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
      .run(clean.name, JSON.stringify(clean.keywords), clean.replyText, active ? 1 : 0, id, req.user.id);
    db.prepare(`UPDATE message_flows SET name=?,keywords=?,reply_text=?,active=?,updated_at=datetime('now') WHERE user_id=? AND meta_flow_id=?`)
      .run(clean.name, JSON.stringify(clean.keywords), clean.replyText, active ? 1 : 0, req.user.id, id);
    db.prepare(`UPDATE instagram_comment_flows SET name=?,keywords=?,reply_text=?,active=?,updated_at=datetime('now') WHERE user_id=? AND meta_flow_id=?`)
      .run(clean.name, JSON.stringify(clean.keywords), clean.replyText, active ? 1 : 0, req.user.id, id);
  });
  update();
  res.json({ flow: view(db.prepare('SELECT * FROM meta_message_flows WHERE id=? AND user_id=?').get(id, req.user.id)) });
});

router.delete('/meta/flows/:id', requirePermission('flows'), requirePermission('whatsapp'), requirePermission('instagram'), requirePermission('messenger'), requirePermission('write'), (req, res) => {
  db.prepare('DELETE FROM meta_message_flows WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
