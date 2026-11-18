const db = require('../db');
const google = require('./google');
const { can } = require('../permissions');
const { Transform } = require('stream');

const BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const COMMENTS_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

async function api(userId, method, params = {}, body) {
  const query = new URLSearchParams(params);
  return google.api(userId, `${BASE}/${method}${query.size ? `?${query}` : ''}`, { ...(body === undefined ? {} : { method: 'POST', body }) });
}

async function channel(userId) {
  const result = await api(userId, 'channels', { part: 'snippet,contentDetails', mine: 'true' });
  const item = result.items?.[0];
  if (!item) throw new Error('No YouTube channel is available for this Google account.');
  return { id: item.id, title: item.snippet?.title || '', uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || '' };
}

async function listVideos(userId) {
  const owner = await channel(userId);
  if (!owner.uploadsPlaylistId) return [];
  const result = await api(userId, 'playlistItems', { part: 'snippet,contentDetails', playlistId: owner.uploadsPlaylistId, maxResults: '50' });
  return (result.items || []).map(item => ({
    id: String(item.contentDetails?.videoId || ''),
    title: String(item.snippet?.title || 'Untitled video').slice(0, 200),
    publishedAt: item.snippet?.publishedAt || null,
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
  })).filter(item => item.id);
}

async function uploadVideo(userId, { buffer, stream, size, mimeType, title, description = '', tags = [], privacyStatus = 'private', publishAt = '' }) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const uploadSize = Number(size || bytes.length);
  if (!uploadSize) throw new Error('Choose a video file first.');
  if (uploadSize > 500 * 1024 * 1024) throw new Error('Videos must be 500 MB or smaller in this app.');
  if (!/^video\/[a-z0-9.+-]+$/i.test(mimeType || '')) throw new Error('Choose a supported video file.');
  const cleanTitle = String(title || '').trim().slice(0, 100);
  if (!cleanTitle) throw new Error('Add a video title.');
  if (!['private', 'unlisted', 'public'].includes(privacyStatus)) throw new Error('Choose private, unlisted, or public visibility.');
  let scheduledAt = '';
  if (publishAt) {
    const date = new Date(publishAt);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 60_000) throw new Error('Choose a publish time at least one minute in the future.');
    scheduledAt = date.toISOString();
    privacyStatus = 'private';
  }
  const token = await google.accessToken(userId);
  const metadata = {
    snippet: { title: cleanTitle, description: String(description || '').slice(0, 5000), tags: (Array.isArray(tags) ? tags : []).map(x => String(x).trim().slice(0, 50)).filter(Boolean).slice(0, 20), categoryId: '22' },
    status: { privacyStatus, ...(scheduledAt ? { publishAt: scheduledAt } : {}) },
  };
  const init = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(uploadSize) },
    body: JSON.stringify(metadata), signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!init.ok) {
    const error = await init.json().catch(() => ({}));
    throw new Error(error.error?.message || `YouTube upload initialization failed (${init.status}).`);
  }
  const location = init.headers.get('location');
  if (!location || new URL(location).hostname !== 'www.googleapis.com') throw new Error('YouTube did not return a valid resumable upload URL.');
  let body = bytes;
  let duplex;
  if (stream) {
    let received = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > 500 * 1024 * 1024 || received > uploadSize) return callback(new Error('Uploaded data exceeded the declared video size.'));
        callback(null, chunk);
      },
      flush(callback) { callback(received === uploadSize ? null : new Error('Video upload ended before all bytes arrived.')); },
    });
    body = stream.pipe(meter);
    duplex = 'half';
  }
  const sent = await fetch(location, {
    method: 'PUT', headers: { 'Content-Type': mimeType, 'Content-Length': String(uploadSize) },
    body, ...(duplex ? { duplex } : {}), signal: AbortSignal.timeout(15 * 60 * 1000), redirect: 'error',
  });
  const result = await sent.json().catch(() => ({}));
  if (!sent.ok) throw new Error(result.error?.message || `YouTube video upload failed (${sent.status}).`);
  return { id: result.id, title: result.snippet?.title || cleanTitle, privacyStatus: result.status?.privacyStatus || privacyStatus, publishAt: result.status?.publishAt || scheduledAt || null, url: result.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(result.id)}` : null };
}

async function replyToComment(userId, threadId, text) {
  const result = await api(userId, 'comments', { part: 'snippet' }, { snippet: { parentId: String(threadId), textOriginal: String(text).slice(0, 10000) } });
  return result.id || null;
}

function flowList(userId) {
  const flows = db.prepare('SELECT * FROM youtube_comment_flows WHERE user_id=? ORDER BY updated_at DESC,id DESC').all(userId).map(flow => ({ ...flow, keywords: JSON.parse(flow.keywords || '[]'), active: !!flow.active, channel: 'youtube' }));
  const runs = db.prepare(`SELECT r.id,r.flow_id,f.name AS flow_name,r.video_id,r.username,r.comment,r.status,r.reply_text,r.error,r.created_at
    FROM youtube_flow_runs r LEFT JOIN youtube_comment_flows f ON f.id=r.flow_id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 100`).all(userId);
  return { flows, runs };
}

async function pollUser(userId) {
  const user = db.prepare('SELECT role,permissions FROM users WHERE id=?').get(userId);
  if (!can(user, 'youtube') || !can(user, 'google') || !can(user, 'write')) return { replies: 0, skipped: true };
  const g = require('../store').get(userId, 'google');
  const scopes = g.config.scopes || [];
  if (!scopes.includes(COMMENTS_SCOPE)) return { replies: 0, skipped: true, reason: 'Reconnect Google and grant YouTube comment access.' };
  const flows = db.prepare('SELECT * FROM youtube_comment_flows WHERE user_id=? AND active=1 ORDER BY updated_at DESC,id DESC').all(userId);
  if (!flows.length) return { replies: 0 };
  const dailySent = db.prepare(`SELECT COUNT(*) AS n FROM youtube_flow_runs WHERE user_id=? AND status='sent' AND created_at>=datetime('now','-1 day')`).get(userId).n;
  const remainingReplies = Math.max(0, 100 - dailySent);
  if (!remainingReplies) return { replies: 0, limited: true };
  const videoIds = new Set(flows.map(flow => String(flow.video_id || '')).filter(Boolean));
  if (flows.some(flow => !flow.video_id)) {
    const owner = await channel(userId);
    if (!owner.uploadsPlaylistId) return { replies: 0 };
    const videos = await api(userId, 'playlistItems', { part: 'snippet,contentDetails', playlistId: owner.uploadsPlaylistId, maxResults: '5' });
    for (const item of videos.items || []) if (item.contentDetails?.videoId) videoIds.add(String(item.contentDetails.videoId));
  }
  let replies = 0;
  for (const videoId of videoIds) {
    const comments = await api(userId, 'commentThreads', { part: 'snippet', videoId, maxResults: '100', order: 'time' });
    for (const thread of comments.items || []) {
      const top = thread.snippet?.topLevelComment;
      const commentId = top?.id;
      const comment = String(top?.snippet?.textOriginal || top?.snippet?.textDisplay || '').trim();
      if (!commentId || !comment) continue;
      const normalized = comment.toLocaleLowerCase();
      const matchingFlows = flows.filter(candidate => {
        if (candidate.video_id && String(candidate.video_id) !== videoId) return false;
        let keywords = []; try { keywords = JSON.parse(candidate.keywords || '[]'); } catch { /* ignore malformed flow */ }
        return keywords.some(word => normalized.includes(String(word).toLocaleLowerCase()));
      });
      const flow = matchingFlows.find(candidate => candidate.video_id) || matchingFlows[0];
      if (!flow) continue;
      const claim = db.prepare(`INSERT OR IGNORE INTO youtube_flow_runs (user_id,flow_id,comment_id,video_id,username,comment,status,reply_text,error) VALUES (?,?,?,?,?,?,'failed',?,'Sending…')`)
        .run(userId, flow.id, commentId, videoId, top.snippet?.authorDisplayName || null, comment.slice(0, 5000), flow.reply_text);
      if (!claim.changes) continue;
      const runId = Number(claim.lastInsertRowid);
      try {
        const newUser = db.prepare('SELECT role,permissions FROM users WHERE id=?').get(userId);
        if (!can(newUser, 'youtube') || !can(newUser, 'google') || !can(newUser, 'write')) throw new Error('YouTube automation access was revoked before this reply was sent.');
        await replyToComment(userId, thread.id, flow.reply_text);
        db.prepare(`UPDATE youtube_flow_runs SET status='sent',error=NULL WHERE id=?`).run(runId);
        replies += 1;
      } catch (error) {
        db.prepare(`UPDATE youtube_flow_runs SET status='failed',error=? WHERE id=?`).run(String(error.message || 'Could not reply to this comment.').slice(0, 500), runId);
      }
      if (replies >= Math.min(20, remainingReplies)) return { replies, ...(remainingReplies === replies ? { limited: true } : {}) };
    }
  }
  return { replies };
}

let pollTimer;
async function pollAll() {
  const users = db.prepare('SELECT DISTINCT user_id FROM youtube_comment_flows WHERE active=1').all();
  for (const { user_id: userId } of users) {
    try { await pollUser(userId); }
    catch (error) { console.error(`[youtube] comment poll failed for account ${userId}:`, error.message); }
  }
}
function startCommentPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollAll, 15 * 60 * 1000);
  pollTimer.unref?.();
  setTimeout(pollAll, 30 * 1000).unref?.();
}

module.exports = { BASE, UPLOAD_SCOPE, COMMENTS_SCOPE, api, channel, listVideos, uploadVideo, replyToComment, flowList, pollUser, pollAll, startCommentPolling };
