import { selectPlatform } from '../platform';

/** Return the platform-specific Tandem data path, e.g. `<userData>/extensions`. */
export function tandemDir(...subpath: string[]): string {
  return selectPlatform().paths.tandemDir(...subpath);
}

/** Create directory if it doesn't exist (sync). Returns the path. */
export function ensureDir(dir: string): string {
  return selectPlatform().paths.ensureDir(dir);
}
