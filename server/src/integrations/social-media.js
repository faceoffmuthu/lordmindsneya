// Short-lived, unguessable media URLs that Meta can fetch while a publish is
// in progress. Tokens are memory-only and files are removed after expiry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('../config');

const directory = path.join(DATA_DIR, 'social-media');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const name of fs.readdirSync(directory)) fs.rmSync(path.join(directory, name), { recursive: true, force: true });
const assets = new Map();

function create(mimeType, size) {
  const token = crypto.randomBytes(32).toString('hex');
  const file = path.join(directory, token);
  const expiresAt = Date.now() + 10 * 60 * 1000;
  assets.set(token, { file, mimeType, size, expiresAt });
  return { token, file, expiresAt };
}

function get(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const asset = assets.get(token);
  if (!asset) return null;
  if (asset.expiresAt <= Date.now()) { remove(token); return null; }
  return asset;
}

function remove(token) {
  const asset = assets.get(token);
  if (asset) fs.rm(asset.file, { force: true }, () => {});
  assets.delete(token);
}

module.exports = { create, get, remove };
