import * as crypto from 'crypto';
import fs from 'fs';
import * as path from 'path';

import {
  canSafelyWatchOpenClawConfig,
  extractOpenClawGatewayPort,
  extractOpenClawGatewayToken,
  resolveOpenClawConfigPath,
} from './config-paths';
import { WEBHOOK_PORT } from '../utils/constants';
import { createLogger } from '../utils/logger';
import { ensureDir, tandemDir } from '../utils/paths';

const log = createLogger('OpenClawConnect');
const CONFIG_POLL_MS = 5_000;

function openClawConfigPath(): string {
  return resolveOpenClawConfigPath().path;
}

// ═══ Config Integrity Monitor ═══
// Watch openclaw.json for unexpected modifications (prompt injection defense).
// Tandem NEVER writes to this file — any change is either the user or a compromised agent.
let configWatcher: fs.FSWatcher | null = null;
let configPollTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownConfigHash: string | null = null;

export interface ConfigIntegrityMonitorOptions {
  configPath?: string;
  pollMs?: number;
}

function hashFileSync(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch { return null; }
}

function inspectConfigForTamper(configPath: string, onTamper: (detail: string) => void): void {
  const newHash = hashFileSync(configPath);
  if (!newHash || newHash === lastKnownConfigHash) return;
  lastKnownConfigHash = newHash;
  try {
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      token?: unknown;
      auth?: { token?: unknown };
    };
    const suspicious: string[] = [];
    const raw = JSON.stringify(content);
    if (raw.includes('"*"') && (raw.includes('cors') || raw.includes('CORS') || raw.includes('allowedOrigins'))) {
      suspicious.push('CORS set to wildcard (*)');
    }
    if (typeof content.auth?.token === 'string' && content.auth.token.length < 10) {
      suspicious.push(`Auth token suspiciously short: "${content.auth.token}"`);
    }
    if (typeof content.token === 'string' && content.token.length < 10) {
      suspicious.push(`Gateway token suspiciously short: "${content.token}"`);
    }
    if (suspicious.length > 0) {
      onTamper(`⚠️ SUSPICIOUS openclaw.json modification: ${suspicious.join(', ')}`);
    }
  } catch {
    onTamper('openclaw.json was modified but could not be parsed — possible corruption');
  }
}

function startPollingMonitor(
  configPath: string,
  onTamper: (detail: string) => void,
  pollMs: number,
): void {
  if (configPollTimer) return;
  log.info(`OpenClaw config integrity using poll (${pollMs}ms); native fs.watch is unsafe for ${configPath}`);
  configPollTimer = setInterval(() => {
    try {
      inspectConfigForTamper(configPath, onTamper);
    } catch {
      // Poll must never escape — this path exists so WSL UNC cannot crash Tandem.
    }
  }, pollMs);
  configPollTimer.unref?.();
}

export function startConfigIntegrityMonitor(
  onTamper: (detail: string) => void,
  options: ConfigIntegrityMonitorOptions = {},
): void {
  if (configWatcher || configPollTimer) return;
  const configPath = options.configPath ?? openClawConfigPath();
  try {
    if (!fs.existsSync(configPath)) return;
  } catch {
    return;
  }

  lastKnownConfigHash = hashFileSync(configPath);
  const pollMs = options.pollMs ?? CONFIG_POLL_MS;

  if (!canSafelyWatchOpenClawConfig(configPath)) {
    startPollingMonitor(configPath, onTamper, pollMs);
    return;
  }

  try {
    configWatcher = fs.watch(configPath, () => {
      try {
        inspectConfigForTamper(configPath, onTamper);
      } catch {
        // Watch callbacks must not become unhandled exceptions.
      }
    });
    configWatcher.on('error', () => {
      try { configWatcher?.close(); } catch { /* already dead */ }
      configWatcher = null;
      startPollingMonitor(configPath, onTamper, pollMs);
    });
  } catch (err) {
    log.warn(`fs.watch failed for OpenClaw config, falling back to poll: ${err instanceof Error ? err.message : String(err)}`);
    startPollingMonitor(configPath, onTamper, pollMs);
  }
}

