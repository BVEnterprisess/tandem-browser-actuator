import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { startConfigIntegrityMonitor, stopConfigIntegrityMonitor } from '../connect';

describe('startConfigIntegrityMonitor', () => {
  afterEach(() => {
    stopConfigIntegrityMonitor();
    vi.restoreAllMocks();
  });

  it('does not call fs.watch for a WSL UNC path and does not throw', () => {
    const watch = vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw Object.assign(new Error('EISDIR: illegal operation on a directory, watch'), { code: 'EISDIR' });
    });
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      gateway: { auth: { token: 'live-token-value-here' } },
    }));

    expect(() => {
      startConfigIntegrityMonitor(() => {}, {
        configPath: '\\\\wsl$\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json',
        pollMs: 60_000,
      });
    }).not.toThrow();

    expect(watch).not.toHaveBeenCalled();
    expect(exists).toHaveBeenCalled();
  });

  it('falls back to poll when fs.watch throws EISDIR on a local path', () => {
    const watch = vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw Object.assign(new Error('EISDIR: illegal operation on a directory, watch'), { code: 'EISDIR' });
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ token: 'long-enough-token' }));

    expect(() => {
      startConfigIntegrityMonitor(() => {}, {
        configPath: path.join(os.tmpdir(), 'tandem-openclaw-watch-test.json'),
        pollMs: 60_000,
      });
    }).not.toThrow();

    expect(watch).toHaveBeenCalled();
  });

  it('polls and reports a suspiciously short token without rejecting', async () => {
    vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw Object.assign(new Error('EISDIR: illegal operation on a directory, watch'), { code: 'EISDIR' });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-oc-'));
    const file = path.join(dir, 'openclaw.json');
    fs.writeFileSync(file, JSON.stringify({ token: 'long-enough-token' }));
    const alerts: string[] = [];

    startConfigIntegrityMonitor((detail) => {
      alerts.push(detail);
    }, {
      configPath: file,
      pollMs: 20,
    });

    fs.writeFileSync(file, JSON.stringify({ token: 'short' }));
    await vi.waitFor(() => {
      expect(alerts.some((item) => item.includes('suspiciously short'))).toBe(true);
    }, { timeout: 500 });
  });
});
