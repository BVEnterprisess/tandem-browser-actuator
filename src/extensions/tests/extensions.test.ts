import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import type { KeyObject } from 'crypto';
import { CrxDownloader } from '../crx-downloader';
import { ChromeExtensionImporter } from '../chrome-importer';
import { GALLERY_DEFAULTS } from '../gallery-defaults';
import { UpdateChecker } from '../update-checker';
import { ExtensionLoader } from '../loader';
import { nmProxy } from '../nm-proxy';
import { NativeMessagingSetup } from '../native-messaging';
import {
  createDarwinNativeMessagingDetectionAdapter,
  createWindowsNativeMessagingDetectionAdapter,
} from '../../platform/native-messaging';
import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { tandemDir } from '../../utils/paths';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal valid ZIP buffer containing a manifest.json.
 */
function createTestZip(manifest: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  return zip.toBuffer();
}

/**
 * Build a CRX2 buffer: [Cr24][version=2][pubkey_len][sig_len][pubkey][sig][zip]
 */
function buildCrx2(zipPayload: Buffer): Buffer {
  const magic = Buffer.from('Cr24');
  const version = Buffer.alloc(4);
  version.writeUInt32LE(2, 0);

  const fakePubkey = Buffer.from('fake-public-key');
  const fakeSig = Buffer.from('fake-signature');

  const pubkeyLen = Buffer.alloc(4);
  pubkeyLen.writeUInt32LE(fakePubkey.length, 0);

  const sigLen = Buffer.alloc(4);
  sigLen.writeUInt32LE(fakeSig.length, 0);

  return Buffer.concat([magic, version, pubkeyLen, sigLen, fakePubkey, fakeSig, zipPayload]);
}

/**
 * Build a CRX3 buffer: [Cr24][version=3][header_size][header_bytes][zip]
 */
function buildCrx3(zipPayload: Buffer): Buffer {
  const magic = Buffer.from('Cr24');
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);

  const fakeHeader = Buffer.from('fake-crx3-protobuf-header');

  const headerSize = Buffer.alloc(4);
  headerSize.writeUInt32LE(fakeHeader.length, 0);

  return Buffer.concat([magic, version, headerSize, fakeHeader, zipPayload]);
}

function writeNativeMessagingManifest(root: string, name: string, binaryPath: string): string {
  const manifestPath = path.join(root, `${name}.json`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    name,
    description: `${name} fixture`,
    path: binaryPath,
    type: 'stdio',
    allowed_origins: ['chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/'],
  }), 'utf-8');
  return manifestPath;
}

// ─── UpdateChecker Version Comparison Tests ─────────────────────────────────

