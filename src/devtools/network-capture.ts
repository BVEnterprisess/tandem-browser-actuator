import type { WebContents } from 'electron';
import type {
  CDPNetworkEntry, CDPNetworkRequest,
  CDPRequestWillBeSentParams, CDPResponseReceivedParams,
  CDPLoadingFinishedParams, CDPLoadingFailedParams,
} from './types';

const MAX_NETWORK_ENTRIES = 300;
const MAX_RESPONSE_BODY_SIZE = 1_000_000; // 1MB

/**
 * NetworkCapture — Buffers network requests/responses from CDP Network domain.
 *
 * Maintains a ring buffer of the last 300 entries with request/response
 * metadata, and supports on-demand response body fetching.
 *
 * IMPORTANT: This class does NOT own the debugger attachment.
 * DevToolsManager handles attach/detach lifecycle.
 * NetworkCapture only processes events routed to it by the manager.
 */
export class NetworkCapture {
  private networkEntries: Map<string, CDPNetworkEntry> = new Map();
  private networkOrder: string[] = []; // insertion order for ring buffer
  private ensureAttached: () => Promise<WebContents | null>;
  private ensureAttachedToTab?: (wcId: number) => Promise<WebContents | null>;

  constructor(
    ensureAttached: () => Promise<WebContents | null>,
    ensureAttachedToTab?: (wcId: number) => Promise<WebContents | null>,
  ) {
    this.ensureAttached = ensureAttached;
    this.ensureAttachedToTab = ensureAttachedToTab;
  }

