import type { PlatformId } from './errors';

export type CapabilityStatus = 'supported' | 'partial' | 'unsupported' | 'planned';

export interface PlatformCapability {
  status: CapabilityStatus;
  notes: string;
}

export interface PlatformCapabilities {
  appStartup: PlatformCapability;
  signedInstaller: PlatformCapability;
  autoUpdate: PlatformCapability;
  windowChrome: PlatformCapability;
  stealthUa: PlatformCapability;
  chromeBookmarkHistoryImport: PlatformCapability;
  chromeCookieImport: PlatformCapability;
  nativeMessagingHostDetection: PlatformCapability;
  voiceTranscription: PlatformCapability;
  videoRecorderSystemAudio: PlatformCapability;
  keyboardShortcutsLabels: PlatformCapability;
  secretsAtRest: PlatformCapability;
  userDataDirectory: PlatformCapability;
}

export interface PlatformSupportProfile {
  platform: PlatformId;
  tier: 'tier1-required' | 'tier1-target' | 'tier2-best-effort' | 'unsupported';
  label: string;
  notes: string;
  capabilities: PlatformCapabilities;
}

const unsupportedCapability = (notes: string): PlatformCapability => ({
  status: 'unsupported',
  notes,
});

const CAPABILITY_PROFILES: Record<PlatformId, PlatformSupportProfile> = {
  darwin: {
    platform: 'darwin',
    tier: 'tier1-required',
    label: 'macOS Apple Silicon',
    notes: 'Primary platform. Signed and notarized.',
    capabilities: {
      appStartup: { status: 'supported', notes: 'Source startup is supported on macOS.' },
      signedInstaller: { status: 'supported', notes: 'Signed and notarized macOS installer is supported.' },
      autoUpdate: { status: 'supported', notes: 'macOS auto-update is supported.' },
      windowChrome: { status: 'supported', notes: 'Hidden inset titlebar with native macOS controls.' },
      stealthUa: { status: 'supported', notes: 'Stealth UA currently presents a macOS Chrome persona.' },
      chromeBookmarkHistoryImport: { status: 'supported', notes: 'Chrome bookmark and history paths are implemented.' },
      chromeCookieImport: { status: 'partial', notes: 'Cookie import uses CDP or pre-exported JSON fallback.' },
      nativeMessagingHostDetection: { status: 'supported', notes: 'macOS native messaging host directories are detected.' },
      voiceTranscription: { status: 'supported', notes: 'Apple Speech binary and Whisper fallback are supported.' },
      videoRecorderSystemAudio: { status: 'supported', notes: 'Video recorder with system audio is supported.' },
      keyboardShortcutsLabels: { status: 'supported', notes: 'macOS shortcut behavior and labels are supported.' },
      secretsAtRest: { status: 'supported', notes: 'Secrets at rest are supported on macOS.' },
      userDataDirectory: { status: 'supported', notes: 'macOS user data path is supported.' },
    },
  },
  win32: {
    platform: 'win32',
    tier: 'tier1-required',
    label: 'Windows 11 x64',
    notes: 'Supported with required CI, startup smoke coverage, and unsigned official installer/portable builds.',
    capabilities: {
      appStartup: { status: 'supported', notes: 'Windows startup is covered by required verify and smoke checks.' },
      signedInstaller: unsupportedCapability('Windows installer and portable builds are official but unsigned; code signing is planned.'),
      autoUpdate: { status: 'partial', notes: 'Manual electron-updater checks and latest.yml generation exist; automatic update installation remains blocked until end-to-end update validation is complete.' },
      windowChrome: { status: 'supported', notes: 'Frameless custom titlebar with shell controls is implemented for source and packaged runs.' },
      stealthUa: { status: 'supported', notes: 'Windows presents a Chrome-on-Windows UA persona.' },
      chromeBookmarkHistoryImport: { status: 'supported', notes: 'Windows Chrome bookmark and history import scans LOCALAPPDATA/Google/Chrome/User Data profiles.' },
      chromeCookieImport: unsupportedCapability('Windows Chrome cookie import is not implemented; encrypted cookies require DPAPI support and no dependency was added in phase 8.'),
      nativeMessagingHostDetection: { status: 'supported', notes: 'Windows native messaging host detection reads Chrome registry keys and keeps the filesystem fallback.' },
      voiceTranscription: { status: 'partial', notes: 'Windows voice transcription uses whisper.exe when users install Whisper and place it on PATH; Tandem does not bundle Whisper or download models.' },
      videoRecorderSystemAudio: unsupportedCapability('Windows WASAPI loopback planned in windows-support phase 11.'),
      keyboardShortcutsLabels: { status: 'supported', notes: 'Windows source runs show platform-aware Ctrl labels while preserving CommandOrControl accelerators.' },
      secretsAtRest: { status: 'supported', notes: 'Windows uses the safeStorage-backed secret store with plaintext-initialization fallback records.' },
      userDataDirectory: { status: 'supported', notes: 'Windows user data resolves to APPDATA/Tandem Browser.' },
    },
  },
  linux: {
    platform: 'linux',
    tier: 'tier2-best-effort',
    label: 'Linux x64',
    notes: 'Pre-beta. Functional but not a release blocker.',
    capabilities: {
      appStartup: { status: 'partial', notes: 'Linux source startup is pre-beta.' },
      signedInstaller: unsupportedCapability('Linux installer is not currently supported.'),
      autoUpdate: unsupportedCapability('Linux auto-update is not currently supported.'),
      windowChrome: { status: 'supported', notes: 'Frameless custom titlebar is supported.' },
      stealthUa: { status: 'partial', notes: 'Stealth UA does not yet fully match Linux host OS.' },
      chromeBookmarkHistoryImport: { status: 'partial', notes: 'Linux Chrome path support exists with known gaps.' },
      chromeCookieImport: { status: 'partial', notes: 'Linux cookie import remains partial.' },
      nativeMessagingHostDetection: { status: 'supported', notes: 'Linux native messaging host directories are detected.' },
      voiceTranscription: { status: 'partial', notes: 'Whisper fallback can work when installed.' },
      videoRecorderSystemAudio: { status: 'partial', notes: 'Desktop audio capture gap remains for Linux.' },
      keyboardShortcutsLabels: { status: 'supported', notes: 'Linux shortcut behavior and labels are supported.' },
      secretsAtRest: { status: 'supported', notes: 'Secrets at rest are currently supported.' },
      userDataDirectory: { status: 'supported', notes: 'Linux user data path is supported.' },
    },
  },
  unsupported: {
    platform: 'unsupported',
    tier: 'unsupported',
    label: 'Unsupported platform',
    notes: 'Not maintained. May happen to work; no guarantees.',
    capabilities: {
      appStartup: unsupportedCapability('Unsupported platform.'),
      signedInstaller: unsupportedCapability('Unsupported platform.'),
      autoUpdate: unsupportedCapability('Unsupported platform.'),
      windowChrome: unsupportedCapability('Unsupported platform.'),
      stealthUa: unsupportedCapability('Unsupported platform.'),
      chromeBookmarkHistoryImport: unsupportedCapability('Unsupported platform.'),
      chromeCookieImport: unsupportedCapability('Unsupported platform.'),
      nativeMessagingHostDetection: unsupportedCapability('Unsupported platform.'),
      voiceTranscription: unsupportedCapability('Unsupported platform.'),
      videoRecorderSystemAudio: unsupportedCapability('Unsupported platform.'),
      keyboardShortcutsLabels: unsupportedCapability('Unsupported platform.'),
      secretsAtRest: unsupportedCapability('Unsupported platform.'),
      userDataDirectory: unsupportedCapability('Unsupported platform.'),
    },
  },
};

export function normalizePlatform(platform: NodeJS.Platform | string): PlatformId {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return platform;
  }
  return 'unsupported';
}

export function getPlatformCapabilities(platform: NodeJS.Platform | string = process.platform): PlatformSupportProfile {
  return CAPABILITY_PROFILES[normalizePlatform(platform)];
}
