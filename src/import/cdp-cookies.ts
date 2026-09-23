import { WebSocket } from 'ws';

export interface CdpCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None' | string;
  session?: boolean;
}

export interface ElectronCookieWrite {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite: 'strict' | 'lax' | 'no_restriction';
}

export interface CookieSession {
  cookies: {
    set: (cookie: ElectronCookieWrite) => Promise<unknown>;
  };
}

export function mapCdpSameSite(value: string | undefined): ElectronCookieWrite['sameSite'] {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'lax') return 'lax';
  return 'no_restriction';
}

export function mapCdpCookieToElectron(cookie: CdpCookie): ElectronCookieWrite | null {
  if (!cookie.name || !cookie.domain) return null;
  const domain = cookie.domain.replace(/^\./, '');
  const secure = Boolean(cookie.secure);
  const pathName = cookie.path || '/';
  const write: ElectronCookieWrite = {
    url: `http${secure ? 's' : ''}://${domain}${pathName}`,
    name: cookie.name,
    value: cookie.value ?? '',
    domain: cookie.domain,
    path: pathName,
    secure,
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: mapCdpSameSite(cookie.sameSite),
  };
  if (typeof cookie.expires === 'number' && cookie.expires > 0) {
    write.expirationDate = cookie.expires;
  }
  return write;
}

export async function applyCdpCookies(electronSession: CookieSession, cookies: CdpCookie[]): Promise<{ ok: boolean; count: number }> {
  let count = 0;
  for (const cookie of cookies) {
    const mapped = mapCdpCookieToElectron(cookie);
    if (!mapped) continue;
    try {
      await electronSession.cookies.set(mapped);
      count++;
    } catch {
      // Skip expired or rejected cookies; never fail the whole import.
    }
  }
  return { ok: count > 0, count };
}

export async function fetchCdpCookies(options: {
  ports?: number[];
  fetchImpl?: typeof fetch;
  openSocket?: (url: string) => WebSocket;
  timeoutMs?: number;
}): Promise<{ ok: boolean; cookies: CdpCookie[]; error?: string; port?: number }> {
  const ports = options.ports ?? [9222, 9229, 9221];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4000;

  for (const port of ports) {
    try {
      const versionResp = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!versionResp.ok) continue;
      const version = await versionResp.json() as { webSocketDebuggerUrl?: string };
      if (!version.webSocketDebuggerUrl) continue;

      const cookies = await requestCdpCookies(version.webSocketDebuggerUrl, options.openSocket, timeoutMs);
      return { ok: true, cookies, port };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    cookies: [],
    error: 'Chrome DevTools Protocol not available. Start Chrome with --remote-debugging-port=9222 (one profile) and retry.',
  };
}

function requestCdpCookies(
  wsUrl: string,
  openSocket: ((url: string) => WebSocket) | undefined,
  timeoutMs: number,
): Promise<CdpCookie[]> {
  return new Promise((resolve, reject) => {
    const socket = openSocket ? openSocket(wsUrl) : new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('CDP cookie request timed out'));
    }, timeoutMs);

    const finish = (error?: Error, cookies?: CdpCookie[]) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(cookies ?? []);
    };

    socket.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    socket.on('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    });
    socket.on('message', (raw) => {
      try {
        const frame = JSON.parse(String(raw)) as {
          id?: number;
          result?: { cookies?: CdpCookie[] };
          error?: { message?: string };
        };
        if (frame.id !== 1) return;
        if (frame.error?.message) {
          finish(new Error(frame.error.message));
          return;
        }
        finish(undefined, Array.isArray(frame.result?.cookies) ? frame.result.cookies : []);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
