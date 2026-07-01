import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { AnalyzerManager } from '../analyzer-manager';
import type { SecurityAnalyzer, AnalyzerContext, SecurityEvent } from '../types';

function createMockContext(): AnalyzerContext {
  return {
    logEvent: vi.fn(),
    isDomainBlocked: vi.fn().mockReturnValue(false),
    getTrustScore: vi.fn().mockReturnValue(50),
    db: {
      getEventsForDomain: vi.fn().mockReturnValue([]),
    },
  };
}

function createMockAnalyzer(overrides: Partial<SecurityAnalyzer> = {}): SecurityAnalyzer {
  return {
    name: 'TestAnalyzer',
    version: '1.0.0',
    description: 'Test analyzer',
    priority: 500,
    eventTypes: ['*'],
    initialize: vi.fn().mockResolvedValue(undefined),
    canAnalyze: vi.fn().mockReturnValue(true),
    analyze: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    timestamp: Date.now(),
    domain: 'example.com',
    tabId: null,
    eventType: 'test-event',
    severity: 'medium',
    category: 'behavior',
    details: '{}',
    actionTaken: 'logged',
    ...overrides,
  };
}

describe('AnalyzerManager', () => {
  let manager: AnalyzerManager;
  let context: AnalyzerContext;

  beforeEach(() => {
    context = createMockContext();
    manager = new AnalyzerManager(context);
  });

  describe('register', () => {
    it('registers and initializes an analyzer', async () => {
      const analyzer = createMockAnalyzer();
      await manager.register(analyzer);

      expect(analyzer.initialize).toHaveBeenCalledWith(context);
      expect(manager.getStatus()).toHaveLength(1);
    });

    it('sorts analyzers by priority', async () => {
      await manager.register(createMockAnalyzer({ name: 'Low', priority: 900 }));
      await manager.register(createMockAnalyzer({ name: 'High', priority: 100 }));
      await manager.register(createMockAnalyzer({ name: 'Med', priority: 500 }));

      const status = manager.getStatus();
      expect(status[0].name).toBe('High');
      expect(status[1].name).toBe('Med');
      expect(status[2].name).toBe('Low');
    });

    it('handles initialization failure gracefully', async () => {
      const analyzer = createMockAnalyzer({
        initialize: vi.fn().mockRejectedValue(new Error('init failed')),
      });

      await manager.register(analyzer);
      // Should not crash, analyzer should not be registered
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  describe('routeEvent', () => {
    it('routes event to matching analyzer', async () => {
      const analyzer = createMockAnalyzer({ eventTypes: ['test-event'] });
      await manager.register(analyzer);

      await manager.routeEvent(buildEvent());

      expect(analyzer.analyze).toHaveBeenCalled();
    });

    it('routes event to wildcard analyzer', async () => {
      const analyzer = createMockAnalyzer({ eventTypes: ['*'] });
      await manager.register(analyzer);

      await manager.routeEvent(buildEvent({ eventType: 'any-type' }));

      expect(analyzer.analyze).toHaveBeenCalled();
    });

    it('skips analyzer when event type does not match', async () => {
      const analyzer = createMockAnalyzer({ eventTypes: ['page-loaded'] });
      await manager.register(analyzer);

      await manager.routeEvent(buildEvent({ eventType: 'other-event' }));

      expect(analyzer.analyze).not.toHaveBeenCalled();
    });

    it('skips analyzer when canAnalyze returns false', async () => {
      const analyzer = createMockAnalyzer({ canAnalyze: vi.fn().mockReturnValue(false) });
      await manager.register(analyzer);

      await manager.routeEvent(buildEvent());

      expect(analyzer.analyze).not.toHaveBeenCalled();
    });

    it('returns new events from analyzers', async () => {
      const newEvent = buildEvent({ eventType: 'cascade', domain: 'cascade.com' });
      const analyzer = createMockAnalyzer({
        analyze: vi.fn().mockResolvedValue([newEvent]),
      });
      await manager.register(analyzer);

      const results = await manager.routeEvent(buildEvent());
      expect(results).toHaveLength(1);
      expect(results[0].eventType).toBe('cascade');
    });

    it('isolates crashing analyzers (does not break pipeline)', async () => {
      const crasher = createMockAnalyzer({
        name: 'Crasher',
        priority: 100,
        analyze: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const healthy = createMockAnalyzer({
        name: 'Healthy',
        priority: 200,
        analyze: vi.fn().mockResolvedValue([]),
      });

      await manager.register(crasher);
      await manager.register(healthy);

      await manager.routeEvent(buildEvent());

      // Healthy analyzer should still run despite crasher
      expect(healthy.analyze).toHaveBeenCalled();
    });

    it('prevents re-entrant routing', async () => {
      let routeCount = 0;
      const analyzer = createMockAnalyzer({
        analyze: vi.fn().mockImplementation(async () => {
          routeCount++;
          // Try to route during routing — should be ignored
          await manager.routeEvent(buildEvent());
          return [];
        }),
      });
      await manager.register(analyzer);

      await manager.routeEvent(buildEvent());
      expect(routeCount).toBe(1); // Only called once, re-entrant call was blocked
    });
  });

  describe('destroy', () => {
    it('destroys all analyzers and clears list', async () => {
      const analyzer = createMockAnalyzer();
      await manager.register(analyzer);

      await manager.destroy();

      expect(analyzer.destroy).toHaveBeenCalled();
      expect(manager.getStatus()).toHaveLength(0);
    });

    it('handles destroy errors gracefully', async () => {
      const analyzer = createMockAnalyzer({
        destroy: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      });
      await manager.register(analyzer);

      // Should not throw
      await manager.destroy();
      expect(manager.getStatus()).toHaveLength(0);
    });
  });

  describe('getStatus', () => {
    it('returns analyzer metadata', async () => {
      await manager.register(createMockAnalyzer({
        name: 'MyAnalyzer',
        version: '2.0.0',
        priority: 300,
        eventTypes: ['page-loaded'],
        description: 'Analyzes pages',
      }));

      const status = manager.getStatus();
      expect(status[0]).toMatchObject({
        name: 'MyAnalyzer',
        version: '2.0.0',
        priority: 300,
        eventTypes: ['page-loaded'],
        description: 'Analyzes pages',
      });
    });
  });
});
