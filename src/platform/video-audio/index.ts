import type * as VideoRecorderModule from '../../video/recorder';
import { NotImplementedError, type PlatformId } from '../errors';
import type { VideoAudioAdapter } from '../types';

export function createDarwinVideoAudioAdapter(): VideoAudioAdapter {
  return {
    createRecorder: () => {
      const { VideoRecorderManager } = require('../../video/recorder') as typeof VideoRecorderModule;
      return new VideoRecorderManager();
    },
  };
}

export function createUnsupportedVideoAudioAdapter(platform: PlatformId): VideoAudioAdapter {
  return {
    createRecorder: () => {
      throw new NotImplementedError('Video recorder system audio', platform, 'phase-11');
    },
  };
}
