const express = require('express');
const db = require('../db');
const store = require('../store');
const youtube = require('../integrations/youtube');
const { requirePermission } = require('../permissions');

const router = express.Router();
const keywords = value => Array.isArray(value)
  ? [...new Set(value.map(x => String(x).trim().slice(0, 80).toLocaleLowerCase()).filter(Boolean))].slice(0, 20)
  : [];
const validate = body => {
  const name = String(body?.name || '').trim().slice(0, 100);
  const replyText = String(body?.replyText || '').trim().slice(0, 1000);
  const words = keywords(body?.keywords);
  if (!name || !replyText || !words.length) throw new Error('Add a flow name, at least one keyword, and a reply.');
  return { name, replyText, keywords: words, videoId: String(body?.videoId || '').trim().slice(0, 100) || null };
};
const hasScope = (userId, scope) => (store.get(userId, 'google').config.scopes || []).includes(scope);
const requireCommentScope = async userId => {
  if (!hasScope(userId, youtube.COMMENTS_SCOPE)) throw new Error('Reconnect Google and grant YouTube comment access in Settings → Google.');
  await youtube.channel(userId);
};

router.get('/youtube/status', requirePermission('youtube'), requirePermission('google'), async (req, res) => {
  const g = store.get(req.user.id, 'google');
  const uploadAccess = hasScope(req.user.id, youtube.UPLOAD_SCOPE);
  const commentAccess = hasScope(req.user.id, youtube.COMMENTS_SCOPE);
  let connected = false; let channel = null; let error = null;
  if (g.status === 'connected' && g.secret.refreshToken) {
    try { channel = await youtube.channel(req.user.id); connected = true; }
    catch (e) { error = e.message; }
  }
  res.json({ connected, uploadAccess, commentAccess, channel, error, googleConnected: g.status === 'connected' && !!g.secret.refreshToken });
});

router.get('/youtube/flows', requirePermission('youtube'), requirePermission('google'), (req, res) => res.json(youtube.flowList(req.user.id)));
router.get('/youtube/videos', requirePermission('youtube'), requirePermission('google'), async (req, res) => {
  try { await requireCommentScope(req.user.id); res.json({ videos: await youtube.listVideos(req.user.id) }); }
  catch (error) { res.status(400).json({ error: error.message || 'Could not load YouTube videos.' }); }
});
router.post('/youtube/flows', requirePermission('youtube'), requirePermission('google'), requirePermission('write'), async (req, res) => {
  let clean;
  try { clean = validate(req.body); if (req.body?.active) await requireCommentScope(req.user.id); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const row = db.prepare('INSERT INTO youtube_comment_flows (user_id,name,keywords,reply_text,active,video_id) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, clean.name, JSON.stringify(clean.keywords), clean.replyText, req.body.active ? 1 : 0, clean.videoId);
  res.status(201).json({ flow: db.prepare('SELECT * FROM youtube_comment_flows WHERE id=? AND user_id=?').get(row.lastInsertRowid, req.user.id) });
});
router.patch('/youtube/flows/:id', requirePermission('youtube'), requirePermission('google'), requirePermission('write'), async (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM youtube_comment_flows WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!current) return res.status(404).json({ error: 'YouTube flow not found.' });
  const body = req.body || {};
  let clean;
  try { clean = validate({ name: body.name ?? current.name, replyText: body.replyText ?? current.reply_text, keywords: body.keywords ?? JSON.parse(current.keywords), videoId: body.videoId === undefined ? current.video_id : body.videoId }); if (body.active && !current.active) await requireCommentScope(req.user.id); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  db.prepare(`UPDATE youtube_comment_flows SET name=?,keywords=?,reply_text=?,active=?,video_id=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(clean.name, JSON.stringify(clean.keywords), clean.replyText, body.active === undefined ? current.active : (body.active ? 1 : 0), clean.videoId, id, req.user.id);
  res.json({ flow: db.prepare('SELECT * FROM youtube_comment_flows WHERE id=? AND user_id=?').get(id, req.user.id) });
});
router.delete('/youtube/flows/:id', requirePermission('youtube'), requirePermission('google'), requirePermission('write'), (req, res) => {
  db.prepare('DELETE FROM youtube_comment_flows WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

router.post('/youtube/poll-comments', requirePermission('youtube'), requirePermission('google'), requirePermission('write'), async (req, res) => {
  try { res.json(await youtube.pollUser(req.user.id)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/youtube/upload', requirePermission('youtube'), requirePermission('google'), requirePermission('write'), async (req, res) => {
  if (!String(req.get('content-type') || '').startsWith('video/')) return res.status(400).json({ error: 'Upload a video file with its video MIME type.' });
  let metadata;
  try { metadata = JSON.parse(Buffer.from(String(req.get('x-video-metadata') || ''), 'base64').toString('utf8')); }
  catch { return res.status(400).json({ error: 'Video metadata is invalid.' }); }
  const size = Number(metadata.fileSize);
  delete metadata.fileSize;
  if (!Number.isSafeInteger(size) || size < 1 || size > 500 * 1024 * 1024) return res.status(400).json({ error: 'Videos must be between 1 byte and 500 MB.' });
  try {
    const video = await youtube.uploadVideo(req.user.id, {
      stream: req, size, mimeType: req.get('content-type'), title: metadata.title,
      description: metadata.description, tags: metadata.tags, privacyStatus: metadata.privacyStatus, publishAt: metadata.publishAt,
    });
    res.status(201).json({ video });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;
