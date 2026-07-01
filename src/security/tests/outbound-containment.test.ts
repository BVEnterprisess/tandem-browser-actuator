import { describe, expect, it } from 'vitest';
import { OutboundGuard } from '../outbound-guard';
import type { DomainInfo } from '../types';

function buildDomainInfo(overrides: Partial<DomainInfo>): DomainInfo {
  return {
    domain: 'example.com',
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    visitCount: 1,
    trustLevel: 30,
    guardianMode: 'balanced',
    category: 'general',
    notes: null,
    ...overrides,
  };
}

function createGuard(...domains: DomainInfo[]) {
  const byDomain = new Map(domains.map((domain) => [domain.domain, domain]));
  const db = {
    getDomainInfo: (domain: string) => byDomain.get(domain) ?? null,
    isWhitelistedPair: () => false,
  };

  return new OutboundGuard(db as never);
}

describe('OutboundGuard mutating request containment', () => {
  it('escalates strict first-visit cross-origin mutations to fail-closed gatekeeper review', () => {
    const guard = createGuard(
      buildDomainInfo({
        domain: 'fresh.example',
        trustLevel: 18,
        visitCount: 0,
      }),
    );

    const decision = guard.analyzeOutbound({
      url: 'https://fresh.example/api/submit',
      method: 'POST',
      referrer: 'https://origin.example/form',
      uploadData: [{ bytes: Buffer.from('hello=world') }],
    } as never, 'strict');

    expect(decision).toMatchObject({
      action: 'flag',
      reason: 'first-visit-mutating-destination',
      severity: 'high',
      gatekeeperDecisionClass: 'deny_on_timeout',
    });
    expect(decision.explanation).toContain('fresh.example');
  });

  it('holds balanced trusted-to-untrusted transitions for gatekeeper review', () => {
    const guard = createGuard(
      buildDomainInfo({
        domain: 'dashboard.example',
        trustLevel: 82,
        visitCount: 12,
      }),
      buildDomainInfo({
        domain: 'collector.example',
        trustLevel: 20,
        visitCount: 2,
      }),
    );

    const decision = guard.analyzeOutbound({
      url: 'https://collector.example/ingest',
      method: 'PATCH',
      referrer: 'https://dashboard.example/app',
      uploadData: [{ bytes: Buffer.from('status=ok') }],
    } as never, 'balanced');

    expect(decision).toMatchObject({
      action: 'flag',
      reason: 'cross-origin-trusted-to-untrusted',
      severity: 'medium',
      gatekeeperDecisionClass: 'hold_for_decision',
    });
    expect(decision.context).toMatchObject({
      originDomain: 'dashboard.example',
      destinationDomain: 'collector.example',
      originTrust: 82,
      destinationTrust: 20,
    });
  });

  it('allows same-site cross-subdomain mutations to avoid noisy balanced-mode false positives', () => {
    const guard = createGuard(
      buildDomainInfo({
        domain: 'github.com',
        trustLevel: 90,
        visitCount: 50,
      }),
      buildDomainInfo({
        domain: 'api.github.com',
        trustLevel: 30,
        visitCount: 2,
      }),
    );

    const decision = guard.analyzeOutbound({
      url: 'https://api.github.com/_private/browser/stats',
      method: 'POST',
      referrer: 'https://github.com/',
      uploadData: [{ bytes: Buffer.from('ping=1') }],
    } as never, 'balanced');

    expect(decision).toMatchObject({
      action: 'allow',
      reason: 'same-site-cross-origin',
      severity: 'info',
    });
  });
});

