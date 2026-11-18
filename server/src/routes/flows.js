const express = require('express');
const db = require('../db');
const { requirePermission, can } = require('../permissions');

const router = express.Router();
const CHANNELS = new Set(['whatsapp', 'telegram', 'all']);
const channelAllowed = (user, channel) => channel === 'all' ? can(user, 'whatsapp') && can(user, 'telegram') : can(user, channel);
const keywords = value => Array.isArray(value)
  ? [...new Set(value.map(x => String(x).trim().slice(0, 80).toLocaleLowerCase()).filter(Boolean))].slice(0, 20)
  : [];
const viewFlow = f => ({ ...f, keywords: JSON.parse(f.keywords || '[]'), active: !!f.active });

router.get('/flows', requirePermission('flows'), (req, res) => {
  const flows = db.prepare('SELECT * FROM message_flows WHERE user_id=? AND meta_flow_id IS NULL ORDER BY updated_at DESC,id DESC').all(req.user.id).filter(flow => channelAllowed(req.user, flow.channel)).map(viewFlow);
  const runs = db.prepare(`SELECT r.id,r.flow_id,f.name AS flow_name,r.channel,c.name AS chat_name,r.status,r.reply_text,r.error,r.created_at
    FROM message_flow_runs r LEFT JOIN message_flows f ON f.id=r.flow_id LEFT JOIN chats c ON c.id=r.chat_id
    WHERE r.user_id=? ORDER BY r.id DESC LIMIT 100`).all(req.user.id);
  res.json({ flows, runs: runs.filter(run => can(req.user, run.channel)) });
});

router.post('/flows', requirePermission('flows'), requirePermission('write'), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const reply = String(b.replyText || '').trim().slice(0, 1000);
  const words = keywords(b.keywords);
  if (!name) return res.status(400).json({ error: 'Name this flow.' });
  if (!CHANNELS.has(b.channel)) return res.status(400).json({ error: 'Choose WhatsApp, Telegram, or both channels.' });
  if (!words.length) return res.status(400).json({ error: 'Add at least one keyword.' });
  if (!reply) return res.status(400).json({ error: 'Write the automatic reply.' });
  if (!channelAllowed(req.user, b.channel)) return res.status(403).json({ error: 'Your account does not have access to that messaging channel.' });
  const result = db.prepare('INSERT INTO message_flows (user_id,name,channel,keywords,reply_text,active) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, name, b.channel, JSON.stringify(words), reply, b.active ? 1 : 0);
  res.status(201).json({ flow: viewFlow(db.prepare('SELECT * FROM message_flows WHERE id=? AND user_id=?').get(result.lastInsertRowid, req.user.id)) });
});

router.patch('/flows/:id', requirePermission('flows'), requirePermission('write'), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM message_flows WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!current) return res.status(404).json({ error: 'Flow not found.' });
  const b = req.body || {};
  const name = b.name === undefined ? current.name : String(b.name).trim().slice(0, 100);
  const reply = b.replyText === undefined ? current.reply_text : String(b.replyText).trim().slice(0, 1000);
  const channel = b.channel === undefined ? current.channel : b.channel;
  const words = b.keywords === undefined ? JSON.parse(current.keywords) : keywords(b.keywords);
  if (!name || !reply || !CHANNELS.has(channel) || !words.length) return res.status(400).json({ error: 'Add a name, channel, keyword, and reply.' });
  if (!channelAllowed(req.user, channel)) return res.status(403).json({ error: 'Your account does not have access to that messaging channel.' });
  db.prepare(`UPDATE message_flows SET name=?,channel=?,keywords=?,reply_text=?,active=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, channel, JSON.stringify(words), reply, b.active === undefined ? current.active : (b.active ? 1 : 0), id, req.user.id);
  res.json({ flow: viewFlow(db.prepare('SELECT * FROM message_flows WHERE id=? AND user_id=?').get(id, req.user.id)) });
});

router.delete('/flows/:id', requirePermission('flows'), requirePermission('write'), (req, res) => {
  db.prepare('DELETE FROM message_flows WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
