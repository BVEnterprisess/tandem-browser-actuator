import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../security/secret-store';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { GooglePhotosManager } from '../google-photos';
import { tandemDir } from '../../utils/paths';

const configPath = tandemDir('google-photos.json');
const authPath = tandemDir('google-photos-auth.json');
const secretRecordPath = tandemDir('secret-store', 'google-photos-auth.json');

function createMemorySecretStore(initialValue: string | null = null): SecretStore {
  let stored = initialValue;
  return {
    get: vi.fn(() => stored),
    set: vi.fn((_key: string, value: string) => {
      stored = value;
      return { encoding: 'safe-storage' as const, path: secretRecordPath };
    }),
    delete: vi.fn(() => {
      stored = null;
    }),
    getRecordPath: vi.fn(() => secretRecordPath),
  } as unknown as SecretStore;
}

describe('GooglePhotosManager', () => {
  const configManager = {
    getConfig: vi.fn().mockReturnValue({
      screenshots: {
        googlePhotos: true,
      },
    }),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    globalThis.fetch = vi.fn() as any;
  });

  it('stores a client id and reports status', () => {
    const secretStore = createMemorySecretStore();
    const manager = new GooglePhotosManager(configManager, secretStore);
    const status = manager.setClientId('desktop-client-id.apps.googleusercontent.com');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      configPath,
      expect.stringContaining('desktop-client-id.apps.googleusercontent.com'),
      { mode: 0o600 },
    );
    expect(status.clientIdConfigured).toBe(true);
    expect(status.connected).toBe(false);
  });

  it('builds an auth url with PKCE for desktop OAuth', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === configPath);
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (filePath === configPath) {
        return JSON.stringify({ clientId: 'desktop-client-id.apps.googleusercontent.com' }) as any;
      }
      return '' as any;
    });

    const manager = new GooglePhotosManager(configManager, createMemorySecretStore());
    const authUrl = manager.beginAuth();
    const url = new URL(authUrl);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('desktop-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/photoslibrary.appendonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toContain('/google-photos/oauth/callback');
  });

  it('uploads a screenshot after refreshing auth state', async () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === configPath || filePath === authPath);
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (filePath === configPath) {
        return JSON.stringify({ clientId: 'desktop-client-id.apps.googleusercontent.com' }) as any;
      }
      if (filePath === authPath) {
        return JSON.stringify({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 120_000,
          scope: 'https://www.googleapis.com/auth/photoslibrary.appendonly',
          tokenType: 'Bearer',
          updatedAt: '2026-03-08T00:00:00.000Z',
        }) as any;
      }
      if (filePath === '/tmp/test.png') {
        return Buffer.from('png-binary') as any;
      }
      return '' as any;
    });

    vi.mocked(globalThis.fetch as any)
      .mockResolvedValueOnce(new Response('upload-token', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        newMediaItemResults: [
          {
            mediaItem: {
              id: 'media-1',
              productUrl: 'https://photos.google.com/lr/photo/abc',
            },
          },
        ],
      }), { status: 200 }));

    const secretStore = createMemorySecretStore();
    const manager = new GooglePhotosManager(configManager, secretStore);
    const result = await manager.uploadScreenshot('/tmp/test.png');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, 'https://photoslibrary.googleapis.com/v1/uploads', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer access-token',
        'X-Goog-Upload-File-Name': 'test.png',
      }),
      body: Buffer.from('png-binary'),
    }));
    expect(result).toEqual({
      mediaItemId: 'media-1',
      productUrl: 'https://photos.google.com/lr/photo/abc',
    });
    expect(secretStore.set).toHaveBeenLastCalledWith(
      'google-photos-auth',
      expect.stringContaining('"lastUploadAt"'),
    );
  });

  it('migrates legacy Google Photos auth into the encrypted secret store', () => {
    vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === authPath);
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (filePath === authPath) {
        return JSON.stringify({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 120_000,
          scope: 'https://www.googleapis.com/auth/photoslibrary.appendonly',
          tokenType: 'Bearer',
          updatedAt: '2026-03-08T00:00:00.000Z',
        }) as any;
      }
      return '' as any;
    });

    const secretStore = createMemorySecretStore();
    const manager = new GooglePhotosManager(configManager, secretStore);
    const status = manager.getStatus();

    expect(status.connected).toBe(true);
    expect(secretStore.set).toHaveBeenCalledWith(
      'google-photos-auth',
      expect.stringContaining('"refreshToken"'),
    );
    expect(fs.unlinkSync).toHaveBeenCalledWith(authPath);
  });
});
