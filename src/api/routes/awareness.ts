import type { Router, Request, Response } from 'express';
import type { RouteContext } from '../context';
import { handleRouteError } from '../../utils/errors';

/**
 * Register AI awareness routes (activity digest, focus context).
 * @param router - Express router to attach routes to
 * @param ctx - shared manager registry and main BrowserWindow
 */
export function registerAwarenessRoutes(router: Router, ctx: RouteContext): void {

  // ═══ GET /awareness/digest — Smart activity digest ═══
  router.get('/awareness/digest', async (_req: Request, res: Response) => {
    try {
      const minutes = Math.min(parseInt(_req.query.minutes as string) || 5, 60);
      const since = _req.query.since
        ? parseInt(_req.query.since as string)
        : Date.now() - minutes * 60_000;
      const now = Date.now();

      // ── Gather raw data from all managers ──

      const activityEntries = ctx.activityTracker.getLog(500, since);
      const streamEvents = ctx.eventStream.getRecent(100).filter(e => e.timestamp >= since);

      // Console errors (may fail if CDP not attached — graceful)
      let consoleErrors: Array<{ level: string; text: string; url: string; timestamp: number }> = [];
      try {
        consoleErrors = ctx.devToolsManager.getConsoleErrors(50)
          .filter(e => e.timestamp >= since);
      } catch { /* CDP not attached */ }

      // Network failures
      let networkFailures: Array<{ url: string; status: number; failed: boolean; errorText?: string }> = [];
      try {
        const allNetwork = ctx.devToolsManager.getNetworkEntries({ limit: 200, failed: true });
        networkFailures = allNetwork
          .filter(e => e.request.timestamp >= since / 1000) // CDP timestamps are seconds
          .map(e => ({
            url: e.request.url,
            status: e.response?.status ?? 0,
            failed: !!e.failed,
            errorText: e.errorText,
          }));
      } catch { /* CDP not attached */ }

      // Downloads completed in window
      let completedDownloads: Array<{ filename: string; path: string }> = [];
      try {
        completedDownloads = ctx.downloadManager.list()
          .filter(d => d.status === 'completed' && d.endTime && new Date(d.endTime).getTime() >= since)
          .map(d => ({ filename: d.filename, path: d.savePath }));
      } catch { /* no downloads */ }

      // Watch changes
      let watchChanges: Array<{ url: string; id: string; lastCheck: number | null }> = [];
      try {
        watchChanges = ctx.watchManager.listWatches()
          .filter(w => w.lastCheck && w.lastCheck >= since && w.changeCount > 0)
          .map(w => ({ url: w.url, id: w.id, lastCheck: w.lastCheck }));
      } catch { /* no watches */ }

      // Current tab
      const activeTab = ctx.tabManager.getActiveTab();

      // ── Build navigation section ──

      const navEvents = activityEntries.filter(e => e.type === 'navigate');
      const siteSet = new Set<string>();
      const pages: Array<{ url: string; title: string; dwellTime: number }> = [];

      for (let i = 0; i < navEvents.length; i++) {
        const ev = navEvents[i];
        const url = (ev.data.url as string) || '';
        const title = (ev.data.title as string) || '';
        if (!url) continue;

        try { siteSet.add(new URL(url).hostname); } catch { /* invalid URL */ }

        // Dwell time = time until next navigation (or until now for last)
        const nextTs = i < navEvents.length - 1 ? navEvents[i + 1].timestamp : now;
        const dwellTime = nextTs - ev.timestamp;

        // Skip very short visits (< 1s, likely redirects)
        if (dwellTime < 1000 && i < navEvents.length - 1) continue;

        pages.push({ url, title, dwellTime });
      }

      // ── Build interactions section ──

      const clickCount = activityEntries.filter(e => e.type === 'click').length;
      const formEvents = streamEvents.filter(e => e.type === 'form-submit');
      const _inputEvents = activityEntries.filter(e => e.type === 'input');

      // Text selections from activity
      const textSelections = activityEntries
        .filter(e => e.type === 'text-selected' && e.data.text)
        .map(e => {
          const text = (e.data.text as string).slice(0, 100);
          const host = extractHost(e.data.url as string);
          return `selected '${text}' on ${host}`;
        })
        .slice(-5); // last 5

      // Search detection: input events on known search engines
      const searches = activityEntries
        .filter(e => {
          if (e.type !== 'navigate') return false;
          const url = (e.data.url as string) || '';
          return /[?&]q=/.test(url) && /google|bing|duckduckgo|search/.test(url);
        })
        .map(e => {
          try {
            const u = new URL((e.data.url as string));
            return u.searchParams.get('q') || '';
          } catch { return ''; }
        })
        .filter(Boolean)
        .slice(-5);

      // ── Build errors section ──

      // Dedup console errors by message
      const errorMap = new Map<string, { source: string; message: string; count: number }>();
      for (const err of consoleErrors) {
        const host = extractHost(err.url);
        const key = `${host}:${err.text.slice(0, 100)}`;
        const existing = errorMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          errorMap.set(key, { source: host, message: err.text, count: 1 });
        }
      }

      // Dedup network failures by URL pattern
      const netFailMap = new Map<string, { url: string; status: number; count: number }>();
      for (const nf of networkFailures) {
        const key = `${nf.url}:${nf.status}`;
        const existing = netFailMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          netFailMap.set(key, { url: nf.url, status: nf.status, count: 1 });
        }
      }

      // ── Build tabs section ──

      const tabOpened = streamEvents
        .filter(e => e.type === 'tab-opened')
        .map(e => `New tab: ${e.title || e.url || 'untitled'}`);
      const tabClosed = streamEvents
        .filter(e => e.type === 'tab-closed')
        .map(e => `Closed: ${e.title || e.url || 'untitled'}`);

      // ── Build summary string ──

      const summaryParts: string[] = [];

      // Top sites by dwell time
      const topPages = [...pages].sort((a, b) => b.dwellTime - a.dwellTime).slice(0, 3);
      for (const p of topPages) {
        const host = extractHost(p.url);
        const seconds = Math.round(p.dwellTime / 1000);
        const timeStr = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds}s`;
        const titleSnippet = p.title ? ` (${p.title.slice(0, 40)})` : '';
        const stillActive = activeTab && p.url === activeTab.url ? ', still active' : '';
        summaryParts.push(`${host}${titleSnippet}: ${timeStr}${stillActive}`);
      }

      const errorCount = Array.from(errorMap.values()).reduce((sum, e) => sum + e.count, 0);
      if (errorCount > 0) {
        const topError = Array.from(errorMap.values())[0];
        summaryParts.push(`${errorCount} console error${errorCount > 1 ? 's' : ''} on ${topError.source}`);
      }

      const netFailCount = Array.from(netFailMap.values()).reduce((sum, e) => sum + e.count, 0);
      if (netFailCount > 0) {
        summaryParts.push(`${netFailCount} network failure${netFailCount > 1 ? 's' : ''}`);
      }

      if (watchChanges.length > 0) {
        summaryParts.push(`${watchChanges.length} watched page${watchChanges.length > 1 ? 's' : ''} changed`);
      }

      if (completedDownloads.length > 0) {
        summaryParts.push(`${completedDownloads.length} download${completedDownloads.length > 1 ? 's' : ''} completed`);
      }

      // ── Assemble response ──

      res.json({
        period: { from: since, to: now },
        navigation: {
          sites_visited: Array.from(siteSet),
          pages,
          total_navigations: navEvents.length,
        },
        interactions: {
          forms_filled: formEvents.length,
          clicks: clickCount,
          text_selections: textSelections,
          searches,
        },
        errors: {
          console_errors: Array.from(errorMap.values()),
          network_failures: Array.from(netFailMap.values()),
        },
        tabs: {
          opened: tabOpened,
          closed: tabClosed,
          current: activeTab
            ? { title: activeTab.title, url: activeTab.url }
            : null,
        },
        downloads: {
          completed: completedDownloads,
        },
        watches: {
          changes_detected: watchChanges.map(w => ({
            url: w.url,
            changed_at: w.lastCheck,
          })),
        },
        summary: summaryParts.join('. ') + (summaryParts.length ? '.' : 'No notable activity in this period.'),
      });
    } catch (e) {
      handleRouteError(res, e);
    }
  });

  // ═══ GET /awareness/focus — What is the user doing RIGHT NOW? ═══
  router.get('/awareness/focus', (_req: Request, res: Response) => {
    try {
      const activeTab = ctx.tabManager.getActiveTab();
      const now = Date.now();

      // Get recent activity entries (last 60s)
      const recentActivity = ctx.activityTracker.getLog(20, now - 60_000);
      const lastEntry = recentActivity.length > 0
        ? recentActivity[recentActivity.length - 1]
        : null;

      // Determine idle time
      const lastInteractionTs = lastEntry?.timestamp ?? 0;
      const idleSeconds = Math.round((now - lastInteractionTs) / 1000);

      // Determine activity type from recent events (last 10s)
      const veryRecent = recentActivity.filter(e => e.timestamp >= now - 10_000);
      const recentTypes = new Set(veryRecent.map(e => e.type));

      let activity: 'typing' | 'reading' | 'navigating' | 'idle';
      if (idleSeconds > 30) {
        activity = 'idle';
      } else if (recentTypes.has('input')) {
        activity = 'typing';
      } else if (recentTypes.has('navigate')) {
        activity = 'navigating';
      } else {
        activity = 'reading';
      }

      // Check for errors (lightweight — just check if any exist recently)
      let hasConsoleErrors = false;
      try {
        const errors = ctx.devToolsManager.getConsoleErrors(5);
        hasConsoleErrors = errors.some(e => e.timestamp >= now - 300_000); // last 5 min
      } catch { /* CDP not attached */ }

      let hasNetworkErrors = false;
      try {
        const failures = ctx.devToolsManager.getNetworkEntries({ limit: 5, failed: true });
        hasNetworkErrors = failures.some(e => e.request.timestamp >= (now - 300_000) / 1000);
      } catch { /* CDP not attached */ }

      // Page loaded time — find the most recent page-loaded or navigate event for active tab
      const navEvents = recentActivity.filter(e =>
        e.type === 'navigate' || e.type === 'did-finish-load'
      );
      const lastNav = navEvents.length > 0 ? navEvents[navEvents.length - 1] : null;
      const pageLoadedSecondsAgo = lastNav
        ? Math.round((now - lastNav.timestamp) / 1000)
        : null;

      res.json({
        tab: activeTab
          ? { id: activeTab.id, title: activeTab.title, url: activeTab.url }
          : null,
        activity,
        idle_seconds: idleSeconds,
        last_interaction: lastEntry
          ? { type: lastEntry.type, timestamp: lastEntry.timestamp }
          : null,
        page_loaded_seconds_ago: pageLoadedSecondsAgo,
        has_console_errors: hasConsoleErrors,
        has_network_errors: hasNetworkErrors,
      });
    } catch (e) {
      handleRouteError(res, e);
    }
  });
}

/** Extract hostname from a URL, or return the raw string on failure */
function extractHost(url: string | undefined): string {
  if (!url) return 'unknown';
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}