export function stopConfigIntegrityMonitor(): void {
  try { configWatcher?.close(); } catch { /* ignore */ }
  configWatcher = null;
  if (configPollTimer) {
    clearInterval(configPollTimer);
    configPollTimer = null;
  }
}
const OPENCLAW_IDENTITY_PATH = tandemDir('openclaw', 'identity', 'device.json');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const OPENCLAW_SCOPES = ['operator.read', 'operator.write'] as const;

type OpenClawScope = typeof OPENCLAW_SCOPES[number];

interface StoredDeviceIdentity {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs: number;
}

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface OpenClawConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: 'webchat';
    version: string;
    platform: string;
    deviceFamily: string;
    mode: 'webchat';
    instanceId: string;
  };
  role: 'operator';
  scopes: OpenClawScope[];
  auth: {
    token: string;
  };
  gatewayUrl: string;
  device: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
}

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  });

  if (
    Buffer.isBuffer(spki)
    && spki.length === ED25519_SPKI_PREFIX.length + 32
    && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }

  return Buffer.from(spki);
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return crypto.createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex');
}

function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

async function writeIdentity(filePath: string, identity: DeviceIdentity): Promise<void> {
  ensureDir(path.dirname(filePath));
  const stored: StoredDeviceIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };
  await fs.promises.writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
}

async function loadOrCreateDeviceIdentity(filePath = OPENCLAW_IDENTITY_PATH): Promise<DeviceIdentity> {
  try {
    if (fs.existsSync(filePath)) {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoredDeviceIdentity>;
      if (
        parsed?.version === 1
        && typeof parsed.deviceId === 'string'
        && typeof parsed.publicKeyPem === 'string'
        && typeof parsed.privateKeyPem === 'string'
      ) {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedId !== parsed.deviceId) {
          const nextIdentity = {
            deviceId: derivedId,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem,
          };
          await writeIdentity(filePath, nextIdentity);
          return nextIdentity;
        }

        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {
    // Regenerate a fresh identity if the stored file is unreadable or malformed.
  }

  const identity = generateIdentity();
  await writeIdentity(filePath, identity);
  return identity;
}

export function readOpenClawGatewayToken(): string | null {
  const resolution = resolveOpenClawConfigPath();
  if (!resolution.exists) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(resolution.path, 'utf-8')) as Record<string, unknown>;
  return extractOpenClawGatewayToken(data);
}

export function readOpenClawGatewayUrl(): string {
  const resolution = resolveOpenClawConfigPath();
  if (!resolution.exists) {
    return `ws://127.0.0.1:${WEBHOOK_PORT}`;
  }

  const data = JSON.parse(fs.readFileSync(resolution.path, 'utf-8')) as Record<string, unknown>;
  const port = extractOpenClawGatewayPort(data, WEBHOOK_PORT);
  return `ws://127.0.0.1:${port}`;
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: readonly string[];
  signedAtMs: number;
  token: string;
  nonce: string;
  platform: string;
  deviceFamily: string;
}): string {
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    params.platform.trim().toLowerCase(),
    params.deviceFamily.trim().toLowerCase(),
  ].join('|');
}

export async function buildOpenClawConnectParams(nonce: string): Promise<OpenClawConnectParams> {
  const trimmedNonce = nonce.trim();
  if (!trimmedNonce) {
    throw new Error('nonce is required');
  }

  const token = readOpenClawGatewayToken();
  if (!token) {
    throw new Error('No token field in openclaw.json');
  }

  const identity = await loadOrCreateDeviceIdentity();
  const signedAt = Date.now();
  const platform = process.platform;
  const deviceFamily = 'desktop';
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: 'webchat',
    clientMode: 'webchat',
    role: 'operator',
    scopes: OPENCLAW_SCOPES,
    signedAtMs: signedAt,
    token,
    nonce: trimmedNonce,
    platform,
    deviceFamily,
  });
  const signature = base64UrlEncode(
    crypto.sign(null, Buffer.from(payload, 'utf8'), crypto.createPrivateKey(identity.privateKeyPem)),
  );

  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: 'webchat',
      version: '1.0',
      platform,
      deviceFamily,
      mode: 'webchat',
      instanceId: identity.deviceId,
    },
    role: 'operator',
    scopes: [...OPENCLAW_SCOPES],
    auth: { token },
    gatewayUrl: readOpenClawGatewayUrl(),
    device: {
      id: identity.deviceId,
      publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
      signature,
      signedAt,
      nonce: trimmedNonce,
    },
  };
}
