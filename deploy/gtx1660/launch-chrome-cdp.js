#!/usr/bin/env node
/**
 * Start (or attach to) Chrome with --remote-debugging-port so Tandem can
 * pull cookies via Network.getAllCookies.
 *
 * Chrome already running without the debug flag will ignore a second launch
 * on the same user-data-dir. Close that Chrome first, then retry.
 *
 * Usage:
 *   node deploy/gtx1660/launch-chrome-cdp.js
 *   node deploy/gtx1660/launch-chrome-cdp.js --profile="Profile 6" --port=9222
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { toWindowsNtPath } = require('./windows-path');

function parseArgs(argv) {
  const options = { profile: 'Default', port: 9222 };
  for (const arg of argv) {
    if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length).trim() || 'Default';
    if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length)) || 9222;
  }
  return options;
}

function isWsl() {
  try {
    return fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function cdpUp(port) {
  const result = spawnSync('curl', ['-sS', '-m', '1', `http://127.0.0.1:${port}/json/version`], { encoding: 'utf-8' });
  return result.status === 0 && Boolean(result.stdout) && result.stdout.includes('webSocketDebuggerUrl');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (cdpUp(options.port)) {
    console.log(`[gtx1660] Chrome CDP already listening on 127.0.0.1:${options.port}`);
    return;
  }

  const script = path.join(__dirname, 'launch-chrome-cdp.ps1');
  const powershell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  if (isWsl() && fs.existsSync(powershell) && fs.existsSync(script)) {
    const child = spawn(powershell, [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', toWindowsNtPath(script),
      '-ProfileDir', options.profile,
      '-Port', String(options.port),
    ], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  console.error('[gtx1660] Start Chrome from Windows with:');
  console.error(`  chrome.exe --remote-debugging-port=${options.port} --profile-directory="${options.profile}"`);
  console.error('Close any existing Chrome that was started without the debug flag first.');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, cdpUp };
