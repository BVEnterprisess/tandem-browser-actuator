import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { applyCdpCookies, fetchCdpCookies, mapCdpCookieToElectron, mapCdpSameSite } from '../cdp-cookies';

describe('cdp-cookies', () => {
  it('maps CDP cookies to Electron writes without dropping the value field from the write object', () => {
    expect(mapCdpSameSite('Strict')).toBe('strict');
    expect(mapCdpSameSite('Lax')).toBe('lax');
    expect(mapCdpSameSite('None')).toBe('no_restriction');

    const mapped = mapCdpCookieToElectron({
      name: 'sid',
      value: 'fixture',
      domain: '.example.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: 1_900_000_000,
    });

    expect(mapped).toMatchObject({
      url: 'https://example.com/',
      name: 'sid',
      domain: '.example.com',
      sameSite: 'lax',
      expirationDate: 1_900_000_000,
    });
    expect(mapped?.value).toBe('fixture');
    expect(mapCdpCookieToElectron({ name: '', value: 'x', domain: 'example.com' })).toBeNull();
  });

  it('applies writable cookies and counts failures without throwing', async () => {
    const set = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('expired'));

    const result = await applyCdpCookies(
      { cookies: { set } },
      [
        { name: 'ok', value: '1', domain: 'example.com' },
        { name: 'bad', value: '2', domain: 'example.com' },
        { name: '', value: 'skip', domain: 'example.com' },
      ],
    );

    expect(result).toEqual({ ok: true, count: 1 });
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('pulls cookies from the first CDP port that answers', async () => {
    const socket = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.send = vi.fn();
    socket.close = vi.fn();

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools' }),
      });

    const pending = fetchCdpCookies({
      ports: [9222, 9229],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openSocket: () => socket as unknown as import('ws').WebSocket,
    });

    await Promise.resolve();
    socket.emit('open');
    socket.emit('message', JSON.stringify({
      id: 1,
      result: { cookies: [{ name: 'sid', value: 'fixture', domain: 'example.com' }] },
    }));

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.port).toBe(9229);
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]?.name).toBe('sid');
  });
});
