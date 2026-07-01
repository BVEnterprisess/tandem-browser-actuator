import type { Router, Request, Response } from 'express';
import type { RouteContext } from '../context';
import { resolveRequestedTab } from '../context';
import type { Tab } from '../../tabs/manager';
import { handleRouteError } from '../../utils/errors';
import { DEFAULT_TIMEOUT_MS } from '../../utils/constants';

/** Maximum allowed expression length for evaluation endpoints (1 MB) */
const MAX_CODE_LENGTH = 1_048_576;

interface EffectiveTabTarget {
  requestedTabId: string | null;
  tab: Tab | null;
  source: 'header' | 'body' | 'query' | 'session' | 'active';
}

function sendRequestedTabNotFound(res: Response, tabId: string): void {
  res.status(404).json({ error: `Tab ${tabId} not found` });
}

function resolveEffectiveTabTarget(
  ctx: RouteContext,
  req: Request,
  opts?: { allowBody?: boolean; allowQuery?: boolean },
): EffectiveTabTarget {
  const requestedTab = resolveRequestedTab(ctx, req, opts);
  if (requestedTab.requestedTabId) {
    return {
      requestedTabId: requestedTab.requestedTabId,
      tab: requestedTab.tab,
      source: requestedTab.source ?? 'header',
    };
  }

  return {
    requestedTabId: null,
    tab: ctx.tabManager.getActiveTab(),
    source: 'active',
  };
}

function buildTabScope(target: EffectiveTabTarget): {
  kind: 'tab';
  tabId: string | null;
  wcId: number | null;
  source: EffectiveTabTarget['source'];
} {
  return {
    kind: 'tab',
    tabId: target.tab?.id ?? target.requestedTabId ?? null,
    wcId: target.tab?.webContentsId ?? null,
    source: target.source,
  };
}

/**
 * Register DevTools CDP bridge routes (console, DOM, evaluate, storage, performance).
 * @param router - Express router to attach routes to
 * @param ctx - shared manager registry and main BrowserWindow
 */
