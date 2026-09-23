import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectOpenClaw } from '../openclaw-detect';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe('detectOpenClaw', () => {
  it('treats /health { ok:true, status:live } as a live gateway', async () => {
    vi.stubEnv('TANDEM_OPENCLAW_CONFIG', '/tmp/missing-openclaw.json');
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, status: 'live' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const status = await detectOpenClaw();
    expect(status.ok).toBe(true);
    expect(status.gatewayUrl).toBe('ws://127.0.0.1:18789');
  });

  it('returns not-ok when the gateway is down and no config token exists', async () => {
    vi.stubEnv('TANDEM_OPENCLAW_CONFIG', '/tmp/missing-openclaw.json');
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    const status = await detectOpenClaw();
    expect(status.ok).toBe(false);
  });
});
