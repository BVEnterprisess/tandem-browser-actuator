import type { PlatformId } from '../errors';
import type { ProcessAdapter } from '../types';

export function createProcessAdapter(platform: PlatformId): ProcessAdapter {
  return {
    platform,
    isMacOS: () => platform === 'darwin',
    isWindows: () => platform === 'win32',
    isLinux: () => platform === 'linux',
  };
}
