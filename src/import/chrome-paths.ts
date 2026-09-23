import fs from 'fs';
import path from 'path';

/** Black Vault (Default) + Samwise (Profile 6) on the gtx1660 rig. */
export const DEFAULT_IDENTITY_PROFILES = ['Default', 'Profile 6'] as const;

export function firstExistingPath(candidates: string[], exists: (filePath: string) => boolean = (filePath) => fs.existsSync(filePath)): string {
  if (candidates.length === 0) return '';
  return candidates.find((candidate) => {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  }) ?? candidates[0];
}

export function chromeBookmarkCandidates(profilePath: string, join: (...parts: string[]) => string = path.join): string[] {
  return [
    join(profilePath, 'Bookmarks'),
    join(profilePath, 'AccountBookmarks'),
  ];
}

export function chromeCookieCandidates(profilePath: string, join: (...parts: string[]) => string = path.join): string[] {
  return [
    join(profilePath, 'Cookies'),
    join(profilePath, 'Network', 'Cookies'),
  ];
}

export function chromeSessionName(profileDir: string): string {
  const slug = profileDir.trim().toLowerCase().replace(/\s+/g, '-');
  return `chrome-${slug}`;
}

export function normalizeIdentityProfiles(profiles?: unknown): string[] {
  if (Array.isArray(profiles)) {
    const cleaned = profiles
      .filter((profile): profile is string => typeof profile === 'string')
      .map((profile) => profile.trim())
      .filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  return [...DEFAULT_IDENTITY_PROFILES];
}

export function readLastUsedChromeProfile(
  chromeBasePath: string,
  readFile: (filePath: string) => string = (filePath) => fs.readFileSync(filePath, 'utf-8'),
  join: (...parts: string[]) => string = path.join,
): string | null {
  try {
    const raw = JSON.parse(readFile(join(chromeBasePath, 'Local State'))) as {
      profile?: { last_used?: unknown };
    };
    const last = raw.profile?.last_used;
    return typeof last === 'string' && last.trim() ? last.trim() : null;
  } catch {
    return null;
  }
}

export function readChromeProfileDisplayName(
  preferencesPath: string,
  profileDir: string,
  readFile: (filePath: string) => string = (filePath) => fs.readFileSync(filePath, 'utf-8'),
): string {
  try {
    const prefs = JSON.parse(readFile(preferencesPath)) as { profile?: { name?: unknown } };
    const name = prefs.profile?.name;
    if (typeof name === 'string' && name.trim()) {
      return `${name.trim()} (${profileDir})`;
    }
  } catch {
    // use folder name
  }
  return profileDir;
}
