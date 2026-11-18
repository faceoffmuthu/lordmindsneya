const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow;
let backend;
let quitting = false;

function writeStartupLog(message) {
  try {
    const log = path.join(app.getPath('userData'), 'desktop-startup.log');
    fs.appendFileSync(log, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Startup reporting must not prevent the app from showing its error dialog.
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requestHealth(port) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 1200 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function waitForBackend(port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await requestHealth(port)) return;
    if (backend?.exitCode !== null) throw new Error(`The local Lord Minds server stopped unexpectedly (exit code ${backend.exitCode}).`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The local Lord Minds server did not start within 30 seconds.');
}

function serverDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', 'server');
}

async function startBackend() {
  const port = await findFreePort();
  const serverDir = serverDirectory();
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    // The desktop build does not bundle n8n. A user can still connect an
    // external n8n instance from Settings when they need automation.
    N8N_LOCAL_ENABLED: 'false',
    NODE_ENV: app.isPackaged ? 'production' : 'development',
  };

  // In development, use the system Node.js runtime so server/node_modules
  // retains its normal Node ABI. A packaged Electron app uses its own runtime.
  const executable = app.isPackaged ? process.execPath : (process.env.npm_node_execpath || process.execPath);
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = '1';

  backend = spawn(executable, ['src/index.js'], {
    cwd: serverDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.stdout.on('data', (chunk) => console.log(`[lord-minds] ${chunk}`.trim()));
  backend.stderr.on('data', (chunk) => {
    const message = `[lord-minds] ${chunk}`.trim();
    console.error(message);
    writeStartupLog(message);
  });
  backend.once('error', (error) => {
    console.error('Could not launch Lord Minds server:', error);
    writeStartupLog(error.stack || error.message);
  });

  await waitForBackend(port);
  return port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: 'Lord Minds',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  return mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function stopBackend() {
  if (backend && backend.exitCode === null) backend.kill();
  backend = undefined;
}

app.whenReady().then(async () => {
  try {
    const port = await startBackend();
    await createWindow(port);
  } catch (error) {
    writeStartupLog(error.stack || error.message);
    dialog.showErrorBox('Lord Minds could not start', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  stopBackend();
});
app.on('activate', () => {
  if (!quitting && BrowserWindow.getAllWindows().length === 0) app.quit();
});
