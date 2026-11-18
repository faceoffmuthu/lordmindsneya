const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const webDir = path.join(root, 'web');
const source = path.join(webDir, 'dist');
const destination = path.join(root, 'server', 'public');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execFileSync(npm, ['run', 'build'], {
  cwd: webDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
console.log('Copied the web build into server/public.');
