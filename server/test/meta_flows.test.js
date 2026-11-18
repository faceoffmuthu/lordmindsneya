const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-meta-flow-test-'));
const express = require('express');
const db = require('../src/db');

test('a Meta flow creates, updates, and deletes WhatsApp and Instagram rules together', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('meta@example.test', 'Meta Owner', 'hash', 'user', '{}').lastInsertRowid);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, role: 'user', permissions: '{}' }; next(); });
  app.use(require('../src/routes/meta-flows'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/meta/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Info', keywords: ['price'], replyText: 'Thanks!', active: false }) });
    assert.equal(created.status, 201);
    const { flow } = await created.json();
    assert.equal(flow.channel, 'meta');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_flows WHERE meta_flow_id=? AND channel=\'whatsapp\'').get(flow.id).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instagram_comment_flows WHERE meta_flow_id=?').get(flow.id).n, 1);
    const listed = await fetch(`${base}/meta/flows`);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).flows.length, 1);
    const updated = await fetch(`${base}/meta/flows/${flow.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replyText: 'Updated reply' }) });
    assert.equal(updated.status, 200);
    assert.equal(db.prepare('SELECT reply_text FROM message_flows WHERE meta_flow_id=?').get(flow.id).reply_text, 'Updated reply');
    assert.equal(db.prepare('SELECT reply_text FROM instagram_comment_flows WHERE meta_flow_id=?').get(flow.id).reply_text, 'Updated reply');
    const removed = await fetch(`${base}/meta/flows/${flow.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_flows WHERE meta_flow_id=?').get(flow.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM instagram_comment_flows WHERE meta_flow_id=?').get(flow.id).n, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