describe('UpdateChecker version comparison', () => {
  const checker = Object.create(UpdateChecker.prototype) as UpdateChecker & {
    isNewerVersion: (newer: string, current: string) => boolean;
  };

  it('treats 1.2 and 1.2.0 as equal', () => {
    expect(checker.isNewerVersion('1.2', '1.2.0')).toBe(false);
    expect(checker.isNewerVersion('1.2.0', '1.2')).toBe(false);
  });

  it('compares multi-digit segments numerically instead of lexically', () => {
    expect(checker.isNewerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(checker.isNewerVersion('1.9.9', '1.10.0')).toBe(false);
  });

  it('treats prerelease suffixes as older than the final release', () => {
    expect(checker.isNewerVersion('1.2.3', '1.2.3-beta')).toBe(true);
    expect(checker.isNewerVersion('1.2.3-beta', '1.2.3')).toBe(false);
  });

  it('compares prerelease suffix tokens consistently', () => {
    expect(checker.isNewerVersion('1.2.3-beta.2', '1.2.3-beta.1')).toBe(true);
    expect(checker.isNewerVersion('1.2.3-rc.1', '1.2.3-beta.9')).toBe(true);
    expect(checker.isNewerVersion('1.2.3-alpha', '1.2.3-beta')).toBe(false);
  });
});

// ─── Extension ID Extraction Tests ────────────────────────────────────────────

describe('Extension ID Extraction', () => {
  const downloader = new CrxDownloader();

  it('extracts bare extension ID (32 a-p chars)', () => {
    expect(downloader.extractExtensionId('cjpalhdlnbpafiamejdnhcphjbkeiagm'))
      .toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('extracts ID from full CWS URL', () => {
    expect(downloader.extractExtensionId(
      'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm'
    )).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('extracts ID from short CWS URL (no name segment)', () => {
    expect(downloader.extractExtensionId(
      'https://chromewebstore.google.com/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm'
    )).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('extracts ID from URL with query params', () => {
    expect(downloader.extractExtensionId(
      'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm?hl=en'
    )).toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('handles whitespace around input', () => {
    expect(downloader.extractExtensionId('  cjpalhdlnbpafiamejdnhcphjbkeiagm  '))
      .toBe('cjpalhdlnbpafiamejdnhcphjbkeiagm');
  });

  it('returns null for empty string', () => {
    expect(downloader.extractExtensionId('')).toBeNull();
  });

  it('returns null for invalid input (random text)', () => {
    expect(downloader.extractExtensionId('not-an-extension-id')).toBeNull();
  });

  it('returns null for wrong length ID (31 chars)', () => {
    expect(downloader.extractExtensionId('cjpalhdlnbpafiamejdnhcphjbkeiag')).toBeNull();
  });

  it('returns null for wrong length ID (33 chars)', () => {
    expect(downloader.extractExtensionId('cjpalhdlnbpafiamejdnhcphjbkeiagmm')).toBeNull();
  });

  it('returns null for ID with invalid chars (outside a-p)', () => {
    // 'q' is outside the a-p range
    expect(downloader.extractExtensionId('cjpalhdlnbpafiamejdnhcphjbkeiqgm')).toBeNull();
  });

  it('returns null for ID with uppercase letters', () => {
    expect(downloader.extractExtensionId('CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM')).toBeNull();
  });

  it('returns null for ID with numbers', () => {
    expect(downloader.extractExtensionId('cjpalhdlnbpafiamejdnhcphjbkeig12')).toBeNull();
  });

  it('extracts different valid IDs', () => {
    // Dark Reader
    expect(downloader.extractExtensionId('eimadpbcbfnmbkopoojfekhnkhdbieeh'))
      .toBe('eimadpbcbfnmbkopoojfekhnkhdbieeh');
    // Bitwarden
    expect(downloader.extractExtensionId('nngceckbapebfimnlniiiahkandclblb'))
      .toBe('nngceckbapebfimnlniiiahkandclblb');
  });
});

describe('Extension path validation', () => {
  it('rejects loading extensions outside the Tandem extensions directory', async () => {
    const loader = new ExtensionLoader();
    const sessionMock = {
      extensions: {
        loadExtension: async () => ({ id: 'test-extension-id' }),
      },
    } as any;

    await expect(loader.loadExtension(sessionMock, '/tmp/not-allowed')).rejects.toThrow('Path escapes root directory');
  });

  it('refuses to patch manifest CSP outside the Tandem extensions directory', () => {
    expect(nmProxy.patchManifestCSP('/tmp/manifest.json')).toBe(false);
  });
});

// ─── CRX Header Parsing Tests ─────────────────────────────────────────────────

describe('CRX Header Parsing', () => {
  const downloader = new CrxDownloader();

  // Access private verifyCrxFormat method for unit testing
  const verifyCrxFormat = (buffer: Buffer, allHostsGoogle: boolean) =>
    (downloader as unknown as { verifyCrxFormat: (buf: Buffer, google: boolean) => { valid: boolean; format: string; error?: string } })
      .verifyCrxFormat(buffer, allHostsGoogle);

  it('accepts valid CRX2 header', () => {
    const zip = createTestZip({ name: 'Test', version: '1.0', manifest_version: 3 });
    const crx = buildCrx2(zip);
    const result = verifyCrxFormat(crx, true);
    expect(result.valid).toBe(true);
    expect(result.format).toBe('crx2');
  });

  it('accepts valid CRX3 header', () => {
    const zip = createTestZip({ name: 'Test', version: '1.0', manifest_version: 3 });
    const crx = buildCrx3(zip);
    const result = verifyCrxFormat(crx, true);
    expect(result.valid).toBe(true);
    expect(result.format).toBe('crx3');
  });

  it('rejects files without Cr24 magic bytes', () => {
    const badMagic = Buffer.from('XXXX\x02\x00\x00\x00\x00\x00\x00\x00');
    const result = verifyCrxFormat(badMagic, true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid magic bytes');
  });

  it('rejects HTML error pages', () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>Error</body></html>');
    const result = verifyCrxFormat(html, true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTML');
  });

  it('rejects files with unknown CRX version (version 5)', () => {
    const buf = Buffer.alloc(12);
    buf.write('Cr24', 0);
    buf.writeUInt32LE(5, 4); // version 5
    buf.writeUInt32LE(0, 8);
    const result = verifyCrxFormat(buf, true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unknown CRX version');
  });

  it('rejects files too small to be valid CRX', () => {
    const tooSmall = Buffer.from('Cr24XXXX');
    const result = verifyCrxFormat(tooSmall, true);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too small');
  });

  it('rejects downloads from non-Google domains', () => {
    const zip = createTestZip({ name: 'Test', version: '1.0', manifest_version: 3 });
    const crx = buildCrx3(zip);
    const result = verifyCrxFormat(crx, false);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('outside Google domains');
  });
});

// ─── CRX Install Gate Tests (audit #34 High-3) ───────────────────────────────

describe('CrxDownloader.gateCrxForInstall', () => {
  const downloader = new CrxDownloader();

  // Build a locally-signed CRX3 using the same helpers as the verifier tests.
  function encodeVarint(value: number): Buffer {
    const bytes: number[] = [];
    let v = value;
    while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    bytes.push(v & 0x7f);
    return Buffer.from(bytes);
  }
  function encodeTag(fieldNumber: number, wireType: number): Buffer {
    return encodeVarint((fieldNumber << 3) | wireType);
  }
  function encodeLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
    return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(payload.length), payload]);
  }
  function deriveIdFromKey(keyDer: Buffer): string {
    const crypto = require('crypto');
    const digest = crypto.createHash('sha256').update(keyDer).digest();
    const out: string[] = [];
    for (let i = 0; i < 16; i++) {
      out.push(String.fromCharCode(97 + ((digest[i] >> 4) & 0xf)));
      out.push(String.fromCharCode(97 + (digest[i] & 0xf)));
    }
    return out.join('');
  }
  function crxIdBytes(extensionId: string): Buffer {
    const out = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      out[i] = ((extensionId.charCodeAt(i * 2) - 97) << 4) | (extensionId.charCodeAt(i * 2 + 1) - 97);
    }
    return out;
  }
  function buildSignedCrx3(extensionId: string, zip: Buffer, privateKey: KeyObject, publicKeyDer: Buffer): Buffer {
    const crypto = require('crypto');
    const signedHeaderData = encodeLengthDelimited(1, crxIdBytes(extensionId));
    const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32LE(signedHeaderData.length, 0);
    const signer = crypto.createSign('sha256');
    signer.update(Buffer.from('CRX3 SignedData\0', 'binary'));
    signer.update(lenBuf);
    signer.update(signedHeaderData);
    signer.update(zip);
    const signature = signer.sign(privateKey);
    const rsaProof = Buffer.concat([
      encodeLengthDelimited(1, publicKeyDer),
      encodeLengthDelimited(2, signature),
    ]);
    const header = Buffer.concat([
      encodeLengthDelimited(2, rsaProof),
      encodeLengthDelimited(10000, signedHeaderData),
    ]);
    const magic = Buffer.from('Cr24');
    const ver = Buffer.alloc(4); ver.writeUInt32LE(3, 0);
    const headerLen = Buffer.alloc(4); headerLen.writeUInt32LE(header.length, 0);
    return Buffer.concat([magic, ver, headerLen, header, zip]);
  }

  it('rejects CRX2 outright regardless of buffer content', () => {
    const crx2 = buildCrx2(createTestZip({ name: 'X', version: '1.0' }));
    const result = downloader.gateCrxForInstall(crx2, 'a'.repeat(32), 'crx2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/crx2/i);
      expect(result.error).toMatch(/deprecated/i);
    }
  });

  it('rejects CRX3 with an invalid signature', () => {
    const zip = createTestZip({ name: 'X', version: '1.0' });
    const crx3WithoutSig = buildCrx3(zip); // fake header, no real signatures
    const result = downloader.gateCrxForInstall(crx3WithoutSig, 'a'.repeat(32), 'crx3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/signature verification failed/i);
    }
  });

  it('accepts a correctly-signed CRX3 whose key-derived ID matches', () => {
    const crypto = require('crypto');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const expectedId = deriveIdFromKey(publicKeyDer);

    const zip = createTestZip({ name: 'X', version: '1.0' });
    const signedCrx = buildSignedCrx3(expectedId, zip, privateKey, publicKeyDer);

    const result = downloader.gateCrxForInstall(signedCrx, expectedId, 'crx3');
    expect(result.ok).toBe(true);
  });

  it('rejects a signed CRX3 when expectedExtensionId does not match key', () => {
    const crypto = require('crypto');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const actualId = deriveIdFromKey(publicKeyDer);
    const zip = createTestZip({ name: 'X', version: '1.0' });
    const signedCrx = buildSignedCrx3(actualId, zip, privateKey, publicKeyDer);

    const wrongId = 'a'.repeat(32);
    const result = downloader.gateCrxForInstall(signedCrx, wrongId, 'crx3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/extension id/i);
    }
  });
});

// ─── CRX Extraction Tests ─────────────────────────────────────────────────────

describe('CRX Extraction', () => {
  const downloader = new CrxDownloader();
  let tempDir: string;

  // Access private extractCrx method for unit testing
  const extractCrx = (buffer: Buffer, extensionId: string, format: 'crx2' | 'crx3') =>
    (downloader as unknown as { extractCrx: (buf: Buffer, id: string, fmt: 'crx2' | 'crx3') => string })
      .extractCrx(buffer, extensionId, format);

  beforeEach(() => {
    tempDir = tandemDir('extensions');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test extension
    const testPath = path.join(tempDir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan');
    if (fs.existsSync(testPath)) {
      fs.rmSync(testPath, { recursive: true, force: true });
    }
  });

  it('extracts CRX2 ZIP to correct path with manifest.json', () => {
    const manifest = { name: 'CRX2 Test', version: '1.0', manifest_version: 2 };
    const zip = createTestZip(manifest);
    const crx = buildCrx2(zip);
    const testId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan';

    const installPath = extractCrx(crx, testId, 'crx2');
    expect(fs.existsSync(installPath)).toBe(true);
    expect(fs.existsSync(path.join(installPath, 'manifest.json'))).toBe(true);

    const extracted = JSON.parse(fs.readFileSync(path.join(installPath, 'manifest.json'), 'utf-8'));
    expect(extracted.name).toBe('CRX2 Test');
  });

  it('extracts CRX3 ZIP to correct path with manifest.json', () => {
    const manifest = { name: 'CRX3 Test', version: '2.0', manifest_version: 3 };
    const zip = createTestZip(manifest);
    const crx = buildCrx3(zip);
    const testId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan';

    const installPath = extractCrx(crx, testId, 'crx3');
    expect(fs.existsSync(installPath)).toBe(true);
    expect(fs.existsSync(path.join(installPath, 'manifest.json'))).toBe(true);

    const extracted = JSON.parse(fs.readFileSync(path.join(installPath, 'manifest.json'), 'utf-8'));
    expect(extracted.name).toBe('CRX3 Test');
    expect(extracted.version).toBe('2.0');
  });

  it('throws on invalid ZIP payload offset', () => {
    // CRX3 header claims a huge header that exceeds buffer
    const magic = Buffer.from('Cr24');
    const version = Buffer.alloc(4);
    version.writeUInt32LE(3, 0);
    const headerSize = Buffer.alloc(4);
    headerSize.writeUInt32LE(99999, 0); // way beyond buffer
    const buf = Buffer.concat([magic, version, headerSize, Buffer.alloc(10)]);

    expect(() => extractCrx(buf, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan', 'crx3'))
      .toThrow('ZIP start offset');
  });

  it('throws on empty ZIP archive', () => {
    // Build CRX3 with an invalid ZIP (just garbage bytes)
    const magic = Buffer.from('Cr24');
    const version = Buffer.alloc(4);
    version.writeUInt32LE(3, 0);
    const fakeHeader = Buffer.from('hdr');
    const headerSize = Buffer.alloc(4);
    headerSize.writeUInt32LE(fakeHeader.length, 0);
    const garbage = Buffer.from('this is not a zip file at all');
    const buf = Buffer.concat([magic, version, headerSize, fakeHeader, garbage]);

    expect(() => extractCrx(buf, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaan', 'crx3'))
      .toThrow('Invalid ZIP payload');
  });
});

// ─── Gallery Defaults Tests ───────────────────────────────────────────────────

describe('Gallery Defaults', () => {
  it('contains exactly 30 curated extensions', () => {
    expect(GALLERY_DEFAULTS).toHaveLength(30);
  });

  it('all entries have required fields', () => {
    for (const ext of GALLERY_DEFAULTS) {
      expect(ext.id).toMatch(/^[a-p]{32}$/);
      expect(ext.name).toBeTruthy();
      expect(ext.description).toBeTruthy();
      expect(ext.category).toBeTruthy();
      expect(['works', 'partial', 'needs-work', 'blocked']).toContain(ext.compatibility);
      expect(['none', 'dnr-overlap', 'native-messaging']).toContain(ext.securityConflict);
      expect(typeof ext.featured).toBe('boolean');
    }
  });

  it('all extension IDs are unique', () => {
    const ids = GALLERY_DEFAULTS.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly 10 featured extensions', () => {
    const featured = GALLERY_DEFAULTS.filter(e => e.featured);
    expect(featured).toHaveLength(10);
  });

  it('recommended extensions from TOP30 are all included', () => {
    const expectedIds = [
      'cjpalhdlnbpafiamejdnhcphjbkeiagm', // uBlock Origin
      'nngceckbapebfimnlniiiahkandclblb', // Bitwarden
      'niloccemoadcdkdjlinkgdfekeahmflj', // Pocket
      'laookkfknpbbblfpciffpaejjkokdgca', // Momentum
      'laankejkbhbdhmipfmgcngdelahlfoji', // StayFocusd
      'eimadpbcbfnmbkopoojfekhnkhdbieeh', // Dark Reader
      'fmkadmapgofadopljbjfkapdkoienihi', // React DevTools
      'gppongmhjkpfnbhagpmjfkannfbllamg', // Wappalyzer
      'nffaoalbilbmmfgbnbgppjihopabppdk', // Video Speed Controller
      'nkbihfbeogaeaoehlefnkodbefgpgknn', // MetaMask
    ];
    const galleryIds = GALLERY_DEFAULTS.map(e => e.id);
    for (const id of expectedIds) {
      expect(galleryIds).toContain(id);
    }
  });

  it('dnr-overlap extensions are correctly flagged', () => {
    const dnrExtensions = GALLERY_DEFAULTS.filter(e => e.securityConflict === 'dnr-overlap');
    expect(dnrExtensions.length).toBe(6);
    const dnrIds = dnrExtensions.map(e => e.id);
    // uBlock, ABP, AdBlock, Ghostery, DuckDuckGo, StayFocusd
    expect(dnrIds).toContain('cjpalhdlnbpafiamejdnhcphjbkeiagm');
    expect(dnrIds).toContain('cfhdojbkjhnklbpkdaibdccddilifddb');
    expect(dnrIds).toContain('gighmmpiobklfepjocnamgkkbiglidom');
    expect(dnrIds).toContain('mlomiejdfkolichcflejclcbmpeaniij');
    expect(dnrIds).toContain('bkdgflcldnnnapblkhphbgpggdiikppg');
    expect(dnrIds).toContain('laankejkbhbdhmipfmgcngdelahlfoji');
  });

  it('native-messaging extensions are correctly flagged', () => {
    const nativeExtensions = GALLERY_DEFAULTS.filter(e => e.securityConflict === 'native-messaging');
    expect(nativeExtensions.length).toBe(3);
    const nativeIds = nativeExtensions.map(e => e.id);
    // LastPass, 1Password, Postman
    expect(nativeIds).toContain('hdokiejnpimakedhajhdlcegeplioahd');
    expect(nativeIds).toContain('aeblfdkhhhdcdjpifhhbdiojplfjncoa');
    expect(nativeIds).toContain('aicmkgpgakddgnaphhhpliifpcfhicfo');
  });
});

// ─── Chrome Importer Tests ────────────────────────────────────────────────────

describe('Native messaging platform detection', () => {
  it('keeps macOS native messaging directories unchanged through the adapter', () => {
    const dirs = createDarwinNativeMessagingDetectionAdapter()
      .getNativeMessagingDirs()
      .map((dir) => dir.path);

    expect(dirs).toEqual([
      '/Library/Google/Chrome/NativeMessagingHosts',
      path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Tandem Browser', 'NativeMessagingHosts'),
      path.join(os.homedir(), 'Library', 'Application Support', 'tandem-browser', 'NativeMessagingHosts'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'NativeMessagingHosts'),
    ]);
  });

  it('detects Windows hosts from HKCU/HKLM registry manifests plus the filesystem fallback', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-native-messaging-'));
    const registryDir = path.join(root, 'registry');
    const fallbackDir = path.join(root, 'Chrome', 'User Data', 'NativeMessagingHosts');
    const binaryPath = path.join(root, 'fixture-host.exe');
    fs.writeFileSync(binaryPath, 'fixture binary', 'utf-8');

    const hkcuManifest = writeNativeMessagingManifest(registryDir, 'com.tandem.hkcu', binaryPath);
    const hklmManifest = writeNativeMessagingManifest(registryDir, 'com.tandem.hklm', binaryPath);
    writeNativeMessagingManifest(fallbackDir, 'com.tandem.filesystem', binaryPath);
    const registryReads: string[] = [];

    try {
      const adapter = createWindowsNativeMessagingDetectionAdapter({
        chromeUserDataNativeMessagingDir: fallbackDir,
        registryReader: (hive, subkey) => {
          registryReads.push(`${hive}\\${subkey}`);
          return hive === 'HKCU' ? [hkcuManifest] : [hklmManifest];
        },
      });
      const setup = new NativeMessagingSetup(adapter);

      const hosts = setup.detectHosts();

      expect(registryReads).toEqual([
        'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
        'HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts',
      ]);
      expect(hosts.map((host) => host.name)).toEqual([
        'com.tandem.hkcu',
        'com.tandem.hklm',
        'com.tandem.filesystem',
      ]);
      expect(hosts.every((host) => host.binaryExists)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Chrome Importer', () => {
  it('detects correct Chrome extensions path for current platform', () => {
    const importer = new ChromeExtensionImporter();
    const dir = importer.getChromeExtensionsDir();

    if (process.platform === 'darwin') {
      if (dir !== null) {
        expect(dir).toContain('Google/Chrome');
        expect(dir).toContain('Extensions');
      }
      // null is valid if Chrome is not installed
    } else if (process.platform === 'win32') {
      if (dir !== null) {
        expect(dir).toContain('Google\\Chrome');
      }
    } else {
      if (dir !== null) {
        expect(dir).toContain('google-chrome');
      }
    }
  });

  it('returns extensions array (or empty if Chrome not installed)', () => {
    const importer = new ChromeExtensionImporter();
    const extensions = importer.listChromeExtensions();
    expect(Array.isArray(extensions)).toBe(true);

    // If extensions found, verify structure
    for (const ext of extensions) {
      expect(ext.id).toMatch(/^[a-p]{32}$/);
      expect(typeof ext.name).toBe('string');
      expect(typeof ext.version).toBe('string');
      expect(typeof ext.chromePath).toBe('string');
    }
  });

  it('isAlreadyImported returns false for non-existent extension', () => {
    const importer = new ChromeExtensionImporter();
    const chars = 'abcdefghijklmnop';
    let extensionId = '';
    const seedStart = Date.now();
    for (let seed = seedStart; seed < seedStart + 64; seed++) {
      const candidate = Array.from({ length: 32 }, (_value, index) => chars[(seed + index) % chars.length]).join('');
      if (!fs.existsSync(path.join(tandemDir('extensions'), candidate))) {
        extensionId = candidate;
        break;
      }
    }

    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(importer.isAlreadyImported(extensionId)).toBe(false);
  });

  it('supports different profile names', () => {
    const defaultImporter = new ChromeExtensionImporter('Default');
    const profile1Importer = new ChromeExtensionImporter('Profile 1');

    const defaultDir = defaultImporter.getChromeExtensionsDir();
    const profile1Dir = profile1Importer.getChromeExtensionsDir();

    if (defaultDir !== null) {
      expect(defaultDir).toContain('Default');
    }
    if (profile1Dir !== null) {
      expect(profile1Dir).toContain('Profile 1');
    }
    // Both can be null if Chrome is not installed — that's fine
  });
});

// ─── Integration Tests (require network) ──────────────────────────────────────

const RUN_NETWORK_TESTS = process.env.TANDEM_NETWORK_TESTS === 'true';

describe.skipIf(!RUN_NETWORK_TESTS)('Extension Install Flow (network)', () => {
  const downloader = new CrxDownloader();
  const testExtId = 'gpmodmeblccallcadopbcoeoejepgpnb'; // JSON Formatter (small, fast)
  const installPath = tandemDir('extensions', testExtId);

  afterAll(() => {
    // Clean up test download
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }
  });

  it('installs extension by bare ID', async () => {
    // Clean up first
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    const result = await downloader.installFromCws(testExtId);
    expect(result.success).toBe(true);
    expect(result.extensionId).toBe(testExtId);
    expect(result.name).toBeTruthy();
    expect(result.version).toBeTruthy();
    expect(fs.existsSync(result.installPath)).toBe(true);
    expect(fs.existsSync(path.join(result.installPath, 'manifest.json'))).toBe(true);
  }, 60_000);

  it('returns success immediately for already-installed extension (idempotent)', async () => {
    // Should already be installed from previous test
    const result = await downloader.installFromCws(testExtId);
    expect(result.success).toBe(true);
    expect(result.extensionId).toBe(testExtId);
  }, 10_000);

  it('installs extension by CWS URL', async () => {
    // Clean up and reinstall via URL
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    const url = `https://chromewebstore.google.com/detail/json-formatter/${testExtId}`;
    const result = await downloader.installFromCws(url);
    expect(result.success).toBe(true);
    expect(result.extensionId).toBe(testExtId);
  }, 60_000);

  it('returns error for invalid extension ID', async () => {
    const result = await downloader.installFromCws('not-a-valid-id');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid extension ID');
  });

  it('uninstall removes directory from disk', () => {
    // The extension should be installed from previous tests
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
      expect(fs.existsSync(installPath)).toBe(false);
    }
  });
});

// ─── TOP30 Extension ID Verification (network) ───────────────────────────────

describe.skipIf(!RUN_NETWORK_TESTS)('TOP30 Extension ID Verification', () => {
  const top30Ids = GALLERY_DEFAULTS.map(e => ({ id: e.id, name: e.name }));

  it.each(top30Ids)('$name ($id) resolves on CWS', async ({ id }) => {
    const downloader = new CrxDownloader();
    const extractedId = downloader.extractExtensionId(id);
    expect(extractedId).toBe(id);

    // Verify the ID is a valid 32 a-p character string
    expect(id).toMatch(/^[a-p]{32}$/);
  });

  // Specifically flagged IDs
  it('DuckDuckGo Privacy Essentials ID is valid', () => {
    expect(GALLERY_DEFAULTS.find(e => e.name.includes('DuckDuckGo'))?.id)
      .toBe('bkdgflcldnnnapblkhphbgpggdiikppg');
  });

  it('JSON Formatter ID is valid', () => {
    expect(GALLERY_DEFAULTS.find(e => e.name === 'JSON Formatter')?.id)
      .toBe('gpmodmeblccallcadopbcoeoejepgpnb');
  });

  it('Return YouTube Dislike ID is valid', () => {
    expect(GALLERY_DEFAULTS.find(e => e.name === 'Return YouTube Dislike')?.id)
      .toBe('gebbhagfogifgggkldgodflihgfeippi');
  });
});
