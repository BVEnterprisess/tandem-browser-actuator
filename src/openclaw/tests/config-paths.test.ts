import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';

import {
  canSafelyWatchOpenClawConfig,
  extractOpenClawGatewayPort,
  extractOpenClawGatewayToken,
  isWslUncPath,
  listOpenClawConfigCandidates,
  resolveOpenClawConfigPath,
} from '../config-paths';

describe('resolveOpenClawConfigPath', () => {
  it('honors TANDEM_OPENCLAW_CONFIG even when other candidates exist', () => {
    const forced = '/tmp/forced-openclaw.json';
    const resolution = resolveOpenClawConfigPath({
      env: { TANDEM_OPENCLAW_CONFIG: forced },
      platform: 'win32',
      homedir: '/home/jp',
      exists: (candidate) => candidate === forced || candidate.includes('.openclaw'),
      readFile: () => JSON.stringify({ gateway: { auth: { token: 'aaaaaaaabbbbbbbb' } } }),
    });

    expect(resolution.source).toBe('env');
    expect(resolution.path).toBe(forced);
    expect(resolution.exists).toBe(true);
  });

  it('prefers the complete WSL config over a thin Windows stub', () => {
    const stub = path.join('C:', 'Users', 'johnh', '.openclaw', 'openclaw.json');
    const wsl = '\\\\wsl$\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json';
    const files: Record<string, string> = {
      [stub]: JSON.stringify({ gateway: { auth: { token: 'stale-token-value' } } }),
      [wsl]: JSON.stringify({
        gateway: { mode: 'local', port: 18789, auth: { token: 'live-token-value-here' } },
        models: { mode: 'merge' },
      }),
    };

    const resolution = resolveOpenClawConfigPath({
      env: {},
      platform: 'win32',
      homedir: path.join('C:', 'Users', 'johnh'),
      exists: (candidate) => candidate in files,
      readFile: (candidate) => files[candidate],
      wslUncRoots: ['\\\\wsl$'],
    });

    expect(resolution.source).toBe('wsl-unc');
    expect(resolution.path).toBe(wsl);
    expect(extractOpenClawGatewayToken(JSON.parse(files[wsl]))).toBe('live-token-value-here');
  });

  it('falls back to ~/.openclaw/openclaw.json on Linux', () => {
    const native = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const resolution = resolveOpenClawConfigPath({
      env: {},
      platform: 'linux',
      homedir: os.homedir(),
      exists: (candidate) => candidate === native,
      readFile: () => JSON.stringify({ token: 'linux-token-value' }),
    });

    expect(resolution.source).toBe('native-home');
    expect(resolution.path).toBe(native);
  });

  it('lists WSL UNC candidates for the gtx1660 rig defaults', () => {
    const candidates = listOpenClawConfigCandidates({
      env: {},
      platform: 'win32',
      homedir: 'C:\\Users\\johnh',
      wslUncRoots: ['\\\\wsl$'],
    });

    expect(candidates.some((item) => item.source === 'wsl-unc' && item.path.includes('Ubuntu') && item.path.includes('jp'))).toBe(true);
  });
});

describe('WSL UNC watch safety', () => {
  it('recognizes wsl$ and wsl.localhost UNC files', () => {
    expect(isWslUncPath('\\\\wsl$\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json')).toBe(true);
    expect(isWslUncPath('\\\\wsl.localhost\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json')).toBe(true);
    expect(isWslUncPath('C:\\Users\\johnh\\.openclaw\\openclaw.json')).toBe(false);
    expect(isWslUncPath('/home/jp/.openclaw/openclaw.json')).toBe(false);
  });

  it('refuses native fs.watch on WSL UNC paths so Windows does not EISDIR', () => {
    expect(canSafelyWatchOpenClawConfig('\\\\wsl$\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json', 'win32')).toBe(false);
    expect(canSafelyWatchOpenClawConfig('\\\\wsl.localhost\\Ubuntu\\home\\jp\\.openclaw\\openclaw.json', 'win32')).toBe(false);
    expect(canSafelyWatchOpenClawConfig('C:\\Users\\johnh\\.openclaw\\openclaw.json', 'win32')).toBe(true);
    expect(canSafelyWatchOpenClawConfig('/home/jp/.openclaw/openclaw.json', 'linux')).toBe(true);
  });
});

describe('extractOpenClawGateway helpers', () => {
  it('reads nested gateway.auth.token and port', () => {
    const data = { gateway: { auth: { token: 'nested-token' }, port: 18789 } };
    expect(extractOpenClawGatewayToken(data)).toBe('nested-token');
    expect(extractOpenClawGatewayPort(data, 1)).toBe(18789);
  });

  it('falls back when port is missing', () => {
    expect(extractOpenClawGatewayPort({}, 18789)).toBe(18789);
    expect(extractOpenClawGatewayToken({})).toBeNull();
  });
});
