import fs from 'fs';

import { extractOpenClawGatewayPort, extractOpenClawGatewayToken, resolveOpenClawConfigPath } from '../openclaw/config-paths';
import { WEBHOOK_PORT } from './constants';
import { createLogger } from './logger';

const log = createLogger('OpenClawDetect');

export interface OpenClawStatus {
  ok: boolean;
  hooksToken?: string;
  gatewayToken?: string;
  gatewayUrl?: string;
  configPath?: string;
  configSource?: string;
}

async function probeGateway(port: number): Promise<boolean> {
  const endpoints = [`http://127.0.0.1:${port}/health`, `http://127.0.0.1:${port}/v1/status`];
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await response.json() as { ok?: unknown; status?: unknown; gateway?: { hooks?: { token?: string } } };
        if (data.ok === true || data.status === 'live' || data.gateway) {
          return true;
        }
      } else if (url.endsWith('/health')) {
        return true;
      }
    } catch (err) {
      log.debug(`OpenClaw probe failed for ${url}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return false;
}

/**
 * Detects if OpenClaw is running on localhost and retrieves the gateway token.
 * Current OpenClaw builds expose `/health` (`{ ok, status: "live" }`) and no
 * longer publish `/v1/status` hooks.token. The designed Wingman handshake
 * still signs with `gateway.auth.token` from openclaw.json, which on this
 * Windows+WSL2 rig may live under `\\wsl$\Ubuntu\home\jp\.openclaw\`.
 */
export async function detectOpenClaw(): Promise<OpenClawStatus> {
  const resolution = resolveOpenClawConfigPath();
  let gatewayToken: string | undefined;
  let port = WEBHOOK_PORT;

  if (resolution.exists) {
    try {
      const data = JSON.parse(fs.readFileSync(resolution.path, 'utf-8')) as Record<string, unknown>;
      gatewayToken = extractOpenClawGatewayToken(data) ?? undefined;
      port = extractOpenClawGatewayPort(data, WEBHOOK_PORT);
    } catch (err) {
      log.debug('Failed to read resolved OpenClaw config:', err instanceof Error ? err.message : String(err));
    }
  }

  const reachable = await probeGateway(port);
  if (!reachable && !gatewayToken) {
    return { ok: false, configPath: resolution.path, configSource: resolution.source };
  }

  if (reachable) {
    log.info(`✅ OpenClaw detected on localhost:${port}`);
  }

  return {
    ok: reachable || Boolean(gatewayToken),
    hooksToken: gatewayToken,
    gatewayToken,
    gatewayUrl: `ws://127.0.0.1:${port}`,
    configPath: resolution.path,
    configSource: resolution.source,
  };
}
