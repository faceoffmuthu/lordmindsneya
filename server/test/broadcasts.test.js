const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-broadcast-test-'));
const db = require('../src/db');
const store = require('../src/store');
const messaging = require('../src/integrations/messaging');

test('broadcast worker uses an approved template and records recipient outcomes', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('broadcast@example.test', 'Broadcast Owner', 'hash', 'user', '{}').lastInsertRowid);
  store.save(userId, 'whatsapp', { config: { phoneNumberId: '123456789' }, secret: { accessToken: 'test-token' } });
  const contactId = Number(db.prepare(`INSERT INTO contacts (user_id,name,phone,whatsapp_opt_in) VALUES (?,?,?,1)`)
    .run(userId, 'Ada', '+1 555 010 0001').lastInsertRowid);
  db.prepare(`INSERT INTO chats (user_id,channel,external_id,name) VALUES (?,'whatsapp',?,?)`).run(userId, '15550100001', 'Ada');
  const campaignId = Number(db.prepare(`INSERT INTO broadcasts (user_id,name,template_name,language,parameters) VALUES (?,?,?,?,?)`)
    .run(userId, 'Welcome', 'welcome_offer', 'en_US', JSON.stringify(['Ada', '20%'])).lastInsertRowid);
  const recipientId = Number(db.prepare(`INSERT INTO broadcast_recipients (broadcast_id,contact_id,name,phone) VALUES (?,?,?,?)`)
    .run(campaignId, contactId, 'Ada', '15550100001').lastInsertRowid);
  const originalFetch = global.fetch;
  let sentBody;
  global.fetch = async (_url, options) => { sentBody = JSON.parse(options.body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid-template-1' }] }) }; };
  try {
    await messaging.startBroadcast(campaignId);
    assert.equal(sentBody.type, 'template');
    assert.equal(sentBody.template.name, 'welcome_offer');
    assert.deepEqual(sentBody.template.components[0].parameters.map(p => p.text), ['Ada', '20%']);
    assert.equal(db.prepare('SELECT status FROM broadcasts WHERE id=?').get(campaignId).status, 'complete');
    assert.deepEqual(db.prepare('SELECT status,external_id FROM broadcast_recipients WHERE id=?').get(recipientId), { status: 'sent', external_id: 'wamid-template-1' });
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE direction='out' AND external_id='wamid-template-1'`).get().n, 1);
  } finally { global.fetch = originalFetch; }
});

test('broadcast worker rechecks contact opt-in before sending', async () => {
  const userId = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,permissions) VALUES (?,?,?,?,?)`)
    .run('optout@example.test', 'Opt Out Owner', 'hash', 'user', '{}').lastInsertRowid);
  store.save(userId, 'whatsapp', { config: { phoneNumberId: '123456789' }, secret: { accessToken: 'test-token' } });
  const contactId = Number(db.prepare(`INSERT INTO contacts (user_id,name,phone,whatsapp_opt_in) VALUES (?,?,?,0)`)
    .run(userId, 'No Consent', '+1 555 010 0002').lastInsertRowid);
  const campaignId = Number(db.prepare(`INSERT INTO broadcasts (user_id,name,template_name,language,parameters) VALUES (?,?,?,?,?)`)
    .run(userId, 'No consent', 'welcome_offer', 'en_US', '[]').lastInsertRowid);
  db.prepare(`INSERT INTO broadcast_recipients (broadcast_id,contact_id,name,phone) VALUES (?,?,?,?)`)
    .run(campaignId, contactId, 'No Consent', '15550100002');
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests += 1; return { ok: true, json: async () => ({}) }; };
  try {
    await messaging.startBroadcast(campaignId);
    assert.equal(requests, 0);
    assert.equal(db.prepare('SELECT status FROM broadcasts WHERE id=?').get(campaignId).status, 'failed');
    assert.match(db.prepare('SELECT error FROM broadcast_recipients WHERE broadcast_id=?').get(campaignId).error, /opt-in/);
  } finally { global.fetch = originalFetch; }
});
