const express = require('express');
const fs = require('fs');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const store = require('../store');
const baseUrl = require('../baseUrl');
const media = require('../integrations/social-media');
const { can, requirePermission } = require('../permissions');

const router = express.Router();
const GRAPH = 'https://graph.facebook.com/v27.0';
const MAX_MEDIA = 500 * 1024 * 1024;
const SAFE_MIME = /^(image\/(jpeg|png)|video\/(mp4|quicktime|mpeg|webm))$/i;

async function graphPost(path, accessToken, fields) {
  const form = new URLSearchParams({ ...fields, access_token: accessToken });
  const response = await fetch(`${GRAPH}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(150000), redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.error_user_msg || data.error?.message || `Meta publishing failed (${response.status}).`);
  return data;
}

async function instagramPublish(userId, mimeType, url, caption) {
  const connection = store.get(userId, 'instagram');
  if (!connection.config.accountId || !connection.secret.accessToken) throw new Error('Connect an Instagram professional account in Settings → Instagram.');
  const video = mimeType.startsWith('video/');
  if (!video && mimeType !== 'image/jpeg') throw new Error('Instagram photo publishing requires a JPEG image.');
  const payload = video
    ? { media_type: 'REELS', video_url: url, caption, share_to_feed: 'true' }
    : { image_url: url, caption };
  const created = await graphPost(`/${encodeURIComponent(connection.config.accountId)}/media`, connection.secret.accessToken, payload);
  if (!created.id) throw new Error('Instagram did not return a media container.');
  if (video) {
    let finished = false;
    for (let i = 0; i < 40; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const check = await fetch(`${GRAPH}/${encodeURIComponent(created.id)}?fields=status_code&access_token=${encodeURIComponent(connection.secret.accessToken)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      const state = await check.json().catch(() => ({}));
      if (!check.ok || state.error) throw new Error(state.error?.message || 'Instagram could not process this video.');
      if (state.status_code === 'FINISHED') { finished = true; break; }
      if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') throw new Error('Instagram could not process this video. Check the video format and try again.');
    }
    if (!finished) throw new Error('Instagram is still processing this Reel. Try again later.');
  }
  const published = await graphPost(`/${encodeURIComponent(connection.config.accountId)}/media_publish`, connection.secret.accessToken, { creation_id: created.id });
  const details = await fetch(`${GRAPH}/${encodeURIComponent(published.id)}?fields=permalink&access_token=${encodeURIComponent(connection.secret.accessToken)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const post = await details.json().catch(() => ({}));
  return { id: published.id, url: post.permalink || 'https://www.instagram.com/' };
}

async function facebookPublish(userId, mimeType, url, caption) {
  const connection = store.get(userId, 'messenger');
  if (!connection.config.pageId || !connection.secret.accessToken) throw new Error('Connect a Facebook Page in Settings → Messenger.');
  const video = mimeType.startsWith('video/');
  const result = await graphPost(`/${encodeURIComponent(connection.config.pageId)}/${video ? 'videos' : 'photos'}`, connection.secret.accessToken,
    video ? { file_url: url, description: caption } : { url, caption });
  const id = result.post_id || result.id;
  return { id, url: id ? `https://www.facebook.com/${encodeURIComponent(id)}` : 'https://www.facebook.com/' };
}

router.post('/social/publish', requirePermission('write'), async (req, res) => {
  const destination = String(req.get('x-social-destination') || '');
  const permissions = { youtube: 'youtube', instagram: 'instagram', facebook: 'messenger' };
  const permission = permissions[destination];
  if (!permission) return res.status(400).json({ error: 'Choose YouTube, Instagram, or Facebook.' });
  if (!can(req.user, permission)) return res.status(403).json({ error: `Your account cannot publish to ${destination}. Ask an admin to change your access.` });
  const mimeType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!SAFE_MIME.test(mimeType)) return res.status(415).json({ error: 'Choose a JPEG or PNG image, or an MP4/MOV/WebM video.' });
  const size = Number(req.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_MEDIA) return res.status(413).json({ error: 'Media must be between 1 byte and 500 MB.' });
  let metadata;
  try { metadata = JSON.parse(Buffer.from(String(req.get('x-social-metadata') || ''), 'base64').toString('utf8')); }
  catch { return res.status(400).json({ error: 'Post details are invalid.' }); }
  const caption = String(metadata.caption || '').trim().slice(0, 2200);
  if (!caption) return res.status(400).json({ error: 'Write a caption before publishing.' });
  const origin = baseUrl(req);
  if (!/^https:\/\//i.test(origin) || /localhost|127\.0\.0\.1/i.test(origin)) return res.status(400).json({ error: 'Direct Instagram and Facebook publishing needs a public HTTPS address. Set PUBLIC_URL to your deployed Lord Minds URL.' });
  const asset = media.create(mimeType, size);
  let received = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; callback(received > size || received > MAX_MEDIA ? new Error('Uploaded data exceeded the declared file size.') : null, chunk); }, flush(callback) { callback(received === size ? null : new Error('The upload ended before all file data arrived.')); } });
  try {
    await pipeline(req, meter, fs.createWriteStream(asset.file, { mode: 0o600 }));
    const url = `${origin}/api/social-media/${asset.token}`;
    const post = destination === 'instagram'
      ? await instagramPublish(req.user.id, mimeType, url, caption)
      : await facebookPublish(req.user.id, mimeType, url, caption);
    res.status(201).json({ post: { ...post, destination, caption } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not publish this post.' });
  } finally { media.remove(asset.token); }
});

module.exports = router;
