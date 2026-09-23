import { app } from 'electron';

import {
  buildChromiumSwitches,
  defaultDiskCacheDir,
  getPerfProfile,
  resolvePerfProfileId,
  type PerfProfile,
} from './profile';

export function applyChromiumLaunchProfile(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): PerfProfile {
  const profile = getPerfProfile(resolvePerfProfileId(env, argv));
  const cacheDir = profile.id === 'default' ? undefined : defaultDiskCacheDir(process.platform, env);
  const switches = buildChromiumSwitches(profile, cacheDir);

  for (const item of switches) {
    if (item.value === undefined) {
      app.commandLine.appendSwitch(item.name);
    } else {
      app.commandLine.appendSwitch(item.name, item.value);
    }
  }

  return profile;
}
