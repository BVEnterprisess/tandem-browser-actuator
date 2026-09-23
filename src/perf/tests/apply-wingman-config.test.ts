import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { applyWingmanConfig } = require('../../../deploy/gtx1660/apply-wingman-config.js') as {
  applyWingmanConfig: (options: { configPath: string; activeBackend?: string; startPage?: string }) => {
    path: string;
    activeBackend: string;
    startPage: string;
  };
};

describe('applyWingmanConfig', () => {
  it('merges openclaw/wingman without dropping other settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-wingman-config-'));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      general: { activeBackend: 'tandem', agentName: 'Wingman' },
      webhook: { secret: 'keep-me' },
    }));

    try {
      const result = applyWingmanConfig({ configPath });
      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(result.activeBackend).toBe('openclaw');
      expect(result.startPage).toBe('wingman');
      expect(written.general.activeBackend).toBe('openclaw');
      expect(written.general.agentName).toBe('Wingman');
      expect(written.webhook.secret).toBe('keep-me');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
