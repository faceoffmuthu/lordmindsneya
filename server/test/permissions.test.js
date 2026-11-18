const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PERMISSIONS, permissionsFor, normalizePermissions, toolAllowed } = require('../src/permissions');

test('admins retain every workspace capability', () => {
  assert.deepEqual(permissionsFor({ role: 'admin', permissions: '{}' }), { ...DEFAULT_PERMISSIONS });
});

test('existing user records keep default access for permission keys not yet stored', () => {
  const p = permissionsFor({ role: 'user', permissions: '{"assistant":true,"google":false}' });
  assert.equal(p.google, false);
  assert.equal(p.crm, true);
  assert.equal(p.write, true);
});

test('explicitly disabled CRM and write permissions restrict their tools', () => {
  const user = { role: 'user', permissions: { crm: false, write: false } };
  assert.equal(toolAllowed({ name: 'search_contacts', permission: 'crm' }, user), false);
  assert.equal(toolAllowed({ name: 'prepare_email', permission: 'google', drafts: true }, user), false);
});

test('new invitations receive a complete normalized access map', () => {
  const p = normalizePermissions({ crm: false });
  assert.equal(p.crm, false);
  assert.equal(p.assistant, true);
  assert.equal(p.google, true);
  assert.equal(Object.keys(p).length, Object.keys(DEFAULT_PERMISSIONS).length);
});
