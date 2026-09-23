#!/usr/bin/env node
/**
 * Force the designed Wingman path on this rig:
 *   general.activeBackend = openclaw
 *   general.startPage = wingman
 *
 * Merges into the existing Windows/Tandem config.json. Does not rewrite tokens
 * or other operator settings.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function isWsl() {
  try {
    return fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function resolveTandemConfigPath(options = {}) {
  if (options.configPath) return options.configPath;
  if (process.env.TANDEM_CONFIG_PATH) return process.env.TANDEM_CONFIG_PATH;

  const rig = options.rig || {};
  const windowsUser = rig.windows?.user || process.env.TANDEM_WINDOWS_USER || 'johnh';

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA && process.env.APPDATA.trim()
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Tandem Browser', 'config.json');
  }

  if (isWsl()) {
    return path.posix.join('/mnt/c/Users', windowsUser, 'AppData/Roaming/Tandem Browser/config.json');
  }

  return path.join(os.homedir(), '.tandem', 'config.json');
}

function applyWingmanConfig(options = {}) {
  const configPath = resolveTandemConfigPath(options);
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      existing = {};
    }
  }

  const next = {
    ...existing,
    general: {
      ...(existing.general && typeof existing.general === 'object' ? existing.general : {}),
      activeBackend: options.activeBackend || 'openclaw',
      startPage: options.startPage || 'wingman',
    },
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { path: configPath, activeBackend: next.general.activeBackend, startPage: next.general.startPage };
}

module.exports = { applyWingmanConfig, resolveTandemConfigPath, isWsl };

if (require.main === module) {
  const rigPath = path.join(__dirname, 'rig.json');
  const rig = fs.existsSync(rigPath) ? JSON.parse(fs.readFileSync(rigPath, 'utf-8')) : {};
  const result = applyWingmanConfig({
    rig,
    activeBackend: rig.tandem?.activeBackend,
    startPage: rig.tandem?.startPage,
  });
  console.log(`[gtx1660] Wingman config ${result.path} activeBackend=${result.activeBackend} startPage=${result.startPage}`);
}
