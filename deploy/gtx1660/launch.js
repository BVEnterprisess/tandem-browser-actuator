#!/usr/bin/env node
/**
 * One-command Wingman launch for the gtx1660 Windows 10 + WSL2 rig.
 *
 * Designed path:
 *   1. OpenClaw gateway stays in WSL (systemd --user, :18789)
 *   2. TypeScript compiles on ext4
 *   3. Electron runs as Windows bare-metal (D3D11 / GTX 1660), not WSLg
 *   4. Wingman signs the OpenClaw webchat handshake from the live WSL config
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '../..');
const rig = JSON.parse(fs.readFileSync(path.join(__dirname, 'rig.json'), 'utf-8'));
const isWsl = fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
const powershell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

function log(message) {
  console.log(`[gtx1660] ${message}`);
}

function fail(message, code = 1) {
  console.error(`[gtx1660] ${message}`);
  process.exit(code);
}

function ensureOpenClaw() {
  if (!isWsl && process.platform !== 'linux') {
    log('OpenClaw preflight skipped (not in WSL). Start the gateway in Ubuntu if Wingman cannot connect.');
    return;
  }

  try {
    spawnSync('systemctl', ['--user', 'start', 'openclaw-gateway.service'], { stdio: 'inherit' });
  } catch {
    log('systemctl start failed; checking health anyway');
  }

  const healthUrl = rig.wsl.gatewayHealth;
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const result = spawnSync('curl', ['-sS', '-m', '2', healthUrl], { encoding: 'utf-8' });
      if (result.status === 0 && result.stdout.includes('"ok":true')) {
        log(`OpenClaw gateway live at ${healthUrl}`);
        return;
      }
    } catch {
      // retry
    }
    spawnSync('sleep', ['0.4']);
  }
  fail(`OpenClaw gateway did not become healthy at ${healthUrl}`);
}

function compile() {
  log('Compiling TypeScript on ext4...');
  const result = spawnSync('npm', ['run', 'compile'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    fail('compile failed');
  }
}

function windowsDeployRoot() {
  return path.join('/mnt/c/Users', rig.windows.user, 'AppData/Local/TandemBrowser-gtx1660');
}

function syncWindowsTree() {
  const dest = windowsDeployRoot();
  fs.mkdirSync(dest, { recursive: true });
  const copy = (rel) => {
    const from = path.join(root, rel);
    const to = path.join(dest, rel);
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, to, { recursive: true, dereference: true });
  };

  copy('dist');
  copy('shell');
  copy('skill');
  copy('scripts');
  copy('package.json');
  copy('package-lock.json');
  copy('deploy');
  log(`Synced compiled tree to ${dest}`);
  return dest;
}

function launchWindowsElectron(dest) {
  if (!fs.existsSync(powershell)) {
    fail('Windows PowerShell not found. Open deploy/gtx1660/launch-wingman.ps1 from Windows.');
  }

  const ps1 = path.join(root, 'deploy/gtx1660/launch-wingman.ps1');
  log('Handing off to Windows Electron (GTX 1660 / ANGLE D3D11)...');
  const child = spawn(powershell, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ps1,
    '-RepoRoot', dest,
    '-SkipCompile',
  ], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => process.exit(code || 0));
}

function launchLocalElectron() {
  log('Launching local Electron with gtx1660 profile (WSLg / Linux fallback — not the production GPU path).');
  const child = spawn(process.execPath, [path.join(root, 'scripts/start.js'), '--skip-compile', '--profile=gtx1660'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      TANDEM_PERF_PROFILE: 'gtx1660',
      TANDEM_OPENCLAW_CONFIG: process.env.TANDEM_OPENCLAW_CONFIG || path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    },
  });
  child.on('exit', (code) => process.exit(code || 0));
}

function main() {
  log(`${rig.label} Wingman launch`);
  ensureOpenClaw();
  compile();

  if (isWsl && fs.existsSync(powershell)) {
    const dest = syncWindowsTree();
    launchWindowsElectron(dest);
    return;
  }

  launchLocalElectron();
}

main();
