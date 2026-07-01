import { describe, expect, it, beforeEach } from 'vitest';
import { NetworkInspector, type NetworkRequest } from '../inspector';

function createRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 1,
    url: 'https://api.example.com/v1/users?id=42',
    method: 'GET',
    status: 200,
    contentType: 'application/json',
    size: 128,
    timestamp: Date.parse('2026-03-08T12:00:00.000Z'),
    initiator: 'https://example.com/app',
    domain: 'api.example.com',
    durationMs: 84,
    requestHeaders: { Accept: 'application/json' },
    responseHeaders: { 'content-type': ['application/json'], 'cache-control': ['no-cache'] },
    ...overrides,
  };
}

type MutableInspector = {
  requests: NetworkRequest[];
  domainStats: Map<string, { domain: string; requests: number; apis: string[]; lastSeen: number }>;
  addRequest: (req: NetworkRequest) => void;
  isApiEndpoint: (req: NetworkRequest) => boolean;
  extractApiPath: (url: string) => string;
  extractDomain: (url: string) => string;
  rebuildDomainStats: () => void;
};

describe('NetworkInspector', () => {
  let inspector: NetworkInspector;
  let mut: MutableInspector;

  beforeEach(() => {
    inspector = new NetworkInspector();
    mut = inspector as unknown as MutableInspector;
  });

  // ─── HAR export ───

  it('exports recent requests as HAR', () => {
    mut.requests = [createRequest()];

    const har = inspector.toHar();

    expect(har.log.version).toBe('1.2');
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0]).toMatchObject({
      startedDateTime: '2026-03-08T12:00:00.000Z',
      time: 84,
      request: {
        method: 'GET',
        url: 'https://api.example.com/v1/users?id=42',
        queryString: [{ name: 'id', value: '42' }],
      },
      response: {
        status: 200,
        statusText: 'OK',
        content: { size: 128, mimeType: 'application/json' },
      },
    });
    expect(har.log.entries[0].request.headers).toContainEqual({
      name: 'Accept',
      value: 'application/json',
    });
    expect(har.log.entries[0].response.headers).toContainEqual({
      name: 'content-type',
      value: 'application/json',
    });
  });

  it('HAR page title includes domain when domain filter is provided', () => {
    mut.requests = [createRequest()];
    const har = inspector.toHar({ limit: 100, domain: 'api.example.com' });
    expect(har.log.pages[0].title).toContain('api.example.com');
  });

  it('HAR page title includes tab scope label when tabId is provided', () => {
    mut.requests = [createRequest({ tabId: 'tab-1' })];
    const har = inspector.toHar({ tabId: 'tab-1' });
    expect(har.log.pages[0].title).toContain('tab tab-1');
  });

  it('HAR page title includes webContents scope when only wcId is provided', () => {
    mut.requests = [createRequest({ wcId: 42 })];
    const har = inspector.toHar({ wcId: 42 });
    expect(har.log.pages[0].title).toContain('webContents 42');
  });

  it('HAR page title says active tab when no scope is provided', () => {
    const har = inspector.toHar();
    expect(har.log.pages[0].title).toContain('active tab');
  });

  it('HAR export with empty requests returns empty entries', () => {
    const har = inspector.toHar();
    expect(har.log.entries).toHaveLength(0);
  });

  it('HAR response uses correct statusText for various codes', () => {
    mut.requests = [
      createRequest({ status: 404 }),
      createRequest({ id: 2, status: 500 }),
    ];
    const har = inspector.toHar();
    expect(har.log.entries[0].response.statusText).toBe('Not Found');
    expect(har.log.entries[1].response.statusText).toBe('Internal Server Error');
  });

  it('HAR uses application/octet-stream for missing contentType', () => {
    mut.requests = [createRequest({ contentType: '' })];
    const har = inspector.toHar();
    expect(har.log.entries[0].response.content.mimeType).toBe('application/octet-stream');
  });

  // ─── getLog ───

  it('getLog returns all requests up to limit', () => {
    mut.requests = Array.from({ length: 5 }, (_, i) =>
      createRequest({ id: i + 1, domain: 'example.com' }),
    );
    expect(inspector.getLog({ limit: 3 })).toHaveLength(3);
    expect(inspector.getLog()).toHaveLength(5);
  });

  it('getLog filters by domain', () => {
    mut.requests = [
      createRequest({ id: 1, domain: 'a.com' }),
      createRequest({ id: 2, domain: 'b.com' }),
      createRequest({ id: 3, domain: 'a.com' }),
    ];
    const filtered = inspector.getLog({ limit: 100, domain: 'a.com' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every(r => r.domain === 'a.com')).toBe(true);
  });

  it('getLog returns empty for non-existent domain', () => {
    mut.requests = [createRequest({ domain: 'a.com' })];
    expect(inspector.getLog({ limit: 100, domain: 'nonexistent.com' })).toHaveLength(0);
  });

  it('getLog filters by tabId and resource type', () => {
    mut.requests = [
      createRequest({ id: 1, domain: 'a.com', tabId: 'tab-1', resourceType: 'xhr' }),
      createRequest({ id: 2, domain: 'a.com', tabId: 'tab-2', resourceType: 'xhr' }),
      createRequest({ id: 3, domain: 'a.com', tabId: 'tab-1', resourceType: 'script' }),
    ];

    const filtered = inspector.getLog({ limit: 100, tabId: 'tab-1', type: 'xhr' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it('getLog filters by wcId', () => {
    mut.requests = [
      createRequest({ id: 1, domain: 'a.com', wcId: 101 }),
      createRequest({ id: 2, domain: 'a.com', wcId: 202 }),
      createRequest({ id: 3, domain: 'b.com', wcId: 101 }),
    ];

    const filtered = inspector.getLog({ limit: 100, wcId: 101 });

    expect(filtered).toHaveLength(2);
    expect(filtered.every(r => r.wcId === 101)).toBe(true);
  });

  // ─── getDomains ───

  it('getDomains returns domain stats sorted by request count', () => {
    mut.requests = [
      createRequest({ id: 1, domain: 'a.com', url: 'https://a.com/app' }),
      createRequest({ id: 2, domain: 'b.com', url: 'https://b.com/api/v1' }),
      createRequest({ id: 3, domain: 'b.com', url: 'https://b.com/api/v2' }),
      createRequest({ id: 4, domain: 'c.com', url: 'https://c.com/app' }),
      createRequest({ id: 5, domain: 'b.com', url: 'https://b.com/api/v3' }),
    ];

    const domains = inspector.getDomains();
    expect(domains).toHaveLength(3);
    expect(domains[0].domain).toBe('b.com');
    expect(domains[0].requests).toBe(3);
    expect(domains[0].apiCount).toBe(3);
    expect(domains[2].domain).toBe('c.com');
  });

  it('getDomains returns empty array when no domains tracked', () => {
    expect(inspector.getDomains()).toEqual([]);
  });

  // ─── getApis ───

  it('getApis returns only domains with discovered endpoints', () => {
    mut.requests = [
      createRequest({ domain: 'api.com', url: 'https://api.com/v1/users' }),
      createRequest({ id: 2, domain: 'api.com', url: 'https://api.com/v1/items' }),
      createRequest({ id: 3, domain: 'cdn.com', url: 'https://cdn.com/style.css', contentType: 'text/css' }),
    ];

    const apis = inspector.getApis();
    expect(Object.keys(apis)).toEqual(['api.com']);
    expect(apis['api.com']).toEqual(['/v1/users', '/v1/items']);
  });

  it('getApis and getDomains scope summaries by tabId', () => {
    mut.requests = [
      createRequest({ id: 1, domain: 'api.com', tabId: 'tab-1', url: 'https://api.com/v1/users' }),
      createRequest({ id: 2, domain: 'api.com', tabId: 'tab-2', url: 'https://api.com/v1/admin' }),
      createRequest({ id: 3, domain: 'cdn.com', tabId: 'tab-2', url: 'https://cdn.com/app.js', contentType: 'application/javascript' }),
    ];

    expect(inspector.getApis({ tabId: 'tab-1' })).toEqual({ 'api.com': ['/v1/users'] });
    expect(inspector.getDomains({ tabId: 'tab-2' })).toEqual([
      { domain: 'api.com', requests: 1, lastSeen: mut.requests[1].timestamp, apiCount: 1 },
      { domain: 'cdn.com', requests: 1, lastSeen: mut.requests[2].timestamp, apiCount: 0 },
    ]);
  });

  // ─── clear ───

  it('clear resets all internal state', () => {
    mut.requests = [createRequest()];
    mut.domainStats.set('a.com', { domain: 'a.com', requests: 1, apis: [], lastSeen: 1 });

    inspector.clear();

    expect(inspector.getLog()).toHaveLength(0);
    expect(inspector.getDomains()).toHaveLength(0);
    expect(inspector.getApis()).toEqual({});
  });

  it('clear removes only the targeted tab when tabId is provided', () => {
    mut.requests = [
      createRequest({ id: 1, tabId: 'tab-1', domain: 'a.com', url: 'https://a.com/v1/users' }),
      createRequest({ id: 2, tabId: 'tab-2', domain: 'b.com', url: 'https://b.com/v1/users' }),
    ];
    mut.rebuildDomainStats();

    inspector.clear('tab-1');

    expect(inspector.getLog()).toEqual([
      expect.objectContaining({ id: 2, tabId: 'tab-2' }),
    ]);
    expect(inspector.getDomains()).toEqual([
      expect.objectContaining({ domain: 'b.com', requests: 1 }),
    ]);
  });

  // ─── setTabIdResolver ───

  it('setTabIdResolver stores a resolver that can be invoked', () => {
    const resolver = (wcId: number) => wcId === 99 ? 'tab-99' : null;
    inspector.setTabIdResolver(resolver);
    // Verify the resolver is stored by accessing internal state
    const internal = inspector as unknown as { tabIdResolver?: (wcId: number) => string | null };
    expect(internal.tabIdResolver).toBe(resolver);
    expect(internal.tabIdResolver!(99)).toBe('tab-99');
    expect(internal.tabIdResolver!(1)).toBeNull();
  });

  // ─── addRequest & sliding window ───

  it('addRequest maintains max 1000 requests', () => {
    for (let i = 0; i < 1050; i++) {
      mut.addRequest(createRequest({ id: i, url: `https://example.com/${i}`, domain: 'example.com' }));
    }
    expect(mut.requests.length).toBeLessThanOrEqual(1000);
  });

  it('addRequest auto-discovers API endpoints', () => {
    mut.addRequest(createRequest({ url: 'https://api.com/v1/users', domain: 'api.com', contentType: 'application/json' }));
    const apis = inspector.getApis();
    expect(apis['api.com']).toBeDefined();
  });

  it('addRequest does not duplicate API paths', () => {
    mut.addRequest(createRequest({ id: 1, url: 'https://api.com/v1/users', domain: 'api.com', contentType: 'application/json' }));
    mut.addRequest(createRequest({ id: 2, url: 'https://api.com/v1/users', domain: 'api.com', contentType: 'application/json' }));
    expect(inspector.getApis()['api.com']).toHaveLength(1);
  });

  // ─── API endpoint detection ───

  it('isApiEndpoint detects JSON content type', () => {
    expect(mut.isApiEndpoint(createRequest({ contentType: 'application/json' }))).toBe(true);
  });

  it('isApiEndpoint detects /api/ path', () => {
    expect(mut.isApiEndpoint(createRequest({ url: 'https://example.com/api/data', contentType: 'text/html' }))).toBe(true);
  });

  it('isApiEndpoint detects /graphql path', () => {
    expect(mut.isApiEndpoint(createRequest({ url: 'https://example.com/graphql', contentType: 'text/html' }))).toBe(true);
  });

  it('isApiEndpoint detects /rest/ path', () => {
    expect(mut.isApiEndpoint(createRequest({ url: 'https://example.com/rest/items', contentType: 'text/html' }))).toBe(true);
  });

  it('isApiEndpoint returns false for static assets', () => {
    expect(mut.isApiEndpoint(createRequest({ url: 'https://cdn.com/style.css', contentType: 'text/css' }))).toBe(false);
  });

  it('isApiEndpoint detects XML content on non-.xml URLs', () => {
    expect(mut.isApiEndpoint(createRequest({ url: 'https://api.com/data', contentType: 'application/xml' }))).toBe(true);
  });

  it('isApiEndpoint returns false for .xml file URL with XML content', () => {
    expect(mut.isApiEndpoint(createRequest({ url: 'https://cdn.com/sitemap.xml', contentType: 'application/xml' }))).toBe(false);
  });

  // ─── API path normalization ───

  it('extractApiPath normalizes UUIDs to {uuid}', () => {
    const path = mut.extractApiPath('https://api.com/users/550e8400-e29b-41d4-a716-446655440000/profile');
    expect(path).toBe('/users/{uuid}/profile');
  });

  it('extractApiPath normalizes numeric IDs to {id}', () => {
    const path = mut.extractApiPath('https://api.com/users/42/posts/123');
    expect(path).toBe('/users/{id}/posts/{id}');
  });

  it('extractApiPath returns empty string for invalid URL', () => {
    expect(mut.extractApiPath('not-a-url')).toBe('');
  });

  // ─── Domain extraction ───

  it('extractDomain extracts hostname', () => {
    expect(mut.extractDomain('https://www.example.com/path')).toBe('www.example.com');
  });

  it('extractDomain returns empty for invalid URL', () => {
    expect(mut.extractDomain('not-a-url')).toBe('');
  });
});
