import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../utils/security', () => ({
  hostnameMatches: (url: URL, hostname: string) => url.hostname === hostname || url.hostname.endsWith('.' + hostname),
  isSearchEngineResultsUrl: (url: string) => /google\.com\/search|bing\.com\/search|duckduckgo\.com\/\?q=/.test(url),
  pathnameMatchesPrefix: (url: URL, prefix: string) => url.pathname.startsWith(prefix),
  tryParseUrl: (url: string) => { try { return new URL(url); } catch { return null; } },
}));

import { ContentExtractor } from '../extractor';

function createMockWebview(url: string, title: string) {
  return {
    webContents: {
      getURL: vi.fn().mockReturnValue(url),
      getTitle: vi.fn().mockReturnValue(title),
      executeJavaScript: vi.fn(),
    },
  } as unknown as BrowserWindow;
}

describe('ContentExtractor', () => {
  let extractor: ContentExtractor;

  beforeEach(() => {
    extractor = new ContentExtractor();
  });

  describe('detectPageType (via extractCurrentPage)', () => {
    it('detects LinkedIn profile pages', async () => {
      const webview = createMockWebview('https://linkedin.com/in/johndoe', 'John Doe | LinkedIn');
      vi.mocked(webview.webContents.executeJavaScript).mockResolvedValue({
        name: 'John Doe',
        headline: 'Engineer',
        location: 'Belgium',
        summary: 'Test summary',
      });
      // First call is getPageHTML
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>profile experience</body></html>')
        .mockResolvedValue({ name: 'John Doe', headline: 'Engineer', location: null, summary: null });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('profile');
      expect(result.url).toBe('https://linkedin.com/in/johndoe');
    });

    it('detects product pages via Amazon URL', async () => {
      const webview = createMockWebview('https://amazon.com/dp/B09V3KXJPB', 'Widget Pro');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>product</body></html>')
        .mockResolvedValue({ name: 'Widget Pro', price: '$29.99', description: 'A widget', images: [], reviewsSummary: null });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('product');
    });

    it('detects search results pages', async () => {
      const webview = createMockWebview('https://google.com/search?q=test', 'test - Google Search');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>search results</body></html>')
        .mockResolvedValue({ query: 'test', results: [] });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('search');
    });

    it('detects article pages via <article> tag', async () => {
      const webview = createMockWebview('https://blog.example.com/post', 'Blog Post');
      const html = '<html><body><article><h1>Title</h1><p>Content</p></article></body></html>';
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce(html)
        .mockResolvedValueOnce({ title: 'Title', author: 'Author', date: '2024-01-01', bodyText: 'Content', images: [], summary: 'Summary' })
        .mockResolvedValue('<p>Content</p>');

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('article');
    });

    it('detects article pages via /blog path', async () => {
      const webview = createMockWebview('https://example.com/blog/my-post', 'My Post');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body><p>text</p></body></html>')
        .mockResolvedValueOnce({ title: 'My Post', author: null, date: null, bodyText: 'text', images: [], summary: null })
        .mockResolvedValue('<p>text</p>');

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('article');
    });

    it('falls back to generic for unknown page types', async () => {
      const webview = createMockWebview('https://example.com/', 'Example');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>hello</body></html>')
        .mockResolvedValue({ title: 'Example', description: null, text: 'hello', images: [], links: [] });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('generic');
    });
  });

  describe('extractCurrentPage()', () => {
    it('returns structured PageContent with metadata', async () => {
      const webview = createMockWebview('https://example.com/', 'Example Site');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>hello</body></html>')
        .mockResolvedValue({ title: 'Example Site', description: 'A site', text: 'hello', images: [], links: [] });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.url).toBe('https://example.com/');
      expect(result.title).toBe('Example Site');
      expect(result.extractedAt).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('extractFromURL()', () => {
    it('opens headless window, extracts, and closes', async () => {
      const mockHeadlessWindow = createMockWebview('https://remote.com/', 'Remote');
      vi.mocked(mockHeadlessWindow.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>remote page</body></html>')
        .mockResolvedValue({ title: 'Remote', description: null, text: 'remote page', images: [], links: [] });

      const mockHeadlessManager = {
        openHeadless: vi.fn().mockResolvedValue(mockHeadlessWindow),
      };
      (mockHeadlessWindow as any).isDestroyed = vi.fn().mockReturnValue(false);
      (mockHeadlessWindow as any).close = vi.fn();

      const result = await extractor.extractFromURL('https://remote.com/', mockHeadlessManager);
      expect(result.url).toBe('https://remote.com/');
      expect((mockHeadlessWindow as any).close).toHaveBeenCalled();
    });

    it('closes headless window even on error', async () => {
      const mockHeadlessWindow = createMockWebview('https://fail.com/', 'Fail');
      vi.mocked(mockHeadlessWindow.webContents.executeJavaScript).mockRejectedValue(new Error('JS failed'));

      const mockHeadlessManager = {
        openHeadless: vi.fn().mockResolvedValue(mockHeadlessWindow),
      };
      (mockHeadlessWindow as any).isDestroyed = vi.fn().mockReturnValue(false);
      (mockHeadlessWindow as any).close = vi.fn();

      await expect(extractor.extractFromURL('https://fail.com/', mockHeadlessManager)).rejects.toThrow();
      expect((mockHeadlessWindow as any).close).toHaveBeenCalled();
    });
  });

  describe('page type detection edge cases', () => {
    it('detects product page via "add to cart" text', async () => {
      const webview = createMockWebview('https://shop.example.com/item', 'Item');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>add to cart</body></html>')
        .mockResolvedValue({ name: 'Item', price: '$10', description: 'Desc', images: [] });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('product');
    });

    it('detects profile page via /profile path', async () => {
      const webview = createMockWebview('https://example.com/profile/user123', 'User Profile');
      vi.mocked(webview.webContents.executeJavaScript)
        .mockResolvedValueOnce('<html><body>name experience</body></html>')
        .mockResolvedValue({ name: 'User', headline: null, location: null, summary: null });

      const result = await extractor.extractCurrentPage(webview);
      expect(result.type).toBe('profile');
    });
  });
});
