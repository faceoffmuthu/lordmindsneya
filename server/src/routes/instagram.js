const express = require('express');
const db = require('../db');
const store = require('../store');
const { requirePermission } = require('../permissions');
const instagram = require('../integrations/instagram');

const router = express.Router();
const normalizeKeywords = value => Array.isArray(value)
  ? [...new Set(value.map(x => String(x).trim().slice(0, 80).toLocaleLowerCase()).filter(Boolean))].slice(0, 20)
  : [];
const view = flow => ({ ...flow, keywords: JSON.parse(flow.keywords || '[]'), active: !!flow.active });
const requireInstagramConnection = userId => {
  const connection = store.get(userId, 'instagram');
  if (!connection.config.accountId || !connection.secret.accessToken) throw new Error('Connect Instagram in Settings before turning this flow live.');
};

router.get('/instagram/media', requirePermission('instagram'), async (req, res) => {
  try { res.json({ media: await instagram.listMedia(req.user.id) }); }
  catch (error) { res.status(400).json({ error: error.message || 'Could not load Instagram posts.' }); }
});

router.get('/instagram/flows', requirePermission('instagram'), (req, res) => {
  const data = instagram.list(req.user.id);
  res.json({ ...data, flows: data.flows.filter(flow => !flow.meta_flow_id), runs: data.runs.filter(run => !run.meta_flow_id) });
});
router.post('/instagram/flows', requirePermission('instagram'), requirePermission('write'), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const replyText = String(req.body?.replyText || '').trim().slice(0, 1000);
  const mediaId = String(req.body?.mediaId || '').trim().slice(0, 100) || null;
  const keywords = normalizeKeywords(req.body?.keywords);
  if (!name || !replyText || !keywords.length) return res.status(400).json({ error: 'Add a flow name, at least one keyword, and a private reply.' });
  try { if (req.body?.active) requireInstagramConnection(req.user.id); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const row = db.prepare('INSERT INTO instagram_comment_flows (user_id,name,keywords,reply_text,active,media_id) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, name, JSON.stringify(keywords), replyText, req.body?.active ? 1 : 0, mediaId);
  res.status(201).json({ flow: view(db.prepare('SELECT * FROM instagram_comment_flows WHERE id=? AND user_id=?').get(row.lastInsertRowid, req.user.id)) });
});
router.patch('/instagram/flows/:id', requirePermission('instagram'), requirePermission('write'), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM instagram_comment_flows WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!current) return res.status(404).json({ error: 'Instagram flow not found.' });
  const b = req.body || {};
  const name = b.name === undefined ? current.name : String(b.name).trim().slice(0, 100);
  const replyText = b.replyText === undefined ? current.reply_text : String(b.replyText).trim().slice(0, 1000);
  const mediaId = b.mediaId === undefined ? current.media_id : (String(b.mediaId || '').trim().slice(0, 100) || null);
  const words = b.keywords === undefined ? JSON.parse(current.keywords) : normalizeKeywords(b.keywords);
  if (!name || !replyText || !words.length) return res.status(400).json({ error: 'Add a flow name, at least one keyword, and a private reply.' });
  try { if (b.active && !current.active) requireInstagramConnection(req.user.id); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  db.prepare(`UPDATE instagram_comment_flows SET name=?,keywords=?,reply_text=?,active=?,media_id=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, JSON.stringify(words), replyText, b.active === undefined ? current.active : (b.active ? 1 : 0), mediaId, id, req.user.id);
  res.json({ flow: view(db.prepare('SELECT * FROM instagram_comment_flows WHERE id=? AND user_id=?').get(id, req.user.id)) });
});
router.delete('/instagram/flows/:id', requirePermission('instagram'), requirePermission('write'), (req, res) => {
  db.prepare('DELETE FROM instagram_comment_flows WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
