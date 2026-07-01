import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from '../../utils/logger';
import { NotImplementedError, type PlatformId } from '../errors';
import type { NativeMessagingAdapter } from '../types';
import type {
  NativeMessagingDetectionAdapter,
  NativeMessagingManifestLocation,
} from '../../extensions/native-messaging';
import { NativeMessagingSetup } from '../../extensions/native-messaging';

const log = createLogger('NativeMessagingPlatform');

type RegistryHive = 'HKCU' | 'HKLM';
type WindowsRegistryReader = (hive: RegistryHive, subkey: string) => string[];

const WINDOWS_NATIVE_MESSAGING_SUBKEY = 'Software\\Google\\Chrome\\NativeMessagingHosts';

interface NativeMessagingDetectionOptions {
  dirs: string[];
  mirrorToTandemDir?: {
    targetDir: string;
    sourceDirs: string[];
  };
  registryLocations?: () => NativeMessagingManifestLocation[];
}

export interface WindowsNativeMessagingAdapterOptions {
  chromeUserDataNativeMessagingDir?: string;
  registryReader?: WindowsRegistryReader;
}

function createDetectionAdapter(options: NativeMessagingDetectionOptions): NativeMessagingDetectionAdapter {
  return {
    getNativeMessagingDirs: () => options.dirs.map((dir) => ({ path: dir, exists: fs.existsSync(dir) })),
    getManifestLocations: () => {
      const filesystemLocations = options.dirs
        .filter((dir) => fs.existsSync(dir))
        .flatMap((dir) => listManifestFiles(dir));

      return [
        ...(options.registryLocations?.() ?? []),
        ...filesystemLocations,
      ];
    },
    mirrorManifestsToTandemDir: () => {
      if (!options.mirrorToTandemDir) return;
      mirrorManifestsToTandemDir(options.mirrorToTandemDir.targetDir, options.mirrorToTandemDir.sourceDirs);
    },
  };
}

function listManifestFiles(dir: string): NativeMessagingManifestLocation[] {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({
        manifestPath: path.join(dir, file),
        source: 'filesystem' as const,
      }));
  } catch {
    return [];
  }
}

function mirrorManifestsToTandemDir(targetDir: string, sourceDirs: string[]): void {
  const existingSourceDirs = sourceDirs
    .filter((dir) => dir !== targetDir && fs.existsSync(dir));

  if (existingSourceDirs.length === 0) return;

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch {
    log.warn('Native messaging: failed to create Tandem NativeMessagingHosts directory');
    return;
  }

  let mirrored = 0;
  for (const srcDir of existingSourceDirs) {
    try {
      const files = fs.readdirSync(srcDir).filter((file) => file.endsWith('.json'));
      for (const file of files) {
        const src = path.join(srcDir, file);
        const dst = path.join(targetDir, file);
        try {
          const srcStat = fs.statSync(src);
          let needsCopy = true;
          try {
            const dstStat = fs.statSync(dst);
            needsCopy = srcStat.mtimeMs > dstStat.mtimeMs;
          } catch {
            // Destination does not exist.
          }
          if (needsCopy) {
            fs.copyFileSync(src, dst);
            mirrored++;
          }
        } catch {
          // Skip unreadable files.
        }
      }
    } catch {
      // Skip unreadable directories.
    }
  }

  if (mirrored > 0) {
    log.info(`Native messaging: mirrored ${mirrored} manifest(s) to ${targetDir}`);
  }
}

function createSetupWithDetectionAdapter(detectionAdapter: NativeMessagingDetectionAdapter): NativeMessagingAdapter {
  return {
    createDetectionAdapter: () => detectionAdapter,
    createSetup: () => {
      return new NativeMessagingSetup(detectionAdapter);
    },
  };
}