export function registerDevtoolsRoutes(router: Router, ctx: RouteContext): void {
  // ═══════════════════════════════════════════════
  // DEVTOOLS — CDP Bridge for Wingman
  // ═══════════════════════════════════════════════

  /** DevTools status */
  router.get('/devtools/status', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }

      const managerStatus = ctx.devToolsManager.getStatus();
      const scopedStatus = target.tab
        ? ctx.devToolsManager.getStatus({ tabId: target.tab.id, wcId: target.tab.webContentsId })
        : {
            attached: false,
            tabId: null,
            wcId: null,
            console: { entries: 0, errors: 0, lastId: 0 },
            network: { entries: 0 },
          };
      res.json({
        ...scopedStatus,
        scope: buildTabScope(target),
        managerPrimary: {
          attached: managerStatus.attached,
          tabId: managerStatus.tabId,
          wcId: managerStatus.wcId,
        },
      });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Console log entries */
  router.get('/devtools/console', (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const level = req.query.level as string | undefined;
      const sinceId = req.query.since_id ? parseInt(req.query.since_id as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const search = req.query.search as string | undefined;
      const tabId = target.tab?.id;
      const entries = tabId
        ? ctx.devToolsManager.getConsoleEntries({ level, sinceId, limit, search, tabId })
        : [];
      const counts = tabId
        ? ctx.devToolsManager.getConsoleCounts(tabId)
        : { log: 0, info: 0, warn: 0, error: 0, debug: 0 };
      res.json({ scope: buildTabScope(target), entries, counts, total: entries.length });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Console errors only (convenience) */
  router.get('/devtools/console/errors', (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const errors = target.tab
        ? ctx.devToolsManager.getConsoleErrors(limit, target.tab.id)
        : [];
      res.json({ scope: buildTabScope(target), errors, total: errors.length });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Clear console log buffer */
  router.post('/devtools/console/clear', (req: Request, res: Response) => {
    const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
    if (target.requestedTabId && !target.tab) {
      sendRequestedTabNotFound(res, target.requestedTabId);
      return;
    }
    if (!target.tab) {
      res.status(404).json({ error: 'No active tab' });
      return;
    }
    ctx.devToolsManager.clearConsole(target.tab.id);
    res.json({ ok: true, scope: buildTabScope(target) });
  });

  /** Network entries (CDP-level, with headers and POST bodies) */
  router.get('/devtools/network', (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const domain = req.query.domain as string | undefined;
      const type = req.query.type as string | undefined;
      const failed = req.query.failed === 'true' ? true : req.query.failed === 'false' ? false : undefined;
      const search = req.query.search as string | undefined;
      const statusMin = req.query.status_min ? parseInt(req.query.status_min as string) : undefined;
      const statusMax = req.query.status_max ? parseInt(req.query.status_max as string) : undefined;
      const entries = target.tab
        ? ctx.devToolsManager.getNetworkEntries({
            limit,
            domain,
            type,
            failed,
            search,
            statusMin,
            statusMax,
            tabId: target.tab.id,
            wcId: target.tab.webContentsId,
          })
        : [];
      res.json({ scope: buildTabScope(target), entries, total: entries.length });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Get response body for a specific network request */
  router.get('/devtools/network/:requestId/body', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const body = await ctx.devToolsManager.getResponseBody(req.params.requestId as string, {
        tabId: target.tab.id,
        wcId: target.tab.webContentsId,
      });
      if (!body) {
        res.status(404).json({ error: 'Response body not available (evicted or streamed)' });
        return;
      }
      res.json({ ...body, requestId: req.params.requestId, scope: buildTabScope(target) });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Clear network log */
  router.post('/devtools/network/clear', (req: Request, res: Response) => {
    const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
    if (target.requestedTabId && !target.tab) {
      sendRequestedTabNotFound(res, target.requestedTabId);
      return;
    }
    if (!target.tab) {
      res.status(404).json({ error: 'No active tab' });
      return;
    }
    ctx.devToolsManager.clearNetwork(target.tab.id);
    res.json({ ok: true, scope: buildTabScope(target) });
  });

  /** Query DOM by CSS selector */
  router.post('/devtools/dom/query', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const { selector, maxResults = 10 } = req.body;
      if (!selector) { res.status(400).json({ error: 'selector required' }); return; }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const nodes = await ctx.devToolsManager.queryDOM(selector, maxResults, target.tab.webContentsId);
      res.json({ scope: buildTabScope(target), nodes, total: nodes.length });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Query DOM by XPath */
  router.post('/devtools/dom/xpath', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const { expression, maxResults = 10 } = req.body;
      if (!expression) { res.status(400).json({ error: 'expression required' }); return; }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const nodes = await ctx.devToolsManager.queryXPath(expression, maxResults, target.tab.webContentsId);
      res.json({ scope: buildTabScope(target), nodes, total: nodes.length });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Get storage (cookies, localStorage, sessionStorage) */
  router.get('/devtools/storage', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const data = await ctx.devToolsManager.getStorage(target.tab.webContentsId);
      res.json({ ...data, scope: buildTabScope(target) });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Get performance metrics */
  router.get('/devtools/performance', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const metrics = await ctx.devToolsManager.getPerformanceMetrics(target.tab.webContentsId);
      if (!metrics) {
        res.status(503).json({ error: 'No targeted tab or CDP not attached' });
        return;
      }
      res.json({ ...metrics, scope: buildTabScope(target) });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Evaluate JavaScript via CDP Runtime */
  router.post('/devtools/evaluate', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      let { expression } = req.body;
      const { returnByValue = true, awaitPromise = true } = req.body;
      if (!expression) { res.status(400).json({ error: 'expression required' }); return; }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      if (expression.length > MAX_CODE_LENGTH) {
        res.status(413).json({ error: 'Expression too large (max 1MB)' });
        return;
      }

      // Auto-wrap navigation to prevent evaluate() from blocking during page transitions.
      // When window.location is assigned, the current context is destroyed before the
      // evaluate call can return, causing timeouts and "not responding" dialogs.
      // Wrapping in setTimeout(0) allows evaluate to return immediately while navigation
      // happens asynchronously in the background.
      if (/window\.location(\.href)?\s*=/.test(expression)) {
        expression = `setTimeout(() => { ${expression} }, 0); "navigating"`;
      }

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Execution timed out')), DEFAULT_TIMEOUT_MS)
      );
      const result = await Promise.race([
        ctx.devToolsManager.evaluateInTab(target.tab.webContentsId, expression, { returnByValue, awaitPromise }),
        timeout,
      ]);
      res.json({ ok: true, result, scope: buildTabScope(target) });
    } catch (e) {
      if (e instanceof Error && e.message === 'Execution timed out') {
        res.status(408).json({ error: `Execution timed out after ${DEFAULT_TIMEOUT_MS / 1000}s` });
        return;
      }
      handleRouteError(res, e);
    }
  });

  /** Raw CDP command (advanced — send any CDP method) */
  router.post('/devtools/cdp', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const { method, params } = req.body;
      if (!method) { res.status(400).json({ error: 'method required' }); return; }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const result = await ctx.devToolsManager.sendCommandToTab(target.tab.webContentsId, method, params);
      res.json({ ok: true, result, scope: buildTabScope(target) });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Screenshot a specific element by CSS selector */
  router.post('/devtools/screenshot/element', async (req: Request, res: Response) => {
    try {
      const target = resolveEffectiveTabTarget(ctx, req, { allowBody: true, allowQuery: true });
      if (target.requestedTabId && !target.tab) {
        sendRequestedTabNotFound(res, target.requestedTabId);
        return;
      }
      const { selector } = req.body;
      if (!selector) { res.status(400).json({ error: 'selector required' }); return; }
      if (!target.tab) {
        res.status(404).json({ error: 'No active tab' });
        return;
      }
      const png = await ctx.devToolsManager.screenshotElement(selector, target.tab.webContentsId);
      if (!png) {
        res.status(404).json({ error: 'Element not found or screenshot failed' });
        return;
      }
      res.set('Content-Type', 'image/png');
      res.send(png);
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  /** Toggle DevTools window for active tab (for debugging).
   *  NOTE: After closing DevTools, CDP connection is lost.
   *  The next API call to any /devtools/* endpoint will re-attach automatically. */
  /** Open/close shell (chrome) DevTools — for debugging the browser shell itself */
  router.post('/devtools/shell', (_req: Request, res: Response) => {
    try {
      const wc = ctx.win.webContents;
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools();
        res.json({ ok: true, open: false });
      } else {
        wc.openDevTools({ mode: 'detach' });
        res.json({ ok: true, open: true });
      }
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  router.post('/devtools/toggle', async (_req: Request, res: Response) => {
    try {
      const wc = await ctx.tabManager.getActiveWebContents();
      if (wc) {
        if (wc.isDevToolsOpened()) {
          wc.closeDevTools();
        } else {
          wc.openDevTools({ mode: 'detach' });
        }
        res.json({ ok: true, open: wc.isDevToolsOpened() });
      } else {
        res.status(404).json({ error: 'No active tab' });
      }
    } catch (e) {
      handleRouteError(res, e);
    }
  });
}
