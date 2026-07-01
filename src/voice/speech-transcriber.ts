import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../utils/logger';

const log = createLogger('SpeechTranscriber');

export type TranscriberBackend = 'apple' | 'whisper' | 'none';

export interface TranscriberBackendSelection {
  backend: TranscriberBackend;
  binary?: string;
  unavailableMessage?: string;
}

export async function transcribeAudioWithBackend(
  audioBuffer: Buffer,
  selection: TranscriberBackendSelection,
  language = 'nl-BE'
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (selection.backend === 'none' || !selection.binary) {
    return {
      ok: false,
      error: selection.unavailableMessage ?? 'No speech transcription backend available. Install whisper: pip install openai-whisper',
    };
  }

  // Write audio buffer to temp file — use .webm since MediaRecorder outputs webm
  const tmpFile = path.join(os.tmpdir(), `tandem-audio-${Date.now()}.webm`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
  } catch (e) {
    return { ok: false, error: `Failed to write temp audio file: ${e}` };
  }

  try {
    if (selection.backend === 'apple') {
      return await transcribeWithApple(tmpFile, selection.binary, language);
    }
    return await transcribeWithWhisper(tmpFile, selection.binary, language);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function convertToM4a(inputFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputFile = inputFile.replace(/\.[^.]+$/, '.m4a');
    // Try ffmpeg-static first, then system ffmpeg
    let ffmpegBin = 'ffmpeg';
    try { ffmpegBin = require('ffmpeg-static'); } catch { /* use system */ }

    execFile(ffmpegBin, [
      '-y', '-i', inputFile,
      '-c:a', 'aac', '-b:a', '64k',
      outputFile,
    ], { timeout: 15_000 }, (err, _stdout, stderr) => {
      if (err) {
        log.warn('ffmpeg conversion failed:', stderr);
        reject(new Error(stderr || err.message));
      } else {
        resolve(outputFile);
      }
    });
  });
}

async function transcribeWithApple(audioFile: string, binary: string, language: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const appleLanguage = language === 'nl-BE' ? 'nl-NL' : language;

  // Convert webm → m4a (Apple Speech doesn't accept webm)
  let transcribeFile = audioFile;
  let convertedFile: string | null = null;
  if (audioFile.endsWith('.webm')) {
    try {
      convertedFile = await convertToM4a(audioFile);
      transcribeFile = convertedFile;
      log.info(`Converted webm → m4a: ${convertedFile}`);
    } catch (e) {
      log.warn('Conversion failed, trying with original file:', e);
    }
  }

  return new Promise((resolve) => {
    execFile(binary, [transcribeFile, appleLanguage], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (convertedFile) try { fs.unlinkSync(convertedFile); } catch { /* ignore */ }

      if (err) {
        log.warn('Apple Speech error:', stderr || err.message);
        log.warn('Apple Speech exit code:', err.code);
        resolve({ ok: false, error: `${stderr || err.message} (exit: ${err.code})` });
      } else {
        const text = stdout.trim();
        if (text) {
          log.info(`Apple Speech: "${text.substring(0, 60)}"`);
          resolve({ ok: true, text });
        } else {
          log.warn('Apple Speech: empty result. stderr:', stderr);
          resolve({ ok: false, error: 'No transcription result' });
        }
      }
    });
  });
}

function transcribeWithWhisper(audioFile: string, binary: string, language: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    // Map language code: nl-BE → nl
    const whisperLang = language.split('-')[0];

    const outDir = path.dirname(audioFile);
    const args = [
      audioFile,
      '--model', 'base',
      '--language', whisperLang,
      '--output_format', 'txt',
      '--output_dir', outDir,
    ];

    execFile(binary, args, { timeout: 60_000 }, (err, _stdout, stderr) => {
      if (err) {
        log.warn('Whisper error:', stderr || err.message);
        resolve({ ok: false, error: stderr || err.message });
        return;
      }

      // Whisper writes <filename>.txt
      const base = path.basename(audioFile, path.extname(audioFile));
      const txtFile = path.join(outDir, `${base}.txt`);
      try {
        const text = fs.readFileSync(txtFile, 'utf-8').trim();
        try { fs.unlinkSync(txtFile); } catch { /* ignore */ }
        if (text) {
          log.info(`Whisper: "${text.substring(0, 60)}"`);
          resolve({ ok: true, text });
        } else {
          resolve({ ok: false, error: 'No transcription result' });
        }
      } catch {
        resolve({ ok: false, error: 'Whisper output file not found' });
      }
    });
  });
}