export function createDarwinNativeMessagingDetectionAdapter(): NativeMessagingDetectionAdapter {
  const chromeUserDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  const chromiumUserDir = path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts');
  const tandemDir = path.join(os.homedir(), 'Library', 'Application Support', 'Tandem Browser', 'NativeMessagingHosts');

  return createDetectionAdapter({
    dirs: [
      '/Library/Google/Chrome/NativeMessagingHosts',
      chromeUserDir,
      chromiumUserDir,
      tandemDir,
      path.join(os.homedir(), 'Library', 'Application Support', 'tandem-browser', 'NativeMessagingHosts'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'NativeMessagingHosts'),
    ],
    mirrorToTandemDir: {
      targetDir: tandemDir,
      sourceDirs: [
        chromeUserDir,
        '/Library/Google/Chrome/NativeMessagingHosts',
        chromiumUserDir,
      ],
    },
  });
}

export function createLinuxNativeMessagingDetectionAdapter(): NativeMessagingDetectionAdapter {
  return createDetectionAdapter({
    dirs: [
      '/etc/opt/chrome/native-messaging-hosts',
      path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'),
      path.join(os.homedir(), '.config', 'chromium', 'NativeMessagingHosts'),
    ],
  });
}

export function createWindowsNativeMessagingDetectionAdapter(
  options: WindowsNativeMessagingAdapterOptions = {},
): NativeMessagingDetectionAdapter {
  const nativeMessagingDir = options.chromeUserDataNativeMessagingDir ??
    path.join(windowsChromeBasePath(), 'NativeMessagingHosts');
  const registryReader = options.registryReader ?? readWindowsRegistryManifestPaths;

  return createDetectionAdapter({
    dirs: [nativeMessagingDir],
    registryLocations: () => {
      const locations: NativeMessagingManifestLocation[] = [];
      for (const hive of ['HKCU', 'HKLM'] as const) {
        for (const manifestPath of registryReader(hive, WINDOWS_NATIVE_MESSAGING_SUBKEY)) {
          if (manifestPath.trim().length === 0) continue;
          locations.push({
            manifestPath,
            source: 'registry',
            registryKey: `${hive}\\${WINDOWS_NATIVE_MESSAGING_SUBKEY}`,
          });
        }
      }
      return locations;
    },
  });
}

function windowsChromeBasePath(): string {
  const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Google', 'Chrome', 'User Data');
}

function readWindowsRegistryManifestPaths(hive: RegistryHive, subkey: string): string[] {
  const root = hive === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
  const registryPath = `${root}\\${subkey}`;
  const script = [
    `$root = 'Registry::${registryPath}'`,
    '$paths = @()',
    'Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {',
    "  $value = $_.GetValue('')",
    '  if ($value -is [string] -and $value.Trim().Length -gt 0) { $paths += $value }',
    '}',
    'ConvertTo-Json -InputObject $paths -Compress',
  ].join('; ');

  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
    }).trim();

    if (!output) return [];
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === 'string');
    }
    return typeof parsed === 'string' ? [parsed] : [];
  } catch {
    return [];
  }
}

export function createDarwinNativeMessagingAdapter(): NativeMessagingAdapter {
  return createSetupWithDetectionAdapter(createDarwinNativeMessagingDetectionAdapter());
}

export function createWindowsNativeMessagingAdapter(options: WindowsNativeMessagingAdapterOptions = {}): NativeMessagingAdapter {
  return createSetupWithDetectionAdapter(createWindowsNativeMessagingDetectionAdapter(options));
}

export function createLinuxNativeMessagingAdapter(): NativeMessagingAdapter {
  return createSetupWithDetectionAdapter(createLinuxNativeMessagingDetectionAdapter());
}

export function createUnsupportedNativeMessagingAdapter(platform: PlatformId): NativeMessagingAdapter {
  return {
    createDetectionAdapter: () => {
      throw new NotImplementedError('NativeMessaging', platform, 'phase-9');
    },
    createSetup: () => {
      throw new NotImplementedError('NativeMessaging', platform, 'phase-9');
    },
  };
}
