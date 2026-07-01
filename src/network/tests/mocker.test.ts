import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { NetworkMocker } from '../mocker';

function createMockDevTools() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sendCommand: vi.fn().mockResolvedValue(undefined),
  };
}

type MutableMocker = {
  globMatch: (pattern: string, url: string) => boolean;
  matchRule: (url: string) => unknown;
  rules: Array<{ id: string; pattern: string; abort?: boolean; status?: number; body?: unknown; headers?: Record<string, string>; delay?: number; createdAt: number }>;
  fetchEnabled: boolean;
};

describe('NetworkMocker', () => {
  let mocker: NetworkMocker;
  let devtools: ReturnType<typeof createMockDevTools>;
  let mut: MutableMocker;

  beforeEach(() => {
    devtools = createMockDevTools();
    mocker = new NetworkMocker(devtools as never);
    mut = mocker as unknown as MutableMocker;
  });

  // ─── Glob matching ───

  describe('globMatch', () => {
    it('matches exact URL', () => {
      expect(mut.globMatch('https://api.com/data', 'https://api.com/data')).toBe(true);
    });

    it('does not match different URL', () => {
      expect(mut.globMatch('https://api.com/data', 'https://api.com/other')).toBe(false);
    });

    it('* matches any segment characters except /', () => {
      expect(mut.globMatch('https://api.com/*/data', 'https://api.com/v1/data')).toBe(true);
      expect(mut.globMatch('https://api.com/*/data', 'https://api.com/v2/data')).toBe(true);
      expect(mut.globMatch('https://api.com/*/data', 'https://api.com/v1/v2/data')).toBe(false);
    });

    it('** matches anything including /', () => {
      expect(mut.globMatch('https://api.com/**', 'https://api.com/v1/users/42')).toBe(true);
      expect(mut.globMatch('**/api/**', 'https://example.com/api/v1/users')).toBe(true);
    });

    it('? matches single non-/ character', () => {
      expect(mut.globMatch('https://api.com/v?/data', 'https://api.com/v1/data')).toBe(true);
      expect(mut.globMatch('https://api.com/v?/data', 'https://api.com/v2/data')).toBe(true);
      expect(mut.globMatch('https://api.com/v?/data', 'https://api.com/v12/data')).toBe(false);
    });

    it('escapes regex special characters in pattern', () => {
      expect(mut.globMatch('https://api.com/data.json', 'https://api.com/data.json')).toBe(true);
      expect(mut.globMatch('https://api.com/data.json', 'https://api.com/dataXjson')).toBe(false);
    });

    it('handles trailing ** with optional /', () => {
      expect(mut.globMatch('https://api.com/**/', 'https://api.com/v1/')).toBe(true);
      expect(mut.globMatch('https://api.com/**/', 'https://api.com/v1')).toBe(true);
    });

    it('returns false for invalid regex pattern', () => {
      // This should not throw — globMatch catches regex errors
      expect(mut.globMatch('[invalid', 'test')).toBe(false);
    });
  });

  // ─── Rule management ───

  describe('addRule', () => {
    it('adds a rule with generated id and timestamp', async () => {
      const rule = await mocker.addRule({ pattern: '**/*.json' });
      expect(rule.id).toBeTruthy();
      expect(rule.createdAt).toBeGreaterThan(0);
      expect(rule.pattern).toBe('**/*.json');
    });

    it('enables Fetch domain on first rule', async () => {
      await mocker.addRule({ pattern: '*' });
      expect(devtools.sendCommand).toHaveBeenCalledWith('Fetch.enable', expect.any(Object));
    });

    it('does not re-enable Fetch on subsequent rules', async () => {
      await mocker.addRule({ pattern: '*.json' });
      devtools.sendCommand.mockClear();
      await mocker.addRule({ pattern: '*.xml' });
      expect(devtools.sendCommand).not.toHaveBeenCalledWith('Fetch.enable', expect.any(Object));
    });
  });

  describe('getRules', () => {
    it('returns a copy of rules', async () => {
      await mocker.addRule({ pattern: 'a' });
      await mocker.addRule({ pattern: 'b' });
      const rules = mocker.getRules();
      expect(rules).toHaveLength(2);
      // Mutating returned array should not affect internal state
      rules.pop();
      expect(mocker.getRules()).toHaveLength(2);
    });
  });

  describe('removeRule', () => {
    it('removes rules by pattern and returns count', async () => {
      await mocker.addRule({ pattern: 'https://api.com/*' });
      await mocker.addRule({ pattern: 'https://cdn.com/*' });
      const removed = await mocker.removeRule('https://api.com/*');
      expect(removed).toBe(1);
      expect(mocker.getRules()).toHaveLength(1);
    });

    it('returns 0 when pattern not found', async () => {
      await mocker.addRule({ pattern: 'https://api.com/*' });
      const removed = await mocker.removeRule('nonexistent');
      expect(removed).toBe(0);
      expect(mocker.getRules()).toHaveLength(1);
    });

    it('disables Fetch when last rule removed', async () => {
      await mocker.addRule({ pattern: '*' });
      devtools.sendCommand.mockClear();
      await mocker.removeRule('*');
      expect(devtools.sendCommand).toHaveBeenCalledWith('Fetch.disable', {});
    });
  });

  describe('removeRuleById', () => {
    it('removes a rule by its UUID', async () => {
      const rule = await mocker.addRule({ pattern: 'https://api.com/*' });
      const removed = await mocker.removeRuleById(rule.id);
      expect(removed).toBe(1);
      expect(mocker.getRules()).toHaveLength(0);
    });

    it('returns 0 for non-existent id', async () => {
      await mocker.addRule({ pattern: '*' });
      const removed = await mocker.removeRuleById('nonexistent-uuid');
      expect(removed).toBe(0);
    });
  });

  describe('clearRules', () => {
    it('removes all rules and returns count', async () => {
      await mocker.addRule({ pattern: 'a' });
      await mocker.addRule({ pattern: 'b' });
      await mocker.addRule({ pattern: 'c' });
      const count = await mocker.clearRules();
      expect(count).toBe(3);
      expect(mocker.getRules()).toHaveLength(0);
    });

    it('returns 0 when no rules exist', async () => {
      const count = await mocker.clearRules();
      expect(count).toBe(0);
    });

    it('disables Fetch when clearing rules', async () => {
      await mocker.addRule({ pattern: '*' });
      devtools.sendCommand.mockClear();
      await mocker.clearRules();
      expect(devtools.sendCommand).toHaveBeenCalledWith('Fetch.disable', {});
    });
  });

  // ─── matchRule ───

  describe('matchRule', () => {
    it('returns first matching rule', async () => {
      await mocker.addRule({ pattern: 'https://api.com/**', status: 200 });
      await mocker.addRule({ pattern: 'https://api.com/v1/*', status: 404 });
      const match = mut.matchRule('https://api.com/v1/users') as { status: number };
      // First rule should match
      expect(match).not.toBeNull();
      expect(match.status).toBe(200);
    });

    it('returns null when no rule matches', async () => {
      await mocker.addRule({ pattern: 'https://other.com/*' });
      expect(mut.matchRule('https://api.com/data')).toBeNull();
    });
  });

  // ─── destroy ───

  describe('destroy', () => {
    it('clears rules and unsubscribes', async () => {
      await mocker.addRule({ pattern: '*' });
      mocker.destroy();
      expect(mocker.getRules()).toHaveLength(0);
      expect(devtools.unsubscribe).toHaveBeenCalledWith('NetworkMocker');
    });
  });
});
