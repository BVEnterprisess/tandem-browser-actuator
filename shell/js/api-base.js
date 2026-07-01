(() => {
  const DEFAULT_API_BASE = 'http://127.0.0.1:8765';

  function parsePort(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : null;
  }

  function normalizeLoopbackBase(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'http:') return null;
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
      const port = parsePort(url.port);
      return port ? `http://127.0.0.1:${port}` : null;
    } catch {
      return null;
    }
  }

  function searchParamsFromHash() {
    const hash = window.location.hash || '';
    const queryStart = hash.indexOf('?');
    return queryStart >= 0 ? new URLSearchParams(hash.slice(queryStart + 1)) : new URLSearchParams();
  }

  function apiBaseFromLocation() {
    const search = new URLSearchParams(window.location.search || '');
    const hash = searchParamsFromHash();
    const port = parsePort(search.get('tandemApiPort') || search.get('apiPort') || hash.get('tandemApiPort') || hash.get('apiPort'));
    if (port) return `http://127.0.0.1:${port}`;
    return normalizeLoopbackBase(search.get('tandemApiBase') || hash.get('tandemApiBase'));
  }

  function currentApiBase() {
    return normalizeLoopbackBase(window.__TANDEM_API_BASE__)
      || normalizeLoopbackBase(window.tandemApi?.baseUrl?.())
      || apiBaseFromLocation()
      || DEFAULT_API_BASE;
  }

  function currentApiPort() {
    try {
      return new URL(currentApiBase()).port || '8765';
    } catch {
      return '8765';
    }
  }

  function isInternalShellPage(url) {
    const normalized = url.pathname.replace(/\\/g, '/');
    return /\/shell\/(newtab|settings|bookmarks|about|help|history)\.html$/i.test(normalized);
  }

  function internalUrl(input, fragment) {
    if (typeof input !== 'string' || !input) return input;
    try {
      const url = new URL(input, window.location.href);
      if (url.protocol === 'file:' && isInternalShellPage(url)) {
        url.searchParams.set('tandemApiPort', currentApiPort());
      }
      if (fragment && !url.hash) {
        url.hash = fragment.startsWith('#') ? fragment : `#${fragment}`;
      }
      return url.toString();
    } catch {
      return input;
    }
  }

  window.__TANDEM_API_BASE__ = currentApiBase();
  window.__tandemApiBaseFromLocation = apiBaseFromLocation;
  window.__tandemInternalUrl = internalUrl;
})();
