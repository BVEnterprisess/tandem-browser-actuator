import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc-channels';
import { applyInitialTheme } from './theme';
import { createNavigationApi } from './navigation';
import { createContentApi } from './content';
import { createTabsApi } from './tabs';
import { createPanelApi } from './panel';
import { createDrawingApi } from './drawing';
import { createRecordingApi } from './recording';
import { createVoiceApi } from './voice';
import { createActivityApi } from './activity';
import { createBookmarksApi } from './bookmarks';
import { createExtensionsApi } from './extensions';
import { createWorkspacesApi } from './workspaces';
import { createWindowApi } from './window';

// Stamp the pre-paint theme on <html> before the shell document renders.
applyInitialTheme();

contextBridge.exposeInMainWorld('__TANDEM_TOKEN__', '');
contextBridge.exposeInMainWorld('__TANDEM_VERSION__', process.env.npm_package_version || '');
contextBridge.exposeInMainWorld('__TANDEM_API_BASE__', getInitialApiBaseUrl());

contextBridge.exposeInMainWorld('tandem', {
  getApiToken: () => ipcRenderer.invoke(IpcChannels.GET_API_TOKEN),
  getApiBaseUrl: () => ipcRenderer.invoke(IpcChannels.GET_API_BASE_URL),
  ...createNavigationApi(),
  ...createContentApi(),
  ...createTabsApi(),
  ...createPanelApi(),
  ...createDrawingApi(),
  ...createRecordingApi(),
  ...createVoiceApi(),
  ...createActivityApi(),
  ...createBookmarksApi(),
  ...createExtensionsApi(),
  ...createWorkspacesApi(),
  ...createWindowApi(),
});
function getInitialApiBaseUrl(): string {
  const prefix = '--tandem-api-port=';
  const arg = process.argv.find((item) => item.startsWith(prefix));
  if (!arg) {
    try {
      const baseUrl = ipcRenderer.sendSync(IpcChannels.GET_API_BASE_URL_SYNC);
      if (typeof baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
        return baseUrl;
      }
    } catch {
      // Fall through to the default port when the main process is not ready.
    }
  }
  const port = arg ? Number(arg.slice(prefix.length)) : 8765;
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port <= 65535 ? port : 8765}`;
}
