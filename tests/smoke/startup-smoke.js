#!/usr/bin/env node
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const startScript = path.join(root, 'scripts', 'start.js');
const apiPort = readSmokeApiPort();
const statusUrl = process.env.TANDEM_SMOKE_STATUS_URL || `http://127.0.0.1:${apiPort}/status`;
const timeoutMs = Number.parseInt(process.env.TANDEM_SMOKE_TIMEOUT_MS || '60000', 10);
const pollIntervalMs = Number.parseInt(process.env.TANDEM_SMOKE_POLL_MS || '1000', 10);
const requestTimeoutMs = Number.parseInt(process.env.TANDEM_SMOKE_REQUEST_MS || '2500', 10);

let child = null;
let childError = null;
let cleanupStarted = false;

function tandemDataDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Tandem Browser');
  }
  return path.join(os.homedir(), '.tandem');
}

function parsePort(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function readSmokeApiPort() {
  const explicit = parsePort(process.env.TANDEM_SMOKE_API_PORT || process.env.TANDEM_API_PORT);
  if (explicit) return explicit;
  try {
    const configPath = path.join(tandemDataDir(), 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const configured = parsePort(cfg?.general?.apiPort);
      if (configured) return configured;
    }
  } catch {}
  return 8765;
}

function log(message) {
  console.log(`[smoke:startup] ${message}`);
}

function assertCompiledAppExists() {
  const mainPath = path.join(root, 'dist', 'main.js');
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Compiled app entry not found at ${mainPath}. Run npm run compile before the startup smoke test.`);
  }
}

function pipeOutput(stream, label) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) {
        console.log(`[smoke:startup:${label}] ${line}`);
      }
    }
  });
}

function spawnTandem() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE;

  log('Starting Tandem Browser via scripts/start.js --skip-compile');
  const spawned = spawn(process.execPath, [startScript, '--skip-compile'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  pipeOutput(spawned.stdout, 'stdout');
  pipeOutput(spawned.stderr, 'stderr');
  spawned.on('exit', (code, signal) => {
    if (!cleanupStarted) {
      log(`Tandem process exited before smoke completion (code=${code}, signal=${signal || 'none'})`);
    }
  });
  spawned.on('error', (error) => {
    childError = error;
  });

  return spawned;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasChildExited() {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function describeChildExit() {
  if (!child) return 'process unavailable';
  return `code=${child.exitCode}, signal=${child.signalCode || 'none'}`;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForStatus() {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError = 'not attempted yet';

  while (Date.now() < deadline) {
    attempts += 1;

    if (childError) {
      throw childError;
    }

    if (hasChildExited()) {
      throw new Error(`Tandem exited before ${statusUrl} became reachable (${describeChildExit()})`);
    }

    let response;
    try {
      response = await fetchWithTimeout(statusUrl);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log(`Waiting for API (${attempts}): ${lastError}`);
      await delay(pollIntervalMs);
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${statusUrl} returned HTTP ${response.status}: ${body}`);
    }

    const body = await response.text();
    log(`Reached ${statusUrl} after ${attempts} attempt(s): ${body}`);
    return;
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${statusUrl}. Last error: ${lastError}`);
}

function execFileAsync(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: root, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function stopWindowsProcessTree(pid) {
  const result = await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  if (result.error) {
    log(`taskkill reported: ${result.error.message}`);
  }
}

async function waitForChildExit(ms) {
  if (hasChildExited()) return;

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(ms),
  ]);
}

async function cleanup() {
  if (cleanupStarted || !child) return;
  cleanupStarted = true;

  if (hasChildExited()) return;

  log('Stopping Tandem Browser');
  if (process.platform === 'win32') {
    if (!child.pid) return;
    await stopWindowsProcessTree(child.pid);
    return;
  }

  child.kill('SIGTERM');
  await waitForChildExit(5000);
  if (!hasChildExited()) {
    log('Tandem did not exit after SIGTERM; sending SIGKILL');
    child.kill('SIGKILL');
    await waitForChildExit(2000);
  }
}

async function main() {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('TANDEM_SMOKE_TIMEOUT_MS must be a positive integer');
  }

  assertCompiledAppExists();
  child = spawnTandem();

  try {
    await waitForStatus();
  } finally {
    await cleanup();
  }
}

process.on('SIGINT', () => {
  void cleanup().finally(() => process.exit(130));
});

process.on('SIGTERM', () => {
  void cleanup().finally(() => process.exit(143));
});

main().catch(async (error) => {
  console.error(`[smoke:startup] ${error instanceof Error ? error.message : error}`);
  await cleanup();
  process.exit(1);
});
