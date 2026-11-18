const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-youtube-test-'));
const db = require('../src/db');
const store = require('../src/store');
const youtube = require('../src/integrations/youtube');
const google = require('../src/integrations/google');

function user(email) {
  return Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run(email, 'YouTube Owner', 'hash', 'user', '{}').lastInsertRowid);
}

test('YouTube scopes are requested separately from standard Google access', () => {
  const standard = new URL(google.authUrl({ clientId: 'client', redirectUri: 'https://example.test/callback', state: 'state' }));
  const youtubeAuth = new URL(google.authUrl({ clientId: 'client', redirectUri: 'https://example.test/callback', state: 'state', includeYoutube: true }));
  assert.equal(standard.searchParams.get('scope').includes(youtube.UPLOAD_SCOPE), false);
  assert.equal(standard.searchParams.get('scope').includes(youtube.COMMENTS_SCOPE), false);
  assert.equal(youtubeAuth.searchParams.get('scope').includes(youtube.UPLOAD_SCOPE), true);
  assert.equal(youtubeAuth.searchParams.get('scope').includes(youtube.COMMENTS_SCOPE), true);
});

test('YouTube video upload uses resumable metadata and keeps scheduled videos private', async () => {
  const userId = user('upload@example.test');
  store.save(userId, 'google', { config: { scopes: [youtube.UPLOAD_SCOPE], expiresAt: Date.now() + 3600000 }, secret: { accessToken: 'test-token' }, status: 'connected' });
  const originalFetch = global.fetch;
  let initBody; let bytesSent;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://www.googleapis.com/upload/youtube/v3/videos') && options.method === 'POST') {
      initBody = JSON.parse(options.body);
      return { ok: true, headers: { get: name => name.toLowerCase() === 'location' ? 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test' : null } };
    }
    bytesSent = Buffer.from(options.body);
    return { ok: true, json: async () => ({ id: 'video-1', snippet: { title: 'Launch' }, status: { privacyStatus: 'private', publishAt: '2027-01-01T12:00:00.000Z' } }) };
  };
  try {
    const video = await youtube.uploadVideo(userId, { buffer: Buffer.from('video bytes'), mimeType: 'video/mp4', title: 'Launch', publishAt: '2027-01-01T12:00:00.000Z' });
    assert.equal(initBody.status.privacyStatus, 'private');
    assert.equal(initBody.status.publishAt, '2027-01-01T12:00:00.000Z');
    assert.equal(bytesSent.toString(), 'video bytes');
    assert.equal(video.url, 'https://www.youtube.com/watch?v=video-1');
  } finally { global.fetch = originalFetch; }
});

test('YouTube polling only replies to comments on a flow-selected video and deduplicates repeats', async () => {
  const userId = user('comments@example.test');
  store.save(userId, 'google', { config: { scopes: [youtube.COMMENTS_SCOPE], expiresAt: Date.now() + 3600000 }, secret: { accessToken: 'test-token' }, status: 'connected' });
  const flowId = Number(db.prepare(`INSERT INTO youtube_comment_flows (user_id,name,keywords,reply_text,active) VALUES (?,?,?,?,1)`)
    .run(userId, 'Pricing', JSON.stringify(['price']), 'Our plans start at $10.').lastInsertRowid);
  db.prepare('UPDATE youtube_comment_flows SET video_id=? WHERE id=?').run('video-1', flowId);
  const originalFetch = global.fetch;
  let sends = 0;
  const checkedVideos = [];
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.includes('/channels?')) return { ok: true, json: async () => ({ items: [{ id: 'channel-1', snippet: { title: 'Test' }, contentDetails: { relatedPlaylists: { uploads: 'uploads-1' } } }] }) };
    if (value.includes('/playlistItems?')) return { ok: true, json: async () => ({ items: [{ contentDetails: { videoId: 'video-1' } }, { contentDetails: { videoId: 'video-2' } }] }) };
    if (value.includes('/commentThreads?')) {
      const videoId = new URL(value).searchParams.get('videoId');
      checkedVideos.push(videoId);
      return { ok: true, json: async () => ({ items: [{ id: `thread-${videoId}`, snippet: { topLevelComment: { id: `comment-${videoId}`, snippet: { textOriginal: 'What is the price?', authorDisplayName: 'Viewer' } } } }] }) };
    }
    if (value.includes('/comments?')) {
      sends += 1;
      assert.deepEqual(JSON.parse(options.body), { snippet: { parentId: 'thread-video-1', textOriginal: 'Our plans start at $10.' } });
      return { ok: true, json: async () => ({ id: 'reply-1' }) };
    }
    throw new Error(`Unexpected URL: ${value}`);
  };
  try {
    assert.deepEqual(await youtube.pollUser(userId), { replies: 1 });
    assert.deepEqual(await youtube.pollUser(userId), { replies: 0 });
    assert.equal(sends, 1);
    assert.deepEqual(checkedVideos, ['video-1', 'video-1']);
    assert.equal(db.prepare('SELECT status FROM youtube_flow_runs WHERE flow_id=?').get(flowId).status, 'sent');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM youtube_flow_runs WHERE flow_id=?').get(flowId).n, 1);
  } finally { global.fetch = originalFetch; }
});
