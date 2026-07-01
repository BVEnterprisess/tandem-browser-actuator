import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvolutionEngine } from '../evolution';
import type { PageMetrics, DomainInfo } from '../types';

function createMockDb() {
  const baselines = new Map<string, { expectedValue: number; tolerance: number; sampleCount: number }>();
  const domains = new Map<string, DomainInfo>();
  const events: unknown[] = [];
  const zeroDayCandidates: unknown[] = [];

  return {
    getBaseline: vi.fn((domain: string, metric: string) => baselines.get(`${domain}:${metric}`) ?? null),
    upsertBaseline: vi.fn((domain: string, metric: string, expectedValue: number, tolerance: number, sampleCount: number) => {
      baselines.set(`${domain}:${metric}`, { expectedValue, tolerance, sampleCount });
    }),
    getDomainInfo: vi.fn((domain: string) => domains.get(domain) ?? null),
    upsertDomain: vi.fn((domain: string, updates: Partial<DomainInfo>) => {
      const existing = domains.get(domain);
      if (existing) {
        Object.assign(existing, updates);
      }
    }),
    logEvent: vi.fn((event: unknown) => events.push(event)),
    insertZeroDayCandidate: vi.fn((candidate: unknown) => zeroDayCandidates.push(candidate)),
    isWhitelistedPair: vi.fn().mockReturnValue(false),
    // Helpers for test setup
    _setBaseline: (domain: string, metric: string, expectedValue: number, tolerance: number, sampleCount: number) => {
      baselines.set(`${domain}:${metric}`, { expectedValue, tolerance, sampleCount });
    },
    _setDomain: (domain: string, info: DomainInfo) => {
      domains.set(domain, info);
    },
    _events: events,
    _zeroDayCandidates: zeroDayCandidates,
  };
}

function buildDomainInfo(domain: string, overrides: Partial<DomainInfo> = {}): DomainInfo {
  return {
    domain,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    visitCount: 10,
    trustLevel: 50,
    guardianMode: 'balanced',
    category: 'general',
    notes: null,
    ...overrides,
  };
}

