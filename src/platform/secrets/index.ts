import type * as StealthManagerModule from '../../stealth/manager';
import { NotImplementedError, type PlatformId } from '../errors';
import type { SecretsAdapter } from '../types';

export function createDarwinSecretsAdapter(): SecretsAdapter {
  return {
    loadOrCreateInstallSecret: () => {
      const { loadOrCreateInstallSecret } = require('../../stealth/manager') as typeof StealthManagerModule;
      return loadOrCreateInstallSecret();
    },
  };
}

export function createUnsupportedSecretsAdapter(platform: PlatformId): SecretsAdapter {
  return {
    loadOrCreateInstallSecret: () => {
      throw new NotImplementedError('Secrets at rest', platform, 'phase-5');
    },
  };
}
