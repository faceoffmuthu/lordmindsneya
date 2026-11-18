const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-messenger-test-'));
const db = require('../src/db');
const store = require('../src/store');
const messenger = require('../src/integrations/messenger');

test('Messenger uses the shared active Meta flow and deduplicates delivery', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('messenger@example.test', 'Messenger Owner', 'hash', 'user', '{}').lastInsertRowid);
  store.save(userId, 'whatsapp', { secret: { accessToken: 'wa-token' } });
  store.save(userId, 'instagram', { secret: { accessToken: 'ig-token' } });
  store.save(userId, 'messenger', { config: { pageId: '123456789012345' }, secret: { accessToken: 'page-token' } });
  const flowId = Number(db.prepare(`INSERT INTO meta_message_flows (user_id,name,keywords,reply_text,active) VALUES (?,?,?,?,1)`)
    .run(userId, 'Pricing', JSON.stringify(['price']), 'Here are our plans.').lastInsertRowid);
  const originalFetch = global.fetch;
  let sends = 0;
  global.fetch = async (url, options) => {
    sends += 1;
    assert.match(String(url), /123456789012345\/messages$/);
    assert.deepEqual(JSON.parse(options.body), { recipient: { id: 'psid-1' }, messaging_type: 'RESPONSE', message: { text: 'Here are our plans.' } });
    return { ok: true, json: async () => ({ recipient_id: 'psid-1', message_id: 'sent-1' }) };
  };
  try {
    assert.equal(await messenger.handleMessage(userId, 'psid-1', 'mid-1', 'How much is the PRICE?'), true);
    assert.equal(await messenger.handleMessage(userId, 'psid-1', 'mid-1', 'How much is the PRICE?'), false);
    assert.equal(sends, 1);
    assert.equal(db.prepare('SELECT status FROM messenger_flow_runs WHERE flow_id=?').get(flowId).status, 'sent');
  } finally { global.fetch = originalFetch; }
});
