import type * as ChromeImportModule from '../../import/chrome-importer';
import path from 'path';
import os from 'os';
import { NotImplementedError, type PlatformId } from '../errors';
import type { ChromeImportAdapter } from '../types';
import { assertSinglePathSegment, resolvePathWithinRoot } from '../../utils/security';
import { firstExistingPath } from '../../import/chrome-paths';

function createNodeChromeImportAdapter(resolveBasePath: () => string, cookieSupport: ChromeImportAdapter['getCookieImportSupport']): ChromeImportAdapter {
  const adapter: ChromeImportAdapter = {
    createImporter: (configManager) => {
      const { ChromeImporter } = require('../../import/chrome-importer') as typeof ChromeImportModule;
      return new ChromeImporter(configManager, adapter);
    },
    getDefaultChromeBasePath: resolveBasePath,
    resolveProfilePath: (profileDir) => {
      const safeProfileDir = assertSinglePathSegment(profileDir, 'Chrome profile');
      return resolvePathWithinRoot(resolveBasePath(), safeProfileDir);
    },
    resolveProfileDataPaths: (profileDir) => {
      const profilePath = adapter.resolveProfilePath(profileDir);
      return {
        profilePath,
        bookmarksPath: firstExistingPath([
          resolvePathWithinRoot(profilePath, 'Bookmarks'),
          resolvePathWithinRoot(profilePath, 'AccountBookmarks'),
        ]),
        historyPath: resolvePathWithinRoot(profilePath, 'History'),
        cookiesPath: firstExistingPath([
          resolvePathWithinRoot(profilePath, 'Cookies'),
          resolvePathWithinRoot(profilePath, 'Network', 'Cookies'),
        ]),
        preferencesPath: resolvePathWithinRoot(profilePath, 'Preferences'),
        extensionsPath: resolvePathWithinRoot(profilePath, 'Extensions'),
      };
    },
    getCookieImportSupport: cookieSupport,
    getUnavailableStatus: (profilePath = '') => ({
      chromeFound: false,
      bookmarksFound: false,
      historyFound: false,
      cookiesFound: false,
      profilePath,
      cookiesImportSupported: cookieSupport().encryptedStore,
      cookiesImportStatus: cookieSupport().message,
    }),
  };

  return adapter;
}

function windowsChromeBasePath(): string {
  const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Google', 'Chrome', 'User Data');
}

export function createDarwinChromeImportAdapter(chromeBasePath?: string): ChromeImportAdapter {
  return createNodeChromeImportAdapter(
    () => chromeBasePath ?? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    () => ({
      encryptedStore: false,
      status: 'partial',
      message: 'Cookie import uses Chrome DevTools Protocol or pre-exported JSON fallback.',
    }),
  );
}

export function createWindowsChromeImportAdapter(chromeBasePath?: string): ChromeImportAdapter {
  return createNodeChromeImportAdapter(
    () => chromeBasePath ?? windowsChromeBasePath(),
    () => ({
      encryptedStore: false,
      status: 'partial',
      message: 'Windows Chrome cookies are DPAPI-encrypted on disk. Import uses Chrome DevTools Protocol (Network.getAllCookies) or pre-exported JSON. DPAPI decryption is not implemented.',
    }),
  );
}

export function createLinuxChromeImportAdapter(chromeBasePath?: string): ChromeImportAdapter {
  return createNodeChromeImportAdapter(
    () => chromeBasePath ?? path.join(os.homedir(), '.config', 'google-chrome'),
    () => ({
      encryptedStore: false,
      status: 'partial',
      message: 'Linux cookie import remains partial and uses Chrome DevTools Protocol or pre-exported JSON fallback.',
    }),
  );
}

export function createUnsupportedChromeImportAdapter(platform: PlatformId): ChromeImportAdapter {
  return {
    createImporter: () => {
      throw new NotImplementedError('Chrome import', platform, 'phase-8');
    },
    getDefaultChromeBasePath: () => '',
    resolveProfilePath: () => {
      throw new NotImplementedError('Chrome import profile paths', platform, 'phase-8');
    },
    resolveProfileDataPaths: () => {
      throw new NotImplementedError('Chrome import profile paths', platform, 'phase-8');
    },
    getCookieImportSupport: () => ({
      encryptedStore: false,
      status: 'unsupported',
      message: `Chrome cookie import is unsupported on ${platform}.`,
    }),
    getUnavailableStatus: (profilePath = '') => ({
      chromeFound: false,
      bookmarksFound: false,
      historyFound: false,
      cookiesFound: false,
      profilePath,
      cookiesImportSupported: false,
      cookiesImportStatus: `Chrome import is unsupported on ${platform}.`,
    }),
  };
}
