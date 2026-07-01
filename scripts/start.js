#!/usr/bin/env node
/**
 * Cross-platform startup launcher for Tandem Browser.
 *
 * This folds the previous npm start shell preflight and Electron spawn helper
 * into one Node entrypoint so startup works from macOS, Windows, and Linux.
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const apiPort = String(readConfiguredApiPort());
const skipCompile = process.argv.includes('--skip-compile');

function tandemDataDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA && process.env.APPDATA.trim()
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Tandem Browser');
  }
  return path.join(os.homedir(), '.tandem');
}

function parseApiPort(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function readConfiguredApiPort() {
  const envPort = parseApiPort(process.env.TANDEM_API_PORT);
  if (envPort) return envPort;

  const portPath = path.join(tandemDataDir(), 'api-port');
  try {
    if (fs.existsSync(portPath)) {
      const port = parseApiPort(fs.readFileSync(portPath, 'utf-8'));
      if (port) return port;
    }
  } catch {}

  const configPath = path.join(tandemDataDir(), 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const port = parseApiPort(cfg && cfg.general && cfg.general.apiPort);
      if (port) return port;
    }
  } catch {}

  return 8765;
}

function runXattrClear(electronApp) {
  return new Promise((resolve) => {
    execFile('xattr', ['-cr', electronApp], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runLsofPortLookup() {
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `:${apiPort}`], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runKillPids(pids) {
  return new Promise((resolve) => {
    execFile('kill', ['-9', ...pids], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runPsLookup(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'comm=', '-o', 'args='], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runNetstat() {
  return new Promise((resolve) => {
    execFile('netstat.exe', ['-ano'], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runTaskkill(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', pid, '/F'], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runWindowsProcessLookup(pid) {
  return new Promise((resolve) => {
    execFile('wmic.exe', ['process', 'where', `ProcessId=${pid}`, 'get', 'Name,CommandLine', '/FORMAT:LIST'], { cwd: root }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: false
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

async function runCompile() {
  if (skipCompile) {
    console.log('[start] Skipping compile');
    return;
  }

  const npmCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const npmArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run compile']
    : ['run', 'compile'];
  console.log('[start] Compiling TypeScript and preload bundle...');
  await runCommand(npmCommand, npmArgs, 'npm run compile');
}

async function clearMacOSQuarantine() {
  if (process.platform !== 'darwin') return;

  const electronApp = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
  const result = await runXattrClear(electronApp);
  if (!result.error) {
    console.log('[start] Cleared macOS quarantine flags');
  }
}

async function killUnixPortProcess() {
  const result = await runLsofPortLookup();
  const pids = result.stdout
    .split(/\r?\n/)
    .map((pid) => pid.trim())
    .filter(Boolean);

  if (pids.length === 0) return;

  const safePids = [];
  const unsafePids = [];
  for (const pid of pids) {
    const info = await runPsLookup(pid);
    const text = info.stdout.toLowerCase();
    if ((text.includes('electron') || text.includes('tandem')) && text.includes(root.toLowerCase())) {
      safePids.push(pid);
    } else {
      unsafePids.push(pid);
    }
  }

  if (unsafePids.length > 0) {
    throw new Error(`Agent API port ${apiPort} is already in use by another process (${unsafePids.join(', ')}). Tandem will not kill it automatically; stop that process or choose another Agent API port in Settings.`);
  }

  if (safePids.length > 0) {
    await runKillPids(safePids);
    console.log(`[start] Killed leftover Tandem process(es) on port ${apiPort}: ${safePids.join(', ')}`);
  }
}

function parseWindowsNetstatPids(output) {
  const pids = new Set();

  for (const line of output.split(/\r?\n/)) {
    const normalized = line.trim().replace(/\s+/g, ' ');
    if (!normalized || !normalized.includes(`:${apiPort}`)) continue;

    const parts = normalized.split(' ');
    const pid = parts[parts.length - 1];
    const state = parts.length >= 4 ? parts[parts.length - 2] : '';
    if (state === 'LISTENING' && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }

  return [...pids];
}

async function killWindowsPortProcess() {
  const result = await runNetstat();
  const pids = parseWindowsNetstatPids(result.stdout);

  if (pids.length === 0) return;

  const safePids = [];
  const unsafePids = [];
  for (const pid of pids) {
    const info = await runWindowsProcessLookup(pid);
    const text = info.stdout.toLowerCase();
    if ((text.includes('electron.exe') || text.includes('tandem')) && text.includes(root.toLowerCase())) {
      safePids.push(pid);
    } else {
      unsafePids.push(pid);
    }
  }

  if (unsafePids.length > 0) {
    throw new Error(`Agent API port ${apiPort} is already in use by another process (${unsafePids.join(', ')}). Tandem will not kill it automatically; stop that process or choose another Agent API port in Settings.`);
  }

  for (const pid of safePids) {
    await runTaskkill(pid);
  }
  if (safePids.length > 0) {
    console.log(`[start] Killed leftover Tandem process(es) on port ${apiPort}: ${safePids.join(', ')}`);
  }
}

async function cleanupApiPort() {
  if (process.platform === 'win32') {
    await killWindowsPortProcess();
    return;
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    await killUnixPortProcess();
  }
}

function clearServiceWorkerScriptCache() {
  try {
    const swCacheDir = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'tandem-browser',
      'Partitions',
      'tandem',
      'Service Worker',
      'ScriptCache'
    );
    const extDir = path.join(os.homedir(), '.tandem', 'extensions');
    if (!fs.existsSync(swCacheDir) || !fs.existsSync(extDir)) return;

    const cacheFiles = fs.readdirSync(swCacheDir).filter((file) => file !== 'index-dir');
    let cleared = 0;
    for (const file of cacheFiles) {
      try {
        fs.unlinkSync(path.join(swCacheDir, file));
        cleared++;
      } catch {}
    }

    if (cleared > 0) {
      console.log(`[start] Cleared ${cleared} SW bytecode cache file(s)`);
    }
  } catch {}
}

function electronExecutablePath() {
  if (process.platform === 'darwin') {
    return path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }

  if (process.platform === 'win32') {
    return path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  }

  return path.join(root, 'node_modules', 'electron', 'dist', 'electron');
}

function startElectron() {
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.ATOM_SHELL_INTERNAL_RUN_AS_NODE;

  console.log('[start] Starting Tandem Browser...');
  const child = spawn(electronExecutablePath(), ['.'], {
    stdio: 'inherit',
    cwd: root,
    env: cleanEnv,
    shell: false
  });

  child.on('error', (error) => {
    console.error('[start] Failed to start:', error);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code || 0);
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

async function main() {
  await runCompile();
  await clearMacOSQuarantine();
  await cleanupApiPort();
  clearServiceWorkerScriptCache();
  startElectron();
}

main().catch((error) => {
  console.error('[start] Startup failed:', error);
  process.exit(1);
});
