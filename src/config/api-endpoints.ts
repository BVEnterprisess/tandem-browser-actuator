import fs from 'fs';
import os from 'os';
import path from 'path';
import { API_PORT } from '../utils/constants';
import { tandemDir } from '../utils/paths';

export const MIN_TCP_PORT = 1;
export const MAX_TCP_PORT = 65535;

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface ApiAddressInfo {
  local: { address: string; hostname: string };
  tailscale: {
    available: boolean;
    address: string | null;
    hostname: string | null;
    warning: string | null;
  };
  remoteAccess: {
    enabled: boolean;
    listenHost: string;
    reason: string | null;
  };
}

export interface ApiEndpointBootstrap {
  version: 1;
  apiPort: number;
  apiListenHost: string;
  localBaseUrl: string;
  remoteAccessEnabled: boolean;
  tailscaleBaseUrl: string | null;
  tailscaleHostname: string | null;
  updatedAt: string;
}

export function parseApiPort(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new ConfigValidationError('Agent API port must be a whole number.');
    }
    return assertTcpPortRange(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new ConfigValidationError('Agent API port is required.');
    }
    if (!/^\d+$/.test(trimmed)) {
      throw new ConfigValidationError('Agent API port must contain digits only.');
    }
    return assertTcpPortRange(Number(trimmed));
  }

  throw new ConfigValidationError('Agent API port must be a number.');
}

export function normalizeApiPort(value: unknown, fallback = API_PORT): number {
  try {
    return parseApiPort(value);
  } catch {
    return fallback;
  }
}

export function buildLocalApiBaseUrl(port: number): string {
  return `http://127.0.0.1:${parseApiPort(port)}`;
}

export function buildRemoteApiBaseUrl(host: string, port: number): string {
  const normalizedHost = host.trim();
  if (!normalizedHost) {
    throw new ConfigValidationError('Remote API host is required.');
  }
  return `http://${normalizedHost}:${parseApiPort(port)}`;
}

export function isRemoteApiListenHost(listenHost: string | undefined | null): boolean {
  const host = (listenHost || '').trim().toLowerCase();
  return host === '0.0.0.0' || host === '::';
}

export function detectApiAddresses(opts: { apiPort: number; apiListenHost: string }): ApiAddressInfo {
  const apiPort = parseApiPort(opts.apiPort);
  const listenHost = opts.apiListenHost || '0.0.0.0';
  const hostname = os.hostname();
  const remoteEnabled = isRemoteApiListenHost(listenHost);
  const interfaces = os.networkInterfaces();
  let tailscaleIp: string | null = null;

  if (remoteEnabled) {
    for (const [_name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal && addr.address.startsWith('100.')) {
          tailscaleIp = addr.address;
          break;
        }
      }
      if (tailscaleIp) break;
    }
  }

  const local = { address: buildLocalApiBaseUrl(apiPort), hostname };
  const localOnlyWarning = remoteEnabled
    ? undefined
    : 'Remote agent access is disabled because the Agent API is listening on loopback only.';

  return {
    local,
    tailscale: {
      available: remoteEnabled && tailscaleIp !== null,
      address: remoteEnabled && tailscaleIp ? buildRemoteApiBaseUrl(tailscaleIp, apiPort) : null,
      hostname: remoteEnabled && tailscaleIp ? `${hostname} (${tailscaleIp})` : null,
      warning: localOnlyWarning ?? null,
    },
    remoteAccess: {
      enabled: remoteEnabled,
      listenHost,
      reason: remoteEnabled ? null : localOnlyWarning ?? null,
    },
  };
}

export function writeApiEndpointBootstrap(opts: {
  apiPort: number;
  apiListenHost: string;
  addresses?: ApiAddressInfo;
}): void {
  const apiPort = parseApiPort(opts.apiPort);
  const addresses = opts.addresses ?? detectApiAddresses({ apiPort, apiListenHost: opts.apiListenHost });
  const baseDir = tandemDir();
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  fs.writeFileSync(path.join(baseDir, 'api-port'), `${apiPort}\n`, 'utf-8');
  const payload: ApiEndpointBootstrap = {
    version: 1,
    apiPort,
    apiListenHost: opts.apiListenHost,
    localBaseUrl: addresses.local.address,
    remoteAccessEnabled: addresses.remoteAccess.enabled,
    tailscaleBaseUrl: addresses.tailscale.address,
    tailscaleHostname: addresses.tailscale.hostname,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(baseDir, 'api-endpoints.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export function readApiPortFromBootstrap(): number {
  const envPort = process.env.TANDEM_API_PORT;
  if (envPort !== undefined) {
    return normalizeApiPort(envPort);
  }

  const portPath = tandemDir('api-port');
  if (fs.existsSync(portPath)) {
    const port = normalizeApiPort(fs.readFileSync(portPath, 'utf-8'), -1);
    if (port !== -1) return port;
  }

  const configPath = tandemDir('config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { general?: { apiPort?: unknown } };
      return normalizeApiPort(raw.general?.apiPort);
    } catch {
      return API_PORT;
    }
  }

  return API_PORT;
}

export function buildApiPortArg(apiPort: number): string {
  return `--tandem-api-port=${parseApiPort(apiPort)}`;
}

export function readApiPortArg(argv: string[]): number {
  const prefix = '--tandem-api-port=';
  const arg = argv.find((item) => item.startsWith(prefix));
  return arg ? parseApiPort(arg.slice(prefix.length)) : API_PORT;
}

function assertTcpPortRange(port: number): number {
  if (port < MIN_TCP_PORT || port > MAX_TCP_PORT) {
    throw new ConfigValidationError(`Agent API port must be between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}.`);
  }
  return port;
}
