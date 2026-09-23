import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChromeImporter } from '../chrome-importer';
import { createWindowsChromeImportAdapter } from '../../platform/chrome-import';

function writeProfile(root: string, profileDir: string, displayName: string): void {
  const profilePath = path.join(root, profileDir);
  fs.mkdirSync(path.join(profilePath, 'Network'), { recursive: true });
  fs.writeFileSync(path.join(profilePath, 'Preferences'), JSON.stringify({ profile: { name: displayName } }));
  fs.writeFileSync(path.join(profilePath, 'AccountBookmarks'), '{"roots":{}}');
  fs.writeFileSync(path.join(profilePath, 'Network', 'Cookies'), 'sqlite');
}

describe('ChromeImporter.importIdentities', () => {
  it('creates isolated sessions and applies CDP cookies only to the matching profile', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-identities-'));
    writeProfile(root, 'Default', 'Black Vault Enterprises');
    writeProfile(root, 'Profile 6', 'Samwise');
    fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 6' } }));

    const created: string[] = [];
    const set = vi.fn().mockResolvedValue(undefined);
    const importer = new ChromeImporter(undefined, createWindowsChromeImportAdapter(root), path.join(root, 'tandem'));

    try {
      const result = await importer.importIdentities({
        fetchCookies: async () => ({
          ok: true,
          port: 9222,
          cookies: [{ name: 'sid', value: 'fixture', domain: 'example.com' }],
        }),
        ensureSession: (name) => {
          created.push(name);
          return { name, partition: `persist:session-${name}`, created: true };
        },
        sessionForName: () => ({ cookies: { set } }),
      });

      expect(created).toEqual(['chrome-default', 'chrome-profile-6']);
      expect(result.cdpAvailable).toBe(true);
      expect(result.cdpProfile).toBe('Profile 6');
      expect(result.identities[0]).toMatchObject({
        profile: 'Default',
        displayName: 'Black Vault Enterprises (Default)',
        sessionName: 'chrome-default',
        cookiesImported: 0,
        cookiesSource: 'none',
        bookmarksFound: true,
        cookiesFileFound: true,
      });
      expect(result.identities[1]).toMatchObject({
        profile: 'Profile 6',
        displayName: 'Samwise (Profile 6)',
        cookiesImported: 1,
        cookiesSource: 'cdp',
      });
      expect(set).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(root, 'tandem', 'bookmarks.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
