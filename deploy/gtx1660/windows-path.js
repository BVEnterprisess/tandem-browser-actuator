'use strict';

const { spawnSync } = require('child_process');

/**
 * Convert a WSL/Linux path to a Windows NT path for powershell.exe.
 * Sync I/O may still use /mnt/c/...; only the handoff argument must be NT.
 */
function wslMountToNtPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return raw;

  const posix = raw.replace(/\\/g, '/');
  const mount = posix.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mount) {
    return `${mount[1].toUpperCase()}:\\${mount[2].replace(/\//g, '\\')}`;
  }

  const relativeMount = posix.match(/^mnt\/([a-zA-Z])\/(.*)$/);
  if (relativeMount) {
    return `${relativeMount[1].toUpperCase()}:\\${relativeMount[2].replace(/\//g, '\\')}`;
  }

  return raw;
}

function toWindowsNtPath(input) {
  const raw = String(input || '').trim();
  if (!raw) return raw;

  const converted = wslMountToNtPath(raw);
  if (converted !== raw && /^[A-Za-z]:\\/.test(converted)) {
    return converted;
  }

  try {
    const result = spawnSync('wslpath', ['-w', raw], { encoding: 'utf-8' });
    if (result.status === 0) {
      const nt = String(result.stdout || '').trim();
      if (nt) return nt;
    }
  } catch {
    // wslpath is WSL-only; the mount-path fallback above covers the deploy root.
  }

  return converted;
}

module.exports = {
  toWindowsNtPath,
  wslMountToNtPath,
};
