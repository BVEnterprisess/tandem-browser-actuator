import fs from 'fs';
import os from 'os';
import path from 'path';

export type OpenClawConfigSource = 'env' | 'wsl-unc' | 'native-home' | 'tandem-pointer';

export interface OpenClawConfigResolution {
  path: string;
  source: OpenClawConfigSource;
  exists: boolean;
  score: number;
}

export interface ResolveOpenClawConfigOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  cwd?: string;
  exists?: (candidate: string) => boolean;
  readFile?: (candidate: string) => string;
  wslUncRoots?: string[];
}

const DEFAULT_WSL_DISTRO = 'Ubuntu';
const DEFAULT_WSL_USER = 'jp';

function pathExists(candidate: string, exists: (candidate: string) => boolean): boolean {
  try {
    return exists(candidate);
  } catch {
    return false;
  }
}

function scoreConfig(raw: string): number {
  try {
    const data = JSON.parse(raw) as {
      token?: unknown;
      gateway?: { mode?: unknown; auth?: { token?: unknown }; port?: unknown };
      models?: unknown;
    };
    let score = raw.length;
    if (typeof data.token === 'string' && data.token.length > 8) score += 1000;
    if (typeof data.gateway?.auth?.token === 'string' && data.gateway.auth.token.length > 8) score += 1000;
    if (data.gateway?.mode) score += 500;
    if (data.gateway?.port) score += 100;
    if (data.models) score += 500;
    return score;
  } catch {
    return 0;
  }
}

function toUncFromPosix(root: string, distro: string, posixPath: string): string {
  const trimmed = posixPath.replace(/^\/+/, '').replace(/\//g, '\\');
  return `${root}\\${distro}\\${trimmed}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function listWslOpenClawCandidates(options: ResolveOpenClawConfigOptions = {}): string[] {
  const env = options.env ?? process.env;
  const distro = (env.TANDEM_WSL_DISTRO || DEFAULT_WSL_DISTRO).trim();
  const user = (env.TANDEM_WSL_USER || DEFAULT_WSL_USER).trim();
  const posixPath = (env.TANDEM_WSL_OPENCLAW_CONFIG || `/home/${user}/.openclaw/openclaw.json`).trim();
  const roots = options.wslUncRoots ?? ['\\\\wsl$', '\\\\wsl.localhost'];
  return unique(roots.flatMap((root) => [
    toUncFromPosix(root, distro, posixPath),
  ]));
}

export function listOpenClawConfigCandidates(options: ResolveOpenClawConfigOptions = {}): Array<{
  path: string;
  source: OpenClawConfigSource;
}> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const candidates: Array<{ path: string; source: OpenClawConfigSource }> = [];

  const envPath = env.TANDEM_OPENCLAW_CONFIG?.trim();
  if (envPath) {
    candidates.push({ path: envPath, source: 'env' });
  }

  if (platform === 'win32') {
    for (const wslPath of listWslOpenClawCandidates(options)) {
      candidates.push({ path: wslPath, source: 'wsl-unc' });
    }
  }

  candidates.push({
    path: path.join(homedir, '.openclaw', 'openclaw.json'),
    source: 'native-home',
  });

  const pointer = path.join(cwd, 'deploy', 'gtx1660', 'openclaw-pointer.json');
  candidates.push({ path: pointer, source: 'tandem-pointer' });

  return candidates;
}

export function resolveOpenClawConfigPath(options: ResolveOpenClawConfigOptions = {}): OpenClawConfigResolution {
  const exists = options.exists ?? ((candidate: string) => fs.existsSync(candidate));
  const readFile = options.readFile ?? ((candidate: string) => fs.readFileSync(candidate, 'utf-8'));
  const env = options.env ?? process.env;
  const candidates = listOpenClawConfigCandidates(options);

  const envForced = env.TANDEM_OPENCLAW_CONFIG?.trim();
  if (envForced) {
    const existsOnDisk = pathExists(envForced, exists);
    return {
      path: envForced,
      source: 'env',
      exists: existsOnDisk,
      score: existsOnDisk ? Number.MAX_SAFE_INTEGER : 0,
    };
  }

  let best: OpenClawConfigResolution | null = null;
  for (const candidate of candidates) {
    if (candidate.source === 'env') continue;
    if (!pathExists(candidate.path, exists)) continue;

    let raw: string;
    try {
      raw = readFile(candidate.path);
    } catch {
      continue;
    }

    if (candidate.source === 'tandem-pointer') {
      try {
        const pointer = JSON.parse(raw) as { path?: string };
        if (typeof pointer.path === 'string' && pointer.path.trim() && pathExists(pointer.path, exists)) {
          const pointedRaw = readFile(pointer.path);
          const resolution: OpenClawConfigResolution = {
            path: pointer.path,
            source: 'tandem-pointer',
            exists: true,
            score: scoreConfig(pointedRaw) + 50,
          };
          if (!best || resolution.score > best.score) best = resolution;
        }
      } catch {
        continue;
      }
      continue;
    }

    const resolution: OpenClawConfigResolution = {
      path: candidate.path,
      source: candidate.source,
      exists: true,
      score: scoreConfig(raw),
    };
    if (!best || resolution.score > best.score) {
      best = resolution;
    }
  }

  if (best) return best;

  const native = path.join(options.homedir ?? os.homedir(), '.openclaw', 'openclaw.json');
  return {
    path: native,
    source: 'native-home',
    exists: false,
    score: 0,
  };
}

export function readOpenClawConfigFile(options: ResolveOpenClawConfigOptions = {}): {
  resolution: OpenClawConfigResolution;
  data: Record<string, unknown> | null;
} {
  const resolution = resolveOpenClawConfigPath(options);
  if (!resolution.exists) {
    return { resolution, data: null };
  }

  const readFile = options.readFile ?? ((candidate: string) => fs.readFileSync(candidate, 'utf-8'));
  try {
    const data = JSON.parse(readFile(resolution.path)) as Record<string, unknown>;
    return { resolution, data };
  } catch {
    return { resolution, data: null };
  }
}

export function extractOpenClawGatewayToken(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  if (typeof data.token === 'string' && data.token.length > 0) return data.token;
  const gateway = data.gateway as { auth?: { token?: unknown } } | undefined;
  if (typeof gateway?.auth?.token === 'string' && gateway.auth.token.length > 0) {
    return gateway.auth.token;
  }
  return null;
}

export function extractOpenClawGatewayPort(data: Record<string, unknown> | null, fallback = 18789): number {
  const gateway = data?.gateway as { port?: unknown } | undefined;
  const raw = gateway?.port;
  const port = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
}