describe('EvolutionEngine', () => {
  let db: ReturnType<typeof createMockDb>;
  let engine: EvolutionEngine;

  beforeEach(() => {
    db = createMockDb();
    engine = new EvolutionEngine(db as never);
  });

  // ─── updateBaseline ───

  describe('updateBaseline', () => {
    it('creates initial baseline on first observation', () => {
      const metrics: PageMetrics = { script_count: 10, form_count: 2, cookie_count: 0, external_domain_count: 3, request_count: 15, resource_size_total: 5000 };
      engine.updateBaseline('example.com', metrics);

      expect(db.upsertBaseline).toHaveBeenCalledWith('example.com', 'script_count', 10, expect.any(Number), 1);
      expect(db.upsertBaseline).toHaveBeenCalledWith('example.com', 'form_count', 2, expect.any(Number), 1);
    });

    it('initial tolerance is at least MIN_TOLERANCE (1)', () => {
      engine.updateBaseline('example.com', { script_count: 0, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });

      // For value 0, tolerance should be max(0 * 0.3, 1) = 1
      const calls = db.upsertBaseline.mock.calls.filter((c: unknown[]) => c[0] === 'example.com');
      for (const call of calls) {
        expect(call[3]).toBeGreaterThanOrEqual(1);
      }
    });

    it('updates rolling average on subsequent observations', () => {
      // Set up existing baseline with 5 samples
      db._setBaseline('example.com', 'script_count', 10, 2, 5);

      engine.updateBaseline('example.com', { script_count: 12, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });

      // Should update with sampleCount=6
      const scriptCall = db.upsertBaseline.mock.calls.find((c: unknown[]) => c[1] === 'script_count');
      expect(scriptCall).toBeDefined();
      expect(scriptCall![4]).toBe(6); // new count
      // New average should be between 10 and 12
      expect(scriptCall![2]).toBeGreaterThan(10);
      expect(scriptCall![2]).toBeLessThan(12);
    });
  });

  // ─── checkForAnomalies ───

  describe('checkForAnomalies', () => {
    it('returns empty when baseline has fewer than 5 samples', () => {
      db._setBaseline('example.com', 'script_count', 10, 2, 4); // Only 4 samples

      const anomalies = engine.checkForAnomalies('example.com', { script_count: 100, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies).toHaveLength(0);
    });

    it('returns empty when metrics are within tolerance', () => {
      db._setBaseline('example.com', 'script_count', 10, 3, 10);

      const anomalies = engine.checkForAnomalies('example.com', { script_count: 12, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies).toHaveLength(0);
    });

    it('detects anomaly when metric exceeds tolerance', () => {
      db._setBaseline('example.com', 'script_count', 10, 2, 10);

      const anomalies = engine.checkForAnomalies('example.com', { script_count: 25, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0]).toMatchObject({
        domain: 'example.com',
        metric: 'script_count',
        expected: 10,
        actual: 25,
      });
    });

    it('assigns severity based on deviation ratio', () => {
      db._setBaseline('example.com', 'script_count', 10, 2, 10);

      // Low: deviation/tolerance < 2 → deviation 3, tolerance 2 → ratio 1.5
      let anomalies = engine.checkForAnomalies('example.com', { script_count: 13, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies[0]?.severity).toBe('low');

      // Medium: ratio 2-3 → deviation 5, tolerance 2 → ratio 2.5
      anomalies = engine.checkForAnomalies('example.com', { script_count: 15, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies[0]?.severity).toBe('medium');

      // High: ratio 3-5 → deviation 8, tolerance 2 → ratio 4
      anomalies = engine.checkForAnomalies('example.com', { script_count: 18, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies[0]?.severity).toBe('high');

      // Critical: ratio >= 5 → deviation 12, tolerance 2 → ratio 6
      anomalies = engine.checkForAnomalies('example.com', { script_count: 22, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies[0]?.severity).toBe('critical');
    });

    it('reports zero-day candidate when 3+ anomalies on one page', () => {
      db._setBaseline('example.com', 'script_count', 5, 1, 10);
      db._setBaseline('example.com', 'form_count', 2, 1, 10);
      db._setBaseline('example.com', 'external_domain_count', 3, 1, 10);

      const anomalies = engine.checkForAnomalies('example.com', {
        script_count: 50,
        form_count: 20,
        external_domain_count: 30,
        cookie_count: 0,
        request_count: 0,
        resource_size_total: 0,
      });

      expect(anomalies.length).toBeGreaterThanOrEqual(3);
      expect(db.insertZeroDayCandidate).toHaveBeenCalled();
      expect(db.logEvent).toHaveBeenCalled();
    });

    it('does not report zero-day for fewer than 3 anomalies', () => {
      db._setBaseline('example.com', 'script_count', 5, 1, 10);
      db._setBaseline('example.com', 'form_count', 2, 1, 10);

      engine.checkForAnomalies('example.com', {
        script_count: 50,
        form_count: 20,
        external_domain_count: 3,
        cookie_count: 0,
        request_count: 0,
        resource_size_total: 0,
      });

      expect(db.insertZeroDayCandidate).not.toHaveBeenCalled();
    });

    it('returns no baseline domain without any baseline data', () => {
      const anomalies = engine.checkForAnomalies('new-domain.com', { script_count: 100, form_count: 0, cookie_count: 0, external_domain_count: 0, request_count: 0, resource_size_total: 0 });
      expect(anomalies).toHaveLength(0);
    });
  });

  // ─── evolveTrust ───

  describe('evolveTrust', () => {
    it('increases trust by 1 on clean visit (max 90)', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'clean_visit');

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 51 });
    });

    it('caps trust at 90 on clean visit', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 90 }));

      engine.evolveTrust('example.com', 'clean_visit');

      // Trust should not exceed 90
      expect(db.upsertDomain).not.toHaveBeenCalled(); // 90 + 1 > 90, rounded to 90, no change
    });

    it('decreases trust by 10 on anomaly', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'anomaly');

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 40 });
    });

    it('decreases trust by 15 on blocked', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'blocked');

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 35 });
    });

    it('sets trust to 0 on blocklist_hit', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 80 }));

      engine.evolveTrust('example.com', 'blocklist_hit');

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 0 });
    });

    it('never drops trust below 0', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 5 }));

      engine.evolveTrust('example.com', 'blocked');

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 0 });
    });

    it('does nothing for unknown domain', () => {
      engine.evolveTrust('nonexistent.com', 'clean_visit');
      expect(db.upsertDomain).not.toHaveBeenCalled();
    });

    it('weights trust adjustment by confidence (high confidence = full)', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'anomaly', 200); // high confidence ≤300

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 40 }); // full -10
    });

    it('weights trust adjustment by confidence (medium = 70%)', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'anomaly', 400); // medium confidence 301-600

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 43 }); // -10 * 0.7 = -7
    });

    it('weights trust adjustment by confidence (low = 40%)', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'anomaly', 700); // low confidence >600

      expect(db.upsertDomain).toHaveBeenCalledWith('example.com', { trustLevel: 46 }); // -10 * 0.4 = -4
    });

    it('logs trust evolution events', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 50 }));

      engine.evolveTrust('example.com', 'anomaly');

      expect(db.logEvent).toHaveBeenCalled();
      const eventCall = db.logEvent.mock.calls[0][0] as { domain: string; eventType: string };
      expect(eventCall.domain).toBe('example.com');
      expect(eventCall.eventType).toBe('info');
    });
  });

  // ─── reportZeroDay ───

  describe('reportZeroDay', () => {
    it('returns true for high-trust domain (≥70)', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 75 }));

      const shouldEscalate = engine.reportZeroDay('example.com', [
        { domain: 'example.com', metric: 'a', expected: 1, actual: 10, deviation: 9, tolerance: 1, severity: 'high' },
        { domain: 'example.com', metric: 'b', expected: 2, actual: 20, deviation: 18, tolerance: 2, severity: 'high' },
        { domain: 'example.com', metric: 'c', expected: 3, actual: 30, deviation: 27, tolerance: 3, severity: 'high' },
      ]);

      expect(shouldEscalate).toBe(true);
    });

    it('returns false for low-trust domain (<70)', () => {
      db._setDomain('example.com', buildDomainInfo('example.com', { trustLevel: 40 }));

      const shouldEscalate = engine.reportZeroDay('example.com', [
        { domain: 'example.com', metric: 'a', expected: 1, actual: 10, deviation: 9, tolerance: 1, severity: 'high' },
        { domain: 'example.com', metric: 'b', expected: 2, actual: 20, deviation: 18, tolerance: 2, severity: 'high' },
        { domain: 'example.com', metric: 'c', expected: 3, actual: 30, deviation: 27, tolerance: 3, severity: 'high' },
      ]);

      expect(shouldEscalate).toBe(false);
    });
  });
});
