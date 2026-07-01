(() => {
  if (typeof window.fetch !== 'function') {
    return;
  }

  let cachedToken = window.__TANDEM_TOKEN__ || '';
  let tokenPromise = null;
  let cachedApiBaseUrl = window.__TANDEM_API_BASE__ || window.__tandemApiBaseFromLocation?.() || 'http://127.0.0.1:8765';

  function normalizeApiBaseUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return 'http://127.0.0.1:8765';
    }
    return value.trim().replace(/\/+$/, '');
  }

  function getApiBaseUrl() {
    return normalizeApiBaseUrl(cachedApiBaseUrl);
  }

  function apiUrl(path) {
    return `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  }

  window.tandemApi = {
    baseUrl: getApiBaseUrl,
    url: apiUrl,
  };

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loadTokenWithRetry() {
    if (cachedToken) {
      return cachedToken;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const token = await window.tandem?.getApiToken?.();
        if (typeof token === 'string' && token.trim()) {
          cachedToken = token.trim();
          window.__TANDEM_TOKEN__ = cachedToken;
          return cachedToken;
        }
      } catch {
        // IPC handler may not be ready during the earliest startup phase.
      }

      await sleep(100);
    }

    return '';
  }

  async function getToken() {
    if (cachedToken) {
      return cachedToken;
    }

    if (!tokenPromise) {
      tokenPromise = loadTokenWithRetry().finally(() => {
        tokenPromise = null;
      });
    }

    return tokenPromise;
  }

  function rewriteLegacyApiUrl(input) {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url;

    if (!rawUrl) {
      return input;
    }

    try {
      const url = new URL(rawUrl, window.location.href);
      if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === '8765') {
        const rewritten = `${getApiBaseUrl()}${url.pathname}${url.search}${url.hash}`;
        return input instanceof Request ? new Request(rewritten, input) : rewritten;
      }
    } catch {
      return input;
    }
    return input;
  }

  function isLocalTandemApiUrl(input) {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url;

    if (!rawUrl) {
      return false;
    }

    try {
      const url = new URL(rawUrl, window.location.href);
      const apiUrl = new URL(getApiBaseUrl());
      return (url.hostname === apiUrl.hostname || url.hostname === 'localhost') && url.port === apiUrl.port;
    } catch {
      return false;
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    input = rewriteLegacyApiUrl(input);
    if (!isLocalTandemApiUrl(input)) {
      return originalFetch(input, init);
    }

    const token = await getToken();
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const auth = headers.get('Authorization')?.trim();

    if (token && (!auth || /^Bearer$/i.test(auth))) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (input instanceof Request) {
      return originalFetch(new Request(input, { ...init, headers }));
    }

    return originalFetch(input, { ...init, headers });
  };
})();
