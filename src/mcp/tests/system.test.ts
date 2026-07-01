import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api-client.js', () => ({
  apiCall: vi.fn(),
  tabHeaders: vi.fn(),
  logActivity: vi.fn(),
}));

import { apiCall } from '../api-client.js';
import { registerSystemTools } from '../tools/system.js';
import { createMockServer, getHandler } from './mcp-test-helper.js';

const mockApiCall = vi.mocked(apiCall);

describe('MCP system tools', () => {
  const { server, tools } = createMockServer();
  registerSystemTools(server);

  beforeEach(() => { vi.clearAllMocks(); });

  it('tandem_pick_folder opens folder picker', async () => {
    mockApiCall.mockResolvedValueOnce({ path: '/Users/robin/Desktop' });
    await getHandler(tools, 'tandem_pick_folder')({});
    expect(mockApiCall).toHaveBeenCalledWith('POST', '/dialog/pick-folder');
  });

  it('tandem_injection_override sets override', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true });
    await getHandler(tools, 'tandem_injection_override')({ domain: 'example.com' });
    expect(mockApiCall).toHaveBeenCalledWith('POST', '/security/injection-override', { domain: 'example.com' });
  });

  it('tandem_google_photos_status returns status', async () => {
    mockApiCall.mockResolvedValueOnce({ connected: false });
    await getHandler(tools, 'tandem_google_photos_status')({});
    expect(mockApiCall).toHaveBeenCalledWith('GET', '/integrations/google-photos/status');
  });

  it('tandem_google_photos_connect initiates OAuth', async () => {
    mockApiCall.mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/...' });
    await getHandler(tools, 'tandem_google_photos_connect')({});
    expect(mockApiCall).toHaveBeenCalledWith('POST', '/integrations/google-photos/connect', expect.any(Object));
  });

  it('tandem_google_photos_disconnect disconnects', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true });
    await getHandler(tools, 'tandem_google_photos_disconnect')({});
    expect(mockApiCall).toHaveBeenCalledWith('POST', '/integrations/google-photos/disconnect');
  });

  it('tandem_google_photos_config updates config', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true });
    await getHandler(tools, 'tandem_google_photos_config')({ clientId: 'abc' });
    expect(mockApiCall).toHaveBeenCalledWith('POST', '/integrations/google-photos/config', { clientId: 'abc' });
  });
});
