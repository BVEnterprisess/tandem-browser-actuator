import os from 'os';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLocalApiBaseUrl,
  buildRemoteApiBaseUrl,
  ConfigValidationError,
  detectApiAddresses,
  isRemoteApiListenHost,
  parseApiPort,
} from '../api-endpoints';

describe('Agent API endpoint helpers', () => {
  it('accepts integer ports from numbers and strings', () => {
    expect(parseApiPort(8765)).toBe(8765);
    expect(parseApiPort('9876')).toBe(9876);
    expect(buildLocalApiBaseUrl(9876)).toBe('http://127.0.0.1:9876');
    expect(buildRemoteApiBaseUrl('100.64.0.10', 9876)).toBe('http://100.64.0.10:9876');
  });

  it.each(['', 'abc', '12.5', '-1', 0, -1, 65536, 12.5])('rejects invalid port %s', (value) => {
    expect(() => parseApiPort(value)).toThrow(ConfigValidationError);
  });

  it('detects remote-enabled listen hosts separately from the port', () => {
    expect(isRemoteApiListenHost('0.0.0.0')).toBe(true);
    expect(isRemoteApiListenHost('::')).toBe(true);
    expect(isRemoteApiListenHost('127.0.0.1')).toBe(false);
  });

  it('uses loopback for local clients and disables remote metadata in local-only mode', () => {
    const addresses = detectApiAddresses({ apiPort: 9876, apiListenHost: '127.0.0.1' });
    expect(addresses.local.address).toBe('http://127.0.0.1:9876');
    expect(addresses.remoteAccess.enabled).toBe(false);
    expect(addresses.tailscale.address).toBeNull();
    expect(addresses.tailscale.warning).toContain('loopback only');
  });

  it('uses the Tailscale address and configured port for remote metadata', () => {
    const networkSpy = vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      Tailscale: [
        {
          address: '100.64.0.10',
          netmask: '255.192.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '100.64.0.10/10',
        },
      ],
    });

    const addresses = detectApiAddresses({ apiPort: 9876, apiListenHost: '0.0.0.0' });

    expect(addresses.local.address).toBe('http://127.0.0.1:9876');
    expect(addresses.remoteAccess.enabled).toBe(true);
    expect(addresses.tailscale.address).toBe('http://100.64.0.10:9876');
    expect(addresses.tailscale.address).not.toContain('127.0.0.1');
    networkSpy.mockRestore();
  });
});
