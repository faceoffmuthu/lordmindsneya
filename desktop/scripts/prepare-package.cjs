const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..');
const root = path.resolve(desktopDir, '..');
const source = path.join(root, 'server');
const stage = path.join(desktopDir, '.stage', 'server');
const excludedRoots = new Set(['data', '.env']);

function include(sourcePath) {
  const relative = path.relative(source, sourcePath);
  if (!relative) return true;
  return !excludedRoots.has(relative.split(path.sep)[0]);
}

async function main() {
  execFileSync(process.execPath, [path.join(__dirname, 'sync-web.cjs')], { stdio: 'inherit' });
  fs.rmSync(path.join(desktopDir, '.stage'), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(stage), { recursive: true });
  fs.cpSync(source, stage, { recursive: true, filter: include });

  const sqliteBinary = path.join(stage, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node');
  if (process.platform === 'win32' && !fs.existsSync(sqliteBinary)) {
    throw new Error('The Windows prebuilt better-sqlite3 binary is missing. Run npm ci in server first.');
  }
  console.log('Prepared packaged Lord Minds server resources with the included SQLite binary.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
