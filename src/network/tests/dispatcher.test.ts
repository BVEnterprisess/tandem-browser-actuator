import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { RequestDispatcher } from '../dispatcher';

function createMockSession() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    webRequest: {
      onBeforeRequest: vi.fn((fn: (...args: unknown[]) => void) => { handlers['onBeforeRequest'] = fn; }),
      onBeforeSendHeaders: vi.fn((fn: (...args: unknown[]) => void) => { handlers['onBeforeSendHeaders'] = fn; }),
      onHeadersReceived: vi.fn((fn: (...args: unknown[]) => void) => { handlers['onHeadersReceived'] = fn; }),
      onBeforeRedirect: vi.fn((fn: (...args: unknown[]) => void) => { handlers['onBeforeRedirect'] = fn; }),
      onCompleted: vi.fn((fn: (...args: unknown[]) => void) => { handlers['onCompleted'] = fn; }),
      onErrorOccurred: vi.fn((fn: (...args: unknown[]) => void) => { handlers['onErrorOccurred'] = fn; }),
    },
    _handlers: handlers,
  };
}

describe('RequestDispatcher', () => {
  let session: ReturnType<typeof createMockSession>;
  let dispatcher: RequestDispatcher;

  beforeEach(() => {
    session = createMockSession();
    dispatcher = new RequestDispatcher(session as never);
  });

  // ─── Consumer registration ───

  describe('registerBeforeRequest', () => {
    it('accepts consumers before attach', () => {
      dispatcher.registerBeforeRequest({
        name: 'TestConsumer',
        priority: 10,
        handler: () => null,
      });
      const status = dispatcher.getStatus() as {
        consumers: { onBeforeRequest: Array<{ name: string; priority: number }> };
      };
      expect(status.consumers.onBeforeRequest).toHaveLength(1);
      expect(status.consumers.onBeforeRequest[0].name).toBe('TestConsumer');
    });
  });

  describe('registerBeforeSendHeaders', () => {
    it('tracks registered consumer', () => {
      dispatcher.registerBeforeSendHeaders({
        name: 'HeaderConsumer',
        priority: 5,
        handler: (_details, headers) => headers,
      });
      const status = dispatcher.getStatus() as {
        consumers: { onBeforeSendHeaders: Array<{ name: string }> };
      };
      expect(status.consumers.onBeforeSendHeaders).toHaveLength(1);
    });
  });

  describe('registerCompleted', () => {
    it('tracks completed consumer', () => {
      dispatcher.registerCompleted({ name: 'CompletedConsumer', handler: () => {} });
      const status = dispatcher.getStatus() as {
        consumers: { onCompleted: string[] };
      };
      expect(status.consumers.onCompleted).toContain('CompletedConsumer');
    });
  });

  describe('registerError', () => {
    it('tracks error consumer', () => {
      dispatcher.registerError({ name: 'ErrorConsumer', handler: () => {} });
      const status = dispatcher.getStatus() as {
        consumers: { onError: string[] };
      };
      expect(status.consumers.onError).toContain('ErrorConsumer');
    });
  });

  // ─── attach ───

  describe('attach', () => {
    it('registers all handlers on session.webRequest', () => {
      dispatcher.attach();
      expect(session.webRequest.onBeforeRequest).toHaveBeenCalled();
      expect(session.webRequest.onBeforeSendHeaders).toHaveBeenCalled();
      expect(session.webRequest.onHeadersReceived).toHaveBeenCalled();
      expect(session.webRequest.onBeforeRedirect).toHaveBeenCalled();
      expect(session.webRequest.onCompleted).toHaveBeenCalled();
      expect(session.webRequest.onErrorOccurred).toHaveBeenCalled();
    });
  });

  // ─── onBeforeRequest handler chain ───

  describe('onBeforeRequest handler chain', () => {
    it('allows request when no consumer cancels', async () => {
      dispatcher.registerBeforeRequest({
        name: 'Passthrough',
        priority: 10,
        handler: () => null,
      });
      dispatcher.attach();

      const callback = vi.fn();
      const handler = session._handlers['onBeforeRequest'];
      await handler({ url: 'https://example.com', id: '1' }, callback);

      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledWith({ cancel: false });
    });

    it('cancels request when a consumer returns cancel:true', async () => {
      dispatcher.registerBeforeRequest({
        name: 'Blocker',
        priority: 10,
        handler: () => ({ cancel: true }),
      });
      dispatcher.attach();

      const callback = vi.fn();
      const handler = session._handlers['onBeforeRequest'];
      await handler({ url: 'https://malware.com', id: '1' }, callback);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledWith({ cancel: true });
    });

    it('executes consumers in priority order (lower first)', async () => {
      const order: string[] = [];

      dispatcher.registerBeforeRequest({
        name: 'Second',
        priority: 20,
        handler: () => { order.push('second'); return null; },
      });
      dispatcher.registerBeforeRequest({
        name: 'First',
        priority: 10,
        handler: () => { order.push('first'); return null; },
      });
      dispatcher.attach();

      const callback = vi.fn();
      const handler = session._handlers['onBeforeRequest'];
      await handler({ url: 'https://example.com', id: '1' }, callback);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(order).toEqual(['first', 'second']);
    });

    it('isolates consumer errors (does not break chain)', async () => {
      dispatcher.registerBeforeRequest({
        name: 'Thrower',
        priority: 10,
        handler: () => { throw new Error('boom'); },
      });
      dispatcher.registerBeforeRequest({
        name: 'Passthrough',
        priority: 20,
        handler: () => null,
      });
      dispatcher.attach();

      const callback = vi.fn();
      const handler = session._handlers['onBeforeRequest'];
      await handler({ url: 'https://example.com', id: '1' }, callback);

      await new Promise(resolve => setTimeout(resolve, 10));
      // Request should still go through despite first consumer throwing
      expect(callback).toHaveBeenCalledWith({ cancel: false });
    });
  });

  // ─── onBeforeSendHeaders handler chain ───

  describe('onBeforeSendHeaders handler chain', () => {
    it('passes headers through consumers in priority order', () => {
      dispatcher.registerBeforeSendHeaders({
        name: 'AddHeader',
        priority: 10,
        handler: (_details, headers) => ({ ...headers, 'X-Custom': 'value' }),
      });
      dispatcher.attach();

      const callback = vi.fn();
      const handler = session._handlers['onBeforeSendHeaders'];
      handler({ requestHeaders: { Accept: '*/*' } }, callback);

      expect(callback).toHaveBeenCalledWith({
        requestHeaders: expect.objectContaining({ 'X-Custom': 'value', Accept: '*/*' }),
      });
    });
  });

  // ─── onCompleted handler ───

  describe('onCompleted handler', () => {
    it('calls all completed consumers', () => {
      const spy = vi.fn();
      dispatcher.registerCompleted({ name: 'Spy', handler: spy });
      dispatcher.attach();

      const handler = session._handlers['onCompleted'];
      const details = { id: '1', url: 'https://example.com', statusCode: 200 };
      handler(details);

      expect(spy).toHaveBeenCalledWith(details);
    });
  });

  // ─── onErrorOccurred handler ───

  describe('onErrorOccurred handler', () => {
    it('calls all error consumers', () => {
      const spy = vi.fn();
      dispatcher.registerError({ name: 'ErrorSpy', handler: spy });
      dispatcher.attach();

      const handler = session._handlers['onErrorOccurred'];
      const details = { id: '1', url: 'https://example.com', error: 'net::ERR_FAILED' };
      handler(details);

      expect(spy).toHaveBeenCalledWith(details);
    });
  });

  // ─── getStatus ───

  describe('getStatus', () => {
    it('includes all consumer types in status', () => {
      dispatcher.registerBeforeRequest({ name: 'BR', priority: 1, handler: () => null });
      dispatcher.registerBeforeSendHeaders({ name: 'BSH', priority: 1, handler: (_d, h) => h });
      dispatcher.registerHeadersReceived({ name: 'HR', priority: 1, handler: (_d, h) => h });
      dispatcher.registerBeforeRedirect({ name: 'BRD', handler: () => {} });
      dispatcher.registerCompleted({ name: 'C', handler: () => {} });
      dispatcher.registerError({ name: 'E', handler: () => {} });

      const status = dispatcher.getStatus() as {
        consumers: {
          onBeforeRequest: unknown[];
          onBeforeSendHeaders: unknown[];
          onHeadersReceived: unknown[];
          onBeforeRedirect: string[];
          onCompleted: string[];
          onError: string[];
        };
      };

      expect(status.consumers.onBeforeRequest).toHaveLength(1);
      expect(status.consumers.onBeforeSendHeaders).toHaveLength(1);
      expect(status.consumers.onHeadersReceived).toHaveLength(1);
      expect(status.consumers.onBeforeRedirect).toEqual(['BRD']);
      expect(status.consumers.onCompleted).toEqual(['C']);
      expect(status.consumers.onError).toEqual(['E']);
    });
  });
});
