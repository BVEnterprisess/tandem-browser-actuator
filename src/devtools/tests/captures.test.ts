import { describe, expect, it, vi } from 'vitest';
import { ConsoleCapture } from '../console-capture';
import { NetworkCapture } from '../network-capture';

describe('DevTools captures', () => {
  it('filters console entries by tabId', () => {
    const capture = new ConsoleCapture();

    capture.handleEvent('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'alpha' }],
      executionContextId: 1,
      timestamp: 1,
    }, 'tab-1');
    capture.handleEvent('Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ type: 'string', value: 'beta' }],
      executionContextId: 1,
      timestamp: 2,
    }, 'tab-2');

    expect(capture.getEntries({ tabId: 'tab-1' })).toEqual([
      expect.objectContaining({ text: 'alpha', tabId: 'tab-1' }),
    ]);
    expect(capture.getErrors(50, 'tab-2')).toEqual([
      expect.objectContaining({ text: 'beta', tabId: 'tab-2' }),
    ]);
    expect(capture.getCounts('tab-1')).toEqual({ log: 1, info: 0, warn: 0, error: 0, debug: 0 });

    capture.clear('tab-1');

    expect(capture.getEntries({ tabId: 'tab-1' })).toEqual([]);
    expect(capture.getEntries({ tabId: 'tab-2' })).toHaveLength(1);
  });

  it('keeps duplicate requestIds separate across tabs and resolves response bodies by tab', async () => {
    const sendCommandOne = vi.fn().mockResolvedValue({ body: 'one', base64Encoded: false });
    const sendCommandTwo = vi.fn().mockResolvedValue({ body: 'two', base64Encoded: false });
    const wcOne = { debugger: { sendCommand: sendCommandOne } };
    const wcTwo = { debugger: { sendCommand: sendCommandTwo } };
    const capture = new NetworkCapture(
      async () => wcOne as never,
      async (wcId) => (wcId === 101 ? wcOne : wcTwo) as never,
    );

    capture.handleEvent('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://one.example/api', method: 'GET', headers: {} },
      type: 'XHR',
      timestamp: 1,
    }, 'tab-1', 101);
    capture.handleEvent('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://two.example/api', method: 'GET', headers: {} },
      type: 'XHR',
      timestamp: 2,
    }, 'tab-2', 202);
    capture.handleEvent('Network.responseReceived', {
      requestId: 'req-1',
      response: { url: 'https://one.example/api', status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json' },
      timestamp: 3,
    }, undefined, 101);
    capture.handleEvent('Network.responseReceived', {
      requestId: 'req-1',
      response: { url: 'https://two.example/api', status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json' },
      timestamp: 4,
    }, undefined, 202);

    expect(capture.getEntries({ tabId: 'tab-1' })).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ url: 'https://one.example/api', tabId: 'tab-1', wcId: 101 }) }),
    ]);
    expect(capture.getEntries({ tabId: 'tab-2' })).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ url: 'https://two.example/api', tabId: 'tab-2', wcId: 202 }) }),
    ]);

    await expect(capture.getResponseBody('req-1', { tabId: 'tab-2', wcId: 202 })).resolves.toEqual({
      body: 'two',
      base64Encoded: false,
    });
    expect(sendCommandOne).not.toHaveBeenCalled();
    expect(sendCommandTwo).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'req-1' });
  });
});
