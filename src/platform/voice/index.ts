import fs from 'fs';
import path from 'path';
import { transcribeAudioWithBackend, type TranscriberBackendSelection } from '../../voice/speech-transcriber';
import { NotImplementedError, type PlatformId } from '../errors';
import type { VoiceAdapter } from '../types';

const WINDOWS_WHISPER_UNAVAILABLE =
  'Windows voice transcription requires whisper.exe on PATH. Install Whisper yourself, make sure whisper.exe is available on PATH, and restart Tandem. Tandem does not download models or bundle Whisper.';

const UNIX_WHISPER_UNAVAILABLE =
  'No speech transcription backend available. Install whisper: pip install openai-whisper';

interface VoiceAdapterOptions {
  existsSync?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  speechBinaryDir?: string;
}

function fileExists(filePath: string, existsSync: (path: string) => boolean): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function getAppleSpeechBinary(options: VoiceAdapterOptions = {}): string {
  const existsSync = options.existsSync ?? fs.existsSync;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? '';
  const speechBinaryDir = options.speechBinaryDir ?? path.join(__dirname, '..', '..', '..', 'native', 'speech');
  const bundled = path.join(resourcesPath, 'native', 'tandem-speech');
  const dev = path.join(speechBinaryDir, 'tandem-speech');

  if (fileExists(bundled, existsSync)) return bundled;
  if (fileExists(dev, existsSync)) return dev;
  return '';
}

function getUnixWhisperBinary(options: VoiceAdapterOptions = {}): string {
  const existsSync = options.existsSync ?? fs.existsSync;
  const locations = [
    '/opt/homebrew/bin/whisper',
    '/usr/local/bin/whisper',
    '/usr/bin/whisper',
  ];

  for (const location of locations) {
    if (fileExists(location, existsSync)) return location;
  }
  return '';
}

function getWindowsPathValue(env: NodeJS.ProcessEnv): string {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return pathKey ? env[pathKey] ?? '' : '';
}

export function findWindowsWhisperBinary(options: VoiceAdapterOptions = {}): string {
  const existsSync = options.existsSync ?? fs.existsSync;
  const env = options.env ?? process.env;
  const pathValue = getWindowsPathValue(env);

  for (const rawDir of pathValue.split(path.win32.delimiter)) {
    const dir = rawDir.trim().replace(/^"|"$/g, '');
    if (!dir) continue;

    const candidate = path.win32.join(dir, 'whisper.exe');
    if (fileExists(candidate, existsSync)) return candidate;
  }

  return '';
}

function createAdapter(selectionFactory: () => TranscriberBackendSelection): VoiceAdapter {
  return {
    detectBackend: () => selectionFactory().backend,
    transcribeAudio: async (audioBuffer, language) => {
      return transcribeAudioWithBackend(audioBuffer, selectionFactory(), language);
    },
  };
}

export function createDarwinVoiceAdapter(options: VoiceAdapterOptions = {}): VoiceAdapter {
  return createAdapter(() => {
    const appleBinary = getAppleSpeechBinary(options);
    if (appleBinary) {
      return { backend: 'apple', binary: appleBinary };
    }

    const whisperBinary = getUnixWhisperBinary(options);
    if (whisperBinary) {
      return { backend: 'whisper', binary: whisperBinary };
    }

    return { backend: 'none', unavailableMessage: UNIX_WHISPER_UNAVAILABLE };
  });
}

export function createWindowsVoiceAdapter(options: VoiceAdapterOptions = {}): VoiceAdapter {
  return createAdapter(() => {
    const whisperBinary = findWindowsWhisperBinary(options);
    if (whisperBinary) {
      return { backend: 'whisper', binary: whisperBinary };
    }

    return { backend: 'none', unavailableMessage: WINDOWS_WHISPER_UNAVAILABLE };
  });
}

export function createLinuxVoiceAdapter(options: VoiceAdapterOptions = {}): VoiceAdapter {
  return createAdapter(() => {
    const whisperBinary = getUnixWhisperBinary(options);
    if (whisperBinary) {
      return { backend: 'whisper', binary: whisperBinary };
    }

    return { backend: 'none', unavailableMessage: UNIX_WHISPER_UNAVAILABLE };
  });
}

export function createUnsupportedVoiceAdapter(platform: PlatformId): VoiceAdapter {
  return {
    detectBackend: () => 'none',
    transcribeAudio: async () => {
      throw new NotImplementedError('Voice transcription', platform, 'phase-10');
    },
  };
}
