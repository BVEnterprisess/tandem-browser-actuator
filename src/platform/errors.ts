export class NotImplementedError extends Error {
  constructor(feature: string, platform: PlatformId, phase: string) {
    super(`${feature} on ${platform} is not implemented yet - see windows-support ${phase}.`);
    this.name = 'NotImplementedError';
  }
}

export type PlatformId = 'darwin' | 'win32' | 'linux' | 'unsupported';
