import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { candidateHosts, probeWindowsApi, windowsHostFromResolv } = require('../../../deploy/gtx1660/windows-api.js') as {
  candidateHosts: (options?: { resolvText?: string; extraHosts?: string[] }) => string[];
  probeWindowsApi: (options: { port?: number; resolvText?: string; fetchImpl: (url: string) => { ok: boolean } }) => {
    ok: boolean;
    url: string | null;
    host: string | null;
    tried: string[];
  };
  windowsHostFromResolv: (text: string) => string | null;
};

describe('windows-api probe', () => {
  it('reads the WSL nameserver as a Windows host candidate', () => {
    expect(windowsHostFromResolv('nameserver 172.28.160.1\n')).toBe('172.28.160.1');
    expect(candidateHosts({ resolvText: 'nameserver 172.28.160.1\n' })).toEqual([
      '127.0.0.1',
      '172.28.160.1',
      'host.docker.internal',
    ]);
  });

  it('returns the first host that answers /status', () => {
    const result = probeWindowsApi({
      port: 8765,
      resolvText: 'nameserver 172.28.160.1\n',
      fetchImpl: (url) => ({ ok: url.includes('172.28.160.1') }),
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe('http://172.28.160.1:8765');
    expect(result.tried[0]).toBe('http://127.0.0.1:8765/status');
  });
});