  /**
   * Handle a CDP network event. Called by DevToolsManager's message router.
   * Returns true if this capture handled the event.
   */
  handleEvent(method: string, params: Record<string, unknown>, tabId?: string, wcId?: number): boolean {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.onNetworkRequest(params as unknown as CDPRequestWillBeSentParams, tabId, wcId);
        return true;
      case 'Network.responseReceived':
        this.onNetworkResponse(params as unknown as CDPResponseReceivedParams, wcId);
        return true;
      case 'Network.loadingFinished':
        this.onNetworkLoadingFinished(params as unknown as CDPLoadingFinishedParams, wcId);
        return true;
      case 'Network.loadingFailed':
        this.onNetworkFailed(params as unknown as CDPLoadingFailedParams, wcId);
        return true;
      default:
        return false;
    }
  }

  private buildRequestKey(requestId: string, wcId?: number): string {
    return `${wcId ?? 'active'}:${requestId}`;
  }

  private removeEntry(requestKey: string): void {
    this.networkEntries.delete(requestKey);
    this.networkOrder = this.networkOrder.filter(key => key !== requestKey);
  }

  private resolveEntries(requestId: string, opts?: { tabId?: string; wcId?: number }): CDPNetworkEntry[] {
    let entries = Array.from(this.networkEntries.values()).filter(entry => entry.request.id === requestId);
    if (opts?.wcId !== undefined) {
      entries = entries.filter(entry => entry.request.wcId === opts.wcId);
    }
    if (opts?.tabId) {
      entries = entries.filter(entry => entry.request.tabId === opts.tabId);
    }
    return entries;
  }

  private onNetworkRequest(params: CDPRequestWillBeSentParams, tabId?: string, wcId?: number): void {
    const req: CDPNetworkRequest = {
      id: params.requestId,
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers || {},
      postData: params.request.postData,
      resourceType: params.type || 'Other',
      timestamp: Date.now(),
      tabId,
      wcId,
    };

    const requestKey = this.buildRequestKey(params.requestId, wcId);
    this.networkEntries.set(requestKey, { request: req });
    this.networkOrder.push(requestKey);

    // Ring buffer
    while (this.networkOrder.length > MAX_NETWORK_ENTRIES) {
      const oldId = this.networkOrder.shift()!;
      this.networkEntries.delete(oldId);
    }
  }

  private onNetworkResponse(params: CDPResponseReceivedParams, wcId?: number): void {
    const entry = this.networkEntries.get(this.buildRequestKey(params.requestId, wcId));
    if (!entry) return;

    entry.response = {
      requestId: params.requestId,
      url: params.response.url,
      status: params.response.status,
      statusText: params.response.statusText || '',
      headers: params.response.headers || {},
      mimeType: params.response.mimeType || '',
      size: params.response.encodedDataLength || 0,
      timestamp: Date.now(),
    };

    if (entry.request) {
      entry.duration = entry.response.timestamp - entry.request.timestamp;
    }
  }

  private onNetworkLoadingFinished(params: CDPLoadingFinishedParams, wcId?: number): void {
    const entry = this.networkEntries.get(this.buildRequestKey(params.requestId, wcId));
    if (entry?.response) {
      entry.response.size = params.encodedDataLength || entry.response.size;
    }
  }

  private onNetworkFailed(params: CDPLoadingFailedParams, wcId?: number): void {
    const entry = this.networkEntries.get(this.buildRequestKey(params.requestId, wcId));
    if (entry) {
      entry.failed = true;
      entry.errorText = params.errorText || 'Unknown error';
    }
  }

  /** Get network entries, optionally filtered */
  getEntries(opts?: {
    limit?: number;
    domain?: string;
    type?: string;
    statusMin?: number;
    statusMax?: number;
    failed?: boolean;
    search?: string;
    tabId?: string;
    wcId?: number;
  }): CDPNetworkEntry[] {
    let entries = Array.from(this.networkEntries.values());

    if (opts?.wcId !== undefined) {
      entries = entries.filter(e => e.request.wcId === opts.wcId);
    }
    if (opts?.tabId) {
      entries = entries.filter(e => e.request.tabId === opts.tabId);
    }

    if (opts?.domain) {
      const d = opts.domain.toLowerCase();
      entries = entries.filter(e => {
        try { return new URL(e.request.url).hostname.includes(d); } catch { return false; }
      });
    }
    if (opts?.type) {
      const t = opts.type.toLowerCase();
      entries = entries.filter(e => e.request.resourceType.toLowerCase() === t);
    }
    if (opts?.statusMin) {
      entries = entries.filter(e => e.response && e.response.status >= opts.statusMin!);
    }
    if (opts?.statusMax) {
      entries = entries.filter(e => e.response && e.response.status <= opts.statusMax!);
    }
    if (opts?.failed !== undefined) {
      entries = entries.filter(e => !!e.failed === opts.failed);
    }
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      entries = entries.filter(e => e.request.url.toLowerCase().includes(q));
    }

    const limit = opts?.limit ?? 100;
    return entries.slice(-limit);
  }

  /** Get response body for a specific request (fetches from CDP on demand) */
  async getResponseBody(
    requestId: string,
    opts?: { tabId?: string; wcId?: number },
  ): Promise<{ body: string; base64Encoded: boolean } | null> {
    const matches = this.resolveEntries(requestId, opts);
    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1 && !opts?.tabId && opts?.wcId === undefined) {
      return null;
    }

    const targetEntry = matches[matches.length - 1];
    const wc = targetEntry.request.wcId !== undefined && this.ensureAttachedToTab
      ? await this.ensureAttachedToTab(targetEntry.request.wcId)
      : await this.ensureAttached();
    if (!wc) return null;

    try {
      const result = await wc.debugger.sendCommand('Network.getResponseBody', { requestId });
      // Truncate large bodies
      if (result.body && result.body.length > MAX_RESPONSE_BODY_SIZE) {
        return {
          body: result.body.substring(0, MAX_RESPONSE_BODY_SIZE),
          base64Encoded: result.base64Encoded,
        };
      }
      return result;
    } catch {
      // Body may not be available (streamed, evicted from buffer)
      return null;
    }
  }

  clear(tabId?: string): void {
    if (tabId) {
      for (const [requestKey, entry] of Array.from(this.networkEntries.entries())) {
        if (entry.request.tabId === tabId) {
          this.removeEntry(requestKey);
        }
      }
      return;
    }
    this.networkEntries.clear();
    this.networkOrder = [];
  }

  get entryCount(): number {
    return this.networkEntries.size;
  }

  getEntryCount(opts?: { tabId?: string; wcId?: number }): number {
    return this.getEntries({ ...opts, limit: Number.MAX_SAFE_INTEGER }).length;
  }
}
