const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-instagram-test-'));
const db = require('../src/db');
const store = require('../src/store');
const instagram = require('../src/integrations/instagram');

test('Instagram keyword replies are private, deduplicated, and record success', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('instagram@example.test', 'Instagram Owner', 'hash', 'user', JSON.stringify({ instagram: true })).lastInsertRowid);
  store.save(userId, 'instagram', { config: { accountId: '123456789012345' }, secret: { accessToken: 'test-token' } });
  const flowId = Number(db.prepare(`INSERT INTO instagram_comment_flows (user_id,name,keywords,reply_text,active) VALUES (?,?,?,?,1)`)
    .run(userId, 'Pricing', JSON.stringify(['price']), 'Thanks! Details are in this message.').lastInsertRowid);
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async (url, options) => {
    requests += 1;
    assert.match(url, /123456789012345\/messages$/);
    assert.deepEqual(JSON.parse(options.body), { recipient: { comment_id: 'comment-1' }, message: { text: 'Thanks! Details are in this message.' } });
    return { ok: true, json: async () => ({ recipient_id: '123', message_id: 'reply-1' }) };
  };
  try {
    assert.equal(await instagram.handleComment(userId, 'comment-1', 'customer', 'What is the PRICE?', Date.now()), true);
    assert.equal(await instagram.handleComment(userId, 'comment-1', 'customer', 'What is the PRICE?', Date.now()), false);
    assert.equal(requests, 1);
    assert.equal(db.prepare('SELECT status FROM instagram_flow_runs WHERE flow_id=?').get(flowId).status, 'sent');
  } finally { global.fetch = originalFetch; }
});

test('Instagram flows reject replies older than seven days', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('oldcomment@example.test', 'Old Comment', 'hash', 'user', JSON.stringify({ instagram: true })).lastInsertRowid);
  store.save(userId, 'instagram', { config: { accountId: '123456789012346' }, secret: { accessToken: 'test-token' } });
  db.prepare(`INSERT INTO instagram_comment_flows (user_id,name,keywords,reply_text,active) VALUES (?,?,?,?,1)`)
    .run(userId, 'Details', JSON.stringify(['details']), 'Here you go.');
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests += 1; return { ok: true, json: async () => ({}) }; };
  try {
    assert.equal(await instagram.handleComment(userId, 'comment-old', 'customer', 'Please send details', Math.floor((Date.now() - 8 * 24 * 3600 * 1000) / 1000)), false);
    assert.equal(requests, 0);
    assert.match(db.prepare('SELECT error FROM instagram_flow_runs WHERE user_id=?').get(userId).error, /seven days/);
  } finally { global.fetch = originalFetch; }
});

test('Instagram comment flows only fire for the selected post', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('posttarget@example.test', 'Post Target', 'hash', 'user', JSON.stringify({ instagram: true })).lastInsertRowid);
  store.save(userId, 'instagram', { config: { accountId: '123456789012347' }, secret: { accessToken: 'test-token' } });
  db.prepare(`INSERT INTO instagram_comment_flows (user_id,name,keywords,reply_text,active,media_id) VALUES (?,?,?,?,1,?)`)
    .run(userId, 'Selected post', JSON.stringify(['price']), 'Post-specific reply', 'post-1');
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests += 1; return { ok: true, json: async () => ({ recipient_id: '123', message_id: 'reply-1' }) }; };
  try {
    assert.equal(await instagram.handleComment(userId, 'comment-other', 'customer', 'Price?', Date.now(), 'post-2'), false);
    assert.equal(await instagram.handleComment(userId, 'comment-missing-media', 'customer', 'Price?', Date.now()), false);
    assert.equal(requests, 0);
    assert.equal(await instagram.handleComment(userId, 'comment-selected', 'customer', 'Price?', Date.now(), 'post-1'), true);
    assert.equal(requests, 1);
  } finally { global.fetch = originalFetch; }
});
