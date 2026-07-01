# Platform Support Matrix

> **Single source of truth** for what works on which operating
> system. Code (`src/platform/capabilities.ts`) and docs read from
> this table. Update this file whenever a platform-related feature
> ships, is removed, or changes status.

## Tier Definitions

- **Tier 1 — required:** First-class platform. CI is required and
  green. Release blocker.
- **Tier 2 — best effort:** Supported when convenient. CI may be
  best-effort. Not a release blocker.
- **Unsupported:** Not maintained. May happen to work; no guarantees.

## Platforms

| Platform | Tier | Notes |
|----------|------|-------|
| macOS Apple Silicon (arm64) | Tier 1 — required | Primary platform. Signed and notarized. |
| Windows 11 x64 | Tier 1 — required | Supported with required CI, startup smoke coverage, and unsigned official installer/portable builds. |
| Linux x64 | Tier 2 — best effort | Functional but not a release blocker. |
| Windows 11 ARM64 | Tier 2 — best effort | Best-effort packaging only. |
| macOS Intel | Unsupported | Not built or tested. |

## Status Legend

- `supported` — implemented, tested, and exercised in CI where
  applicable.
- `partial` — implemented with known gaps documented in the notes.
- `unsupported` — not implemented on this platform.
- `planned` — on the roadmap but no active work.

## Capability Matrix

| Capability | macOS | Windows | Linux | Notes |
|------------|-------|---------|-------|-------|
| App startup (`npm start` from source) | supported | supported | partial | Windows startup is covered by required verify and smoke checks. |
| Configurable Agent API port | supported | supported | supported | The default remains `8765`; local clients discover the configured port through Tandem bootstrap files, and remote agents use the Tailscale/private-network address plus the configured port. |
| Signed installer | supported | unsupported | unsupported | Windows installer and portable builds are official but unsigned; code signing is planned. |
| Auto-update | supported | partial | unsupported | Windows has a manual `electron-updater` check path and generated `latest.yml` metadata, but automatic update installation remains blocked until end-to-end update validation is complete. |
| Custom titlebar / window chrome | supported | supported | supported | Windows source and packaged runs use frameless shell-owned controls. |
| Stealth UA matches host OS | supported | supported | partial | Windows presents a Chrome-on-Windows UA persona. |
| Chrome bookmark + history import | supported | supported | partial | Windows source runs scan `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\` for bookmark and history import. |
| Chrome cookie import | partial | unsupported | partial | Windows encrypted cookie import requires DPAPI support and is intentionally not implemented in phase 8; no risky dependency was added. |
| Native messaging host detection | supported | supported | supported | Windows reads Chrome native messaging host registry keys under HKCU/HKLM and keeps the filesystem fallback. |
| Voice transcription | supported | partial | partial | Windows source runs can use user-installed `whisper.exe` on `PATH`; Tandem does not bundle Whisper or download models. |
| Video recorder with system audio | supported | unsupported | partial | Windows phase 11 spike found that the current `ffmpeg-static` binary exposes DirectShow capture but no WASAPI input, and this machine has no DirectShow loopback/system-audio device. |
| Keyboard shortcuts and labels | supported | supported | supported | Windows source runs show platform-aware `Ctrl` labels while preserving Electron `CommandOrControl` accelerators. |
| Secrets at rest | supported | supported | supported | Windows uses the safeStorage-backed secret store with plaintext-initialization fallback records. |
| User data directory | supported | supported | supported | Windows user data resolves under `%APPDATA%\Tandem Browser`. |

## How to Update This File

1. Edit the relevant cell.
2. If a row flips to `supported` on Windows, also flip the matching
   value in `src/platform/capabilities.ts` so the UI hides or shows
   the feature accordingly.
3. Mention the change in `CHANGELOG.md` for the same release.
4. If a capability is removed or downgraded on macOS, treat it as a
   release blocker and revert unless a maintainer signs off.
