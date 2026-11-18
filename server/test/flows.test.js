const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-flow-test-'));
const db = require('../src/db');
const store = require('../src/store');
const messaging = require('../src/integrations/messaging');

test('an active keyword flow sends one reply and ignores duplicate webhook deliveries', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('flow@example.test', 'Flow Owner', 'hash', 'user', JSON.stringify({ flows: true })).lastInsertRowid);
  const chatId = Number(db.prepare(`INSERT INTO chats (user_id,channel,external_id,name,last_inbound_at) VALUES (?,?,?,?,datetime('now'))`)
    .run(userId, 'whatsapp', '919900000001', 'Test Person').lastInsertRowid);
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
  store.save(userId, 'whatsapp', { config: { phoneNumberId: '123456789' }, secret: { accessToken: 'test-token' } });
  const flowId = db.prepare(`INSERT INTO message_flows (user_id,name,channel,keywords,reply_text,active) VALUES (?,?,?,?,?,1)`)
    .run(userId, 'Pricing', 'whatsapp', JSON.stringify(['price', 'pricing']), 'Here is the pricing.').lastInsertRowid;
  messaging.recordMessage(chat, { direction: 'in', externalId: 'in-1', text: 'What is the PRICE?' });
  const originalFetch = global.fetch;
  let sends = 0;
  global.fetch = async () => { sends += 1; return { ok: true, json: async () => ({ messages: [{ id: 'out-1' }] }) }; };
  try {
    assert.equal(await messaging.runAutoReply(userId, 'whatsapp', chat, 'in-1', 'What is the PRICE?'), true);
    assert.equal(await messaging.runAutoReply(userId, 'whatsapp', chat, 'in-1', 'What is the PRICE?'), false);
    assert.equal(sends, 1);
    assert.equal(db.prepare(`SELECT status FROM message_flow_runs WHERE flow_id=?`).get(flowId).status, 'sent');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id=? AND direction='out'`).get(chatId).n, 1);
  } finally { global.fetch = originalFetch; }
});

test('a revoked flow permission prevents automatic replies', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('restricted@example.test', 'Restricted', 'hash', 'user', JSON.stringify({ flows: false })).lastInsertRowid);
  const chatId = Number(db.prepare(`INSERT INTO chats (user_id,channel,external_id,name,last_inbound_at) VALUES (?,?,?,?,datetime('now'))`)
    .run(userId, 'telegram', 'chat-2', 'Test Telegram').lastInsertRowid);
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId);
  db.prepare(`INSERT INTO message_flows (user_id,name,channel,keywords,reply_text,active) VALUES (?,?,?,?,?,1)`)
    .run(userId, 'Greeting', 'telegram', JSON.stringify(['hello']), 'Hello!');
  assert.equal(await messaging.runAutoReply(userId, 'telegram', chat, 'in-2', 'hello'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM message_flow_runs WHERE user_id=?').get(userId).n, 0);
});
