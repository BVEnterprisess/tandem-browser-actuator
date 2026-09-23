import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISABLE_FEATURES,
  GTX1660_PROFILE,
  buildChromiumSwitches,
  defaultDiskCacheDir,
  getPerfProfile,
  resolvePerfProfileId,
  switchesToArgv,
} from '../profile';

describe('resolvePerfProfileId', () => {
  it('reads --tandem-profile and TANDEM_PERF_PROFILE', () => {
    expect(resolvePerfProfileId({}, [])).toBe('default');
    expect(resolvePerfProfileId({ TANDEM_PERF_PROFILE: 'gtx1660' }, [])).toBe('gtx1660');
    expect(resolvePerfProfileId({}, ['--tandem-profile=gtx1660'])).toBe('gtx1660');
    expect(resolvePerfProfileId({ TANDEM_PERF_PROFILE: 'default' }, ['--profile=gtx1660'])).toBe('gtx1660');
  });
});

describe('gtx1660 profile', () => {
  it('keeps a tight heap and process cap without dropping site isolation', () => {
    const profile = getPerfProfile('gtx1660');
    expect(profile.rendererHeapMb).toBeLessThan(512);
    expect(profile.rendererProcessLimit).toBe(3);
    expect(profile.switches.some((item) => item.name === 'use-angle' && item.value === 'd3d11')).toBe(true);
    expect(profile.switches.some((item) => item.name === 'process-per-site')).toBe(true);
    expect(JSON.stringify(profile)).not.toMatch(/disable-site-isolation/);
    expect(profile.disableFeatures).not.toContain('SiteIsolation');
  });

  it('merges upstream Electron compatibility disables with the profile', () => {
    const switches = buildChromiumSwitches(GTX1660_PROFILE, 'C:\\Cache');
    const disable = switches.find((item) => item.name === 'disable-features');
    for (const feature of DEFAULT_DISABLE_FEATURES) {
      expect(disable?.value).toContain(feature);
    }
    expect(switches.find((item) => item.name === 'js-flags')?.value).toBe('--max-old-space-size=384');
    expect(switches.find((item) => item.name === 'disk-cache-dir')?.value).toBe('C:\\Cache');
    expect(switchesToArgv(switches).some((arg) => arg.startsWith('--renderer-process-limit=3'))).toBe(true);
  });

  it('keeps Windows cache on NTFS AppData, not a WSL path', () => {
    const cacheDir = defaultDiskCacheDir('win32', { APPDATA: 'C:\\Users\\johnh\\AppData\\Roaming' });
    expect(cacheDir).toBe('C:\\Users\\johnh\\AppData\\Roaming\\Tandem Browser\\Cache');
    expect(cacheDir.startsWith('/mnt/')).toBe(false);
    expect(cacheDir.includes('wsl')).toBe(false);
  });

  it('preserves the upstream 4 GB heap for the default profile', () => {
    expect(getPerfProfile('default').rendererHeapMb).toBe(4096);
    const switches = buildChromiumSwitches(getPerfProfile('default'));
    expect(switches.find((item) => item.name === 'js-flags')?.value).toBe('--max-old-space-size=4096');
    expect(switches.some((item) => item.name === 'renderer-process-limit')).toBe(false);
  });
});
