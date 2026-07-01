import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { tandemDir, ensureDir } from '../paths';
import { selectPlatform } from '../../platform';

describe('tandemDir()', () => {
  it('delegates the root path to the current platform adapter', () => {
    expect(tandemDir()).toBe(selectPlatform().paths.tandemDir());
  });

  it('appends a single subpath through the current platform adapter', () => {
    expect(tandemDir('extensions')).toBe(selectPlatform().paths.tandemDir('extensions'));
  });

  it('appends multiple subpath segments', () => {
    expect(tandemDir('security', 'blocklists')).toBe(
      selectPlatform().paths.tandemDir('security', 'blocklists')
    );
  });

  it('handles file names in subpath', () => {
    expect(tandemDir('api-token')).toBe(selectPlatform().paths.tandemDir('api-token'));
  });

  it('keeps the macOS legacy ~/.tandem api-token path pinned', () => {
    expect(selectPlatform('darwin').paths.tandemDir('api-token')).toBe(
      path.join(os.homedir(), '.tandem', 'api-token')
    );
  });
});

describe('ensureDir()', () => {
  it('returns the directory path', () => {
    // Use a real temp dir to test — no mock needed
    const tmpDir = path.join(os.tmpdir(), `tandem-test-${Date.now()}`);
    const result = ensureDir(tmpDir);
    expect(result).toBe(tmpDir);
    // Clean up
    const fs = require('fs');
    fs.rmdirSync(tmpDir);
  });

  it('creates directory when it does not exist', () => {
    const fs = require('fs');
    const tmpDir = path.join(os.tmpdir(), `tandem-test-${Date.now()}`);
    expect(fs.existsSync(tmpDir)).toBe(false);
    ensureDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);
    fs.rmdirSync(tmpDir);
  });

  it('is idempotent — safe to call on existing directory', () => {
    const fs = require('fs');
    const tmpDir = path.join(os.tmpdir(), `tandem-test-${Date.now()}`);
    ensureDir(tmpDir);
    ensureDir(tmpDir); // should not throw
    expect(fs.existsSync(tmpDir)).toBe(true);
    fs.rmdirSync(tmpDir);
  });
});

describe('handleRouteError()', () => {
  it('sends 500 with error message for Error instances', async () => {
    const { handleRouteError } = await import('../errors');
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    handleRouteError(res as any, new Error('something broke'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'something broke' });
  });

  it('sends 500 with string conversion for non-Error values', async () => {
    const { handleRouteError } = await import('../errors');
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    handleRouteError(res as any, 'raw string error');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'raw string error' });
  });

  it('handles null/undefined errors gracefully', async () => {
    const { handleRouteError } = await import('../errors');
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    handleRouteError(res as any, null);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'null' });
  });
});
