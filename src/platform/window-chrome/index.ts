import { NotImplementedError, type PlatformId } from '../errors';
import type { WindowChromeAdapter } from '../types';

export function createDarwinWindowChromeAdapter(): WindowChromeAdapter {
  return {
    getBrowserWindowOptions: () => ({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 10 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    }),
  };
}

export function createLinuxWindowChromeAdapter(): WindowChromeAdapter {
  return {
    getBrowserWindowOptions: () => ({
      frame: false,
    }),
  };
}

export function createWindowsWindowChromeAdapter(): WindowChromeAdapter {
  return {
    getBrowserWindowOptions: () => ({
      frame: false,
    }),
  };
}

export function createUnsupportedWindowChromeAdapter(platform: PlatformId): WindowChromeAdapter {
  return {
    getBrowserWindowOptions: () => {
      throw new NotImplementedError('Window chrome', platform, 'phase-1');
    },
  };
}
