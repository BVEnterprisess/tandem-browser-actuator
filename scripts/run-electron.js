#!/usr/bin/env node
/**
 * Compatibility wrapper for direct Electron launches.
 *
 * npm start uses scripts/start.js directly. This helper remains for developers
 * who want to launch the already-compiled app without running npm run compile.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const startScript = path.join(__dirname, 'start.js');

const child = spawn(process.execPath, [startScript, '--skip-compile'], {
  cwd: root,
  stdio: 'inherit',
  shell: false
});

child.on('error', (error) => {
  console.error('[run-electron] Failed to start:', error);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code || 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
