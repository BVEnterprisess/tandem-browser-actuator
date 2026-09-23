import os from 'os';
import path from 'path';

export type PerfProfileId = 'default' | 'gtx1660';

export interface ChromiumSwitch {
  name: string;
  value?: string;
}

export interface PerfProfile {
  id: PerfProfileId;
  label: string;
  description: string;
  rendererHeapMb: number;
  rendererProcessLimit: number;
  diskCacheBytes: number;
  mediaCacheBytes: number;
  enableFeatures: string[];
  disableFeatures: string[];
  switches: ChromiumSwitch[];
}

export const DEFAULT_DISABLE_FEATURES = [
  'WebContentsForceDark',
  'ThirdPartyStoragePartitioning',
  'TrackingProtection3pcd',
];

export const GTX1660_PROFILE: PerfProfile = {
  id: 'gtx1660',
  label: 'GTX-1660 / Win10 19045 / i7-3770K',
  description: 'Tight process and heap limits for a 16 GB Win10 box whose WSL2 instance already holds 12 GB and 6 threads. ANGLE D3D11 + NVDEC for the GTX 1660. Does not disable site isolation or the security perimeter.',
  rendererHeapMb: 384,
  rendererProcessLimit: 3,
  diskCacheBytes: 134217728,
  mediaCacheBytes: 67108864,
  enableFeatures: [
    'CalculateNativeWinOcclusion',
    'IntensiveWakeUpThrottling',
  ],
  disableFeatures: [],
  switches: [
    { name: 'use-angle', value: 'd3d11' },
    { name: 'enable-gpu-rasterization' },
    { name: 'enable-zero-copy' },
    { name: 'ignore-gpu-blocklist' },
    { name: 'enable-accelerated-video-decode' },
    { name: 'enable-accelerated-mjpeg-decode' },
    { name: 'disable-software-rasterizer' },
    { name: 'process-per-site' },
    { name: 'renderer-process-limit', value: '3' },
  ],
};

export const DEFAULT_PROFILE: PerfProfile = {
  id: 'default',
  label: 'Upstream default',
  description: 'Preserves the existing 4 GB renderer heap and Electron compatibility feature disables.',
  rendererHeapMb: 4096,
  rendererProcessLimit: 0,
  diskCacheBytes: 0,
  mediaCacheBytes: 0,
  enableFeatures: [],
  disableFeatures: [],
  switches: [],
};

export function parsePerfProfileId(raw: string | undefined): PerfProfileId | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'gtx1660' || value === 'gtx-1660') return 'gtx1660';
  if (value === 'default' || value === 'upstream') return 'default';
  return null;
}

export function resolvePerfProfileId(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): PerfProfileId {
  for (const arg of argv) {
    if (arg === '--tandem-profile=gtx1660' || arg === '--profile=gtx1660') return 'gtx1660';
    if (arg.startsWith('--tandem-profile=')) {
      const parsed = parsePerfProfileId(arg.slice('--tandem-profile='.length));
      if (parsed) return parsed;
    }
    if (arg.startsWith('--profile=')) {
      const parsed = parsePerfProfileId(arg.slice('--profile='.length));
      if (parsed) return parsed;
    }
  }

  const fromEnv = parsePerfProfileId(env.TANDEM_PERF_PROFILE);
  if (fromEnv) return fromEnv;
  return 'default';
}

export function getPerfProfile(id: PerfProfileId = resolvePerfProfileId()): PerfProfile {
  switch (id) {
    case 'gtx1660':
      return GTX1660_PROFILE;
    case 'default':
      return DEFAULT_PROFILE;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export function mergeFeatureList(...groups: string[][]): string {
  return [...new Set(groups.flat().map((item) => item.trim()).filter(Boolean))].join(',');
}

export function buildChromiumSwitches(profile: PerfProfile, diskCacheDir?: string): ChromiumSwitch[] {
  const disableFeatures = mergeFeatureList(DEFAULT_DISABLE_FEATURES, profile.disableFeatures);
  const enableFeatures = mergeFeatureList(profile.enableFeatures);
  const switches: ChromiumSwitch[] = [
    { name: 'js-flags', value: `--max-old-space-size=${profile.rendererHeapMb}` },
    { name: 'enable-precise-memory-info' },
    { name: 'disable-features', value: disableFeatures },
  ];

  if (enableFeatures) {
    switches.push({ name: 'enable-features', value: enableFeatures });
  }

  if (profile.rendererProcessLimit > 0) {
    switches.push({ name: 'renderer-process-limit', value: String(profile.rendererProcessLimit) });
  }

  if (profile.diskCacheBytes > 0) {
    switches.push({ name: 'disk-cache-size', value: String(profile.diskCacheBytes) });
  }

  if (profile.mediaCacheBytes > 0) {
    switches.push({ name: 'media-cache-size', value: String(profile.mediaCacheBytes) });
  }

  if (diskCacheDir) {
    switches.push({ name: 'disk-cache-dir', value: diskCacheDir });
  }

  switches.push(...profile.switches);
  return dedupeSwitches(switches);
}

function dedupeSwitches(switches: ChromiumSwitch[]): ChromiumSwitch[] {
  const seen = new Map<string, ChromiumSwitch>();
  for (const item of switches) {
    seen.set(item.name, item);
  }
  return [...seen.values()];
}

export function defaultDiskCacheDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') {
    const appData = env.APPDATA && env.APPDATA.trim()
      ? env.APPDATA
      : path.win32.join(os.homedir(), 'AppData', 'Roaming');
    return path.win32.join(appData, 'Tandem Browser', 'Cache');
  }
  return path.join(os.homedir(), '.tandem', 'Cache');
}

export function switchesToArgv(switches: ChromiumSwitch[]): string[] {
  return switches.map((item) => (
    item.value === undefined ? `--${item.name}` : `--${item.name}=${item.value}`
  ));
}
