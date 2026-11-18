const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lordminds-n8n-test-'));
process.env.N8N_LOCAL_ENABLED = 'true';
process.env.N8N_PUBLIC_URL = 'http://localhost:5678';
process.env.N8N_INTERNAL_URL = 'http://n8n:5678';
const n8n = require('../src/integrations/n8n');

test('n8n URL validation allows local HTTP and requires HTTPS remotely', () => {
  assert.equal(n8n.cleanBase('http://localhost:5678/'), 'http://localhost:5678');
  assert.equal(n8n.cleanBase('https://automation.example.com/'), 'https://automation.example.com');
  assert.throws(() => n8n.cleanBase('http://automation.example.com'), /HTTPS/);
  assert.throws(() => n8n.cleanBase('http://user:pass@localhost:5678'), /without credentials/);
});

test('local n8n API requests use the container network URL while keeping the browser URL local', async () => {
  const originalFetch = global.fetch;
  const called = [];
  global.fetch = async url => {
    called.push(String(url));
    return { ok: true, json: async () => ({ data: [{ id: 'flow-1', name: 'Local flow', active: true }] }) };
  };
  try {
    const workflows = await n8n.request('http://localhost:5678', 'test-api-key');
    assert.match(called[0], /^http:\/\/n8n:5678\/api\/v1\/workflows\?/);
    assert.deepEqual(workflows, [{ id: 'flow-1', name: 'Local flow', active: true, updatedAt: null, createdAt: null }]);
  } finally { global.fetch = originalFetch; }
});
