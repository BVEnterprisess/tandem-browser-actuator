import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  chromeBookmarkCandidates,
  chromeCookieCandidates,
  chromeSessionName,
  firstExistingPath,
  normalizeIdentityProfiles,
  readChromeProfileDisplayName,
  readLastUsedChromeProfile,
  DEFAULT_IDENTITY_PROFILES,
} from '../chrome-paths';

describe('chrome-paths', () => {
  it('defaults identities to Default + Profile 6', () => {
    expect(DEFAULT_IDENTITY_PROFILES).toEqual(['Default', 'Profile 6']);
    expect(normalizeIdentityProfiles(undefined)).toEqual(['Default', 'Profile 6']);
    expect(normalizeIdentityProfiles(['Profile 6'])).toEqual(['Profile 6']);
    expect(normalizeIdentityProfiles(['  ', ''])).toEqual(['Default', 'Profile 6']);
  });

  it('prefers the first existing bookmark or cookie path', () => {
    const existing = new Set([
      path.join('Default', 'AccountBookmarks'),
      path.join('Default', 'Network', 'Cookies'),
    ]);
    const exists = (candidate: string) => existing.has(candidate);

    expect(firstExistingPath(chromeBookmarkCandidates('Default'), exists)).toBe(path.join('Default', 'AccountBookmarks'));
    expect(firstExistingPath(chromeCookieCandidates('Default'), exists)).toBe(path.join('Default', 'Network', 'Cookies'));
    expect(firstExistingPath(chromeBookmarkCandidates('Missing'), exists)).toBe(path.join('Missing', 'Bookmarks'));
  });

  it('slugs Chrome profile folders into isolated session names', () => {
    expect(chromeSessionName('Default')).toBe('chrome-default');
    expect(chromeSessionName('Profile 6')).toBe('chrome-profile-6');
  });

  it('reads Local State last_used and Preferences display names', () => {
    expect(readLastUsedChromeProfile('/chrome', () => JSON.stringify({ profile: { last_used: 'Profile 6' } }), path.posix.join)).toBe('Profile 6');
    expect(readLastUsedChromeProfile('/chrome', () => '{', path.posix.join)).toBeNull();
    expect(readChromeProfileDisplayName('/prefs', 'Default', () => JSON.stringify({ profile: { name: 'Black Vault Enterprises' } }))).toBe('Black Vault Enterprises (Default)');
    expect(readChromeProfileDisplayName('/prefs', 'Profile 6', () => '{')).toBe('Profile 6');
  });
});
