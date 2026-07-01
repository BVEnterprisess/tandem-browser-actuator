import fs from 'fs';
import os from 'os';
import path from 'path';
import { NotImplementedError, type PlatformId } from '../errors';
import type { PathsAdapter } from '../types';

const PRODUCT_DATA_DIR = 'Tandem Browser';

function createNodePathsAdapter(resolveRoot: () => string): PathsAdapter {
  return {
    tandemDir: (...subpath) => path.join(resolveRoot(), ...subpath),
    ensureDir: (dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    },
  };
}

function legacyTandemRoot(): string {
  return path.join(os.homedir(), '.tandem');
}

function windowsTandemRoot(): string {
  const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, PRODUCT_DATA_DIR);
}

export function createDarwinPathsAdapter(): PathsAdapter {
  return createNodePathsAdapter(legacyTandemRoot);
}

export function createLinuxPathsAdapter(): PathsAdapter {
  return createNodePathsAdapter(legacyTandemRoot);
}

export function createWindowsPathsAdapter(): PathsAdapter {
  return createNodePathsAdapter(windowsTandemRoot);
}

export function createUnsupportedPathsAdapter(platform: PlatformId): PathsAdapter {
  return {
    tandemDir: () => {
      throw new NotImplementedError('User data paths', platform, 'phase-4');
    },
    ensureDir: () => {
      throw new NotImplementedError('User data paths', platform, 'phase-4');
    },
  };
}