describe('OutboundGuard additional HTTP containment', () => {
  it('allows same-origin POST', () => {
    const guard = createGuard(
      buildDomainInfo({ domain: 'example.com', trustLevel: 50, visitCount: 5 }),
    );

    const decision = guard.analyzeOutbound({
      url: 'https://example.com/api/submit',
      method: 'POST',
      referrer: 'https://example.com/form',
      uploadData: [{ bytes: Buffer.from('data=test') }],
    } as never, 'balanced');

    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('same-origin');
  });

  it('blocks cross-origin credential submission', () => {
    const guard = createGuard(
      buildDomainInfo({ domain: 'bank.com', trustLevel: 80, visitCount: 20 }),
      buildDomainInfo({ domain: 'evil.com', trustLevel: 10, visitCount: 0 }),
    );

    const decision = guard.analyzeOutbound({
      url: 'https://evil.com/collect',
      method: 'POST',
      referrer: 'https://bank.com/login',
      uploadData: [{ bytes: Buffer.from('password=secret123&user=admin') }],
    } as never, 'balanced');

    expect(decision.action).toBe('block');
    expect(decision.reason).toBe('cross-origin-credentials');
    expect(decision.severity).toBe('critical');
  });

  it('allows requests to known Google API domains', () => {
    const guard = createGuard();

    const decision = guard.analyzeOutbound({
      url: 'https://speech.googleapis.com/v1/speech:recognize',
      method: 'POST',
      referrer: 'https://myapp.com/page',
      uploadData: [{ bytes: Buffer.from('audio_data') }],
    } as never, 'strict');

    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('known-google-api');
  });

  it('allows request with invalid URL gracefully', () => {
    const guard = createGuard();

    const decision = guard.analyzeOutbound({
      url: 'not-a-url',
      method: 'POST',
    } as never, 'balanced');

    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('invalid-url');
  });

  it('tracks stats correctly', () => {
    const guard = createGuard(
      buildDomainInfo({ domain: 'example.com', trustLevel: 50, visitCount: 5 }),
    );

    guard.analyzeOutbound({
      url: 'https://example.com/api',
      method: 'POST',
      referrer: 'https://example.com/',
      uploadData: [],
    } as never, 'balanced');

    const stats = guard.getStats();
    expect(stats.totalChecked).toBe(1);
    expect(stats.allowed).toBe(1);
  });
});

describe('OutboundGuard WebSocket containment', () => {
  it('holds balanced unknown websocket endpoints without a referrer', () => {
    const guard = createGuard(
      buildDomainInfo({
        domain: 'socket.example',
        trustLevel: 22,
        visitCount: 1,
      }),
    );

    const decision = guard.analyzeWebSocket('wss://socket.example/live', undefined, 'balanced');

    expect(decision).toMatchObject({
      action: 'flag',
      reason: 'unknown-ws-no-referrer',
      severity: 'medium',
      gatekeeperDecisionClass: 'hold_for_decision',
    });
  });

  it('keeps permissive unknown websocket endpoints usable while still flagging them', () => {
    const guard = createGuard(
      buildDomainInfo({
        domain: 'socket.example',
        trustLevel: 22,
        visitCount: 1,
      }),
    );

    const decision = guard.analyzeWebSocket('wss://socket.example/live', 'https://app.example', 'permissive');

    expect(decision).toMatchObject({
      action: 'flag',
      reason: 'unknown-ws-endpoint',
      severity: 'medium',
      gatekeeperDecisionClass: undefined,
    });
  });

  it('allows same-origin WebSocket connections', () => {
    const guard = createGuard(
      buildDomainInfo({ domain: 'app.example', trustLevel: 60, visitCount: 10 }),
    );

    const decision = guard.analyzeWebSocket('wss://app.example/ws', 'https://app.example/', 'balanced');
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('same-origin-ws');
  });

  it('allows localhost WebSocket connections (internal)', () => {
    const guard = createGuard();

    const decision = guard.analyzeWebSocket('ws://localhost:3000/ws', undefined, 'strict');
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('internal-ws');
  });

  it('allows 127.0.0.1 WebSocket connections (internal)', () => {
    const guard = createGuard();

    const decision = guard.analyzeWebSocket('ws://127.0.0.1:8080/ws', undefined, 'strict');
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('internal-ws');
  });

  it('allows invalid WebSocket URL gracefully', () => {
    const guard = createGuard();

    const decision = guard.analyzeWebSocket('not-a-url', undefined, 'balanced');
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('invalid-ws-url');
  });

  it('flags trusted-to-untrusted WebSocket with deny_on_timeout in strict mode', () => {
    const guard = createGuard(
      buildDomainInfo({ domain: 'trusted.com', trustLevel: 70, visitCount: 20 }),
      buildDomainInfo({ domain: 'untrusted.com', trustLevel: 20, visitCount: 2 }),
    );

    const decision = guard.analyzeWebSocket('wss://untrusted.com/ws', 'https://trusted.com/', 'strict');
    expect(decision.action).toBe('flag');
    expect(decision.reason).toBe('trusted-to-untrusted-websocket');
    expect(decision.severity).toBe('high');
    expect(decision.gatekeeperDecisionClass).toBe('deny_on_timeout');
  });

  it('allows same-site WebSocket connections', () => {
    const guard = createGuard(
      buildDomainInfo({ domain: 'app.example.com', trustLevel: 60, visitCount: 10 }),
      buildDomainInfo({ domain: 'ws.example.com', trustLevel: 30, visitCount: 1 }),
    );

    const decision = guard.analyzeWebSocket('wss://ws.example.com/live', 'https://app.example.com/', 'balanced');
    expect(decision.action).toBe('allow');
    expect(decision.reason).toBe('same-site-ws');
  });
});
