import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const scriptPath = path.join(process.cwd(), 'shell', 'js', 'api-base.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function loadApiBaseScript(href, preloadBase) {
  const window = {
    location: new URL(href),
  };
  if (preloadBase) {
    window.__TANDEM_API_BASE__ = preloadBase;
  }
  window.window = window;

  const context = {
    URL,
    URLSearchParams,
    window,
  };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: scriptPath });
  return window;
}

describe('shell api-base helper', () => {
  it('overwrites stale internal page ports with the runtime API port', () => {
    const window = loadApiBaseScript(
      'file:///C:/dev/tandem-browser/shell/index.html',
      'http://127.0.0.1:8765',
    );

    expect(window.__tandemInternalUrl('file:///C:/dev/tandem-browser/shell/settings.html?tandemApiPort=8766#extensions'))
      .toBe('file:///C:/dev/tandem-browser/shell/settings.html?tandemApiPort=8765#extensions');
  });

  it('uses the configured custom runtime API port for internal pages', () => {
    const window = loadApiBaseScript(
      'file:///C:/dev/tandem-browser/shell/index.html',
      'http://127.0.0.1:9876',
    );

    expect(window.__tandemInternalUrl('file:///C:/dev/tandem-browser/shell/newtab.html'))
      .toBe('file:///C:/dev/tandem-browser/shell/newtab.html?tandemApiPort=9876');
  });

  it('does not modify external pages', () => {
    const window = loadApiBaseScript(
      'file:///C:/dev/tandem-browser/shell/index.html',
      'http://127.0.0.1:9876',
    );

    expect(window.__tandemInternalUrl('https://example.com/?tandemApiPort=8765'))
      .toBe('https://example.com/?tandemApiPort=8765');
  });
});
