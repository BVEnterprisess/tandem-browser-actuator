# gtx1660 — Wingman production path (Windows 10 + WSL2)

This is the designed Tandem + OpenClaw path on the owner's rig. It is not a
Windows 11 upgrade path and it is not "patch the portable 1.10.0 asar."

## Hardware the profile is tuned for

| Item | Value |
|------|--------|
| OS | Windows 10 Home, build 19045 |
| CPU | Intel Core i7-3770K, 4C/8T (Ivy Bridge) |
| Host RAM | 16 GB |
| GPU | NVIDIA GTX 1660 6 GB, driver 32.0.15.6094 |
| WSL2 | Ubuntu, `memory=12GB`, `processors=6`, `localhostForwarding=true` |
| Desktop label | gtx1660 |
| Worker | GTX-1660 (`/home/jp`) |

WSL already owns **12 GB of 16 GB** and **6 of 8 threads**. The leftover
Windows budget for Electron is tight. That is why this fork no longer uses
the upstream `--max-old-space-size=4096` on this machine.

## Designed start sequence

```
Windows 10
  └── Tandem Browser (Electron, ANGLE D3D11, GTX 1660)
        ├── HTTP API 127.0.0.1:8765
        ├── Wingman panel (OpenClawBackend webchat)
        └── userData %APPDATA%\Tandem Browser   (NTFS, not /mnt/c)

WSL2 Ubuntu
  └── openclaw-gateway.service :18789
        └── ~/.openclaw/openclaw.json   (live token + models)
```

1. OpenClaw gateway is live in WSL (`systemctl --user start openclaw-gateway`).
2. Tandem compiles on ext4, then **Windows** `electron.exe` starts with
   `TANDEM_PERF_PROFILE=gtx1660`.
3. Wingman opens `ws://127.0.0.1:18789` (localhost forwarding).
4. Gateway sends `connect.challenge` with a nonce.
5. Shell calls `GET /config/openclaw-connect?nonce=…`.
6. Main process signs the v3 device payload with
   `gateway.auth.token` from the **WSL** config (not
   `C:\Users\johnh\.openclaw\openclaw.json`).
7. Wingman chat, approvals, and co-browse stay on that operator session.

### One command

From WSL on this machine:

```bash
cd /path/to/tandem-browser-actuator
npm install          # first time only
npm run launch:wingman
```

From Windows PowerShell (NT path, not `/mnt/c/...`):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\TandemBrowser-gtx1660\deploy\gtx1660\launch-wingman.ps1"
```

That path is `C:\Users\johnh\AppData\Local\TandemBrowser-gtx1660`. Do not paste `/home/jp/...` into PowerShell. The script skips Windows compile when `dist\main.js` is already present (WSL builds that tree).

`npm run launch:wingman` from WSL still copies through `/mnt/c/...`, but the
PowerShell `-RepoRoot` handoff is converted to
`C:\Users\johnh\AppData\Local\TandemBrowser-gtx1660`.

The OpenClaw config integrity monitor polls the live WSL UNC file instead of
`fs.watch` (`EISDIR` on Win10). Token resolution still prefers that WSL file.

`npm run start:gtx1660` is the same profile without the WSL gateway + NTFS
sync orchestration. Use it only when the gateway is already up and you are
already on the Windows tree.

### Required paths

| Path | Role |
|------|------|
| `/home/jp/.openclaw/openclaw.json` | Live OpenClaw gateway token + models |
| `\\wsl$\Ubuntu\home\jp\.openclaw\openclaw.json` | Same file as seen from Windows Electron |
| `C:\Users\johnh\.openclaw\openclaw.json` | Stale 112-byte stub. Resolver ignores it when the WSL file scores higher. |
| `%APPDATA%\Tandem Browser\` | Tandem userData, cookies, partitions |
| `%APPDATA%\Tandem Browser\Cache` | Chromium disk cache (NTFS) |
| `%APPDATA%\Tandem Browser\config.json` | `npm run launch:wingman` forces `general.activeBackend=openclaw` |
| `%LOCALAPPDATA%\TandemBrowser-gtx1660\` | Windows deploy tree (Electron + `node_modules`) |

Override the config path with `TANDEM_OPENCLAW_CONFIG` if you must. Do not
commit tokens.

## Performance knobs

Set by `TANDEM_PERF_PROFILE=gtx1660` / `--tandem-profile=gtx1660`:

| Knob | Value | Why |
|------|--------|-----|
| `--js-flags=--max-old-space-size=384` | 384 MB / renderer | Upstream 4096 MB cannot coexist with a 12 GB WSL VM on 16 GB host RAM |
| `--renderer-process-limit=3` | 3 | 4C/8T with WSL holding 6 threads |
| `--process-per-site` | on | Fewer Chromium processes than process-per-site-instance |
| `--use-angle=d3d11` | D3D11 | Stable Win10 19045 + GTX 1660 path (not D3D12-only, not WSLg) |
| `--enable-gpu-rasterization` / `--enable-zero-copy` | on | Compositor on the 1660 |
| `--enable-accelerated-video-decode` | on | NVDEC |
| `--ignore-gpu-blocklist` | on | Older Win10 GPU blocklist false positives |
| `--disk-cache-dir` | `%APPDATA%\Tandem Browser\Cache` | Avoid WSL↔NTFS 9P thrash |
| `--disk-cache-size` | 128 MB | Mid-RAM host |
| Site isolation | **left on** | Speed is not bought by stripping the perimeter |

Affinity pinning is **off** by default. WSL already pins 6 logical processors;
stealing the remaining two from the GPU compositor is a regression risk.

The biggest remaining RAM lever is WSL itself (`~/.wslconfig memory=12GB`).
This repo does not change that file. Dropping WSL to 8 GB for a Tandem session
would give Windows more headroom; do it only if you accept less OmniRoute /
gateway cache.

## Before / after (measured on this worker, 2026-09-23)

| Signal | Before (upstream default on this fork) | After (gtx1660 profile) |
|--------|----------------------------------------|-------------------------|
| Renderer V8 heap cap | 4096 MB (would OOM / swap against 4 GB leftover) | 384 MB |
| OpenClaw detect | `GET /v1/status` → **404** | `GET /health` → `{ ok:true, status:"live" }` |
| Wingman token source | Windows stub `zNgy…` (Jul 16, stale) | WSL live `gateway.auth.token` |
| Activity webhook `/api/sessions/main/events` | 404 on current OpenClaw (non-blocking) | Still optional; chat uses designed WS handshake |
| Gateway bind | `0.0.0.0:18789` in WSL, localhost-forwarded | unchanged |
| Host RAM | 16 GB (WSL 12 GB + ~4 GB Windows) | same; Tandem now sized for the remnant |
| Cold compile (WSL, no node_modules yet) | depends on `npm install` | `npm run compile` after install |
| Disk cache | Chromium default, may follow launch cwd | Forced to NTFS AppData |

Cold start of the full Windows Electron GUI was not timed from this WSL-only
agent session (no desktop attached). The profile change is reasoned from the
live host inventory: 16 GB RAM, WSL 12 GB, 8 host threads / 6 WSL threads,
GTX 1660 + Win10 D3D11. After `npm run launch:wingman`, confirm:

```bash
curl -sS http://127.0.0.1:18789/health
# from Windows, after Tandem is up:
# curl -sS http://127.0.0.1:8765/config/openclaw-status
```

`openclaw-status` must show `ok: true`, `hasToken: true`, `source: wsl-unc`
(or `env` if you overrode the path), and a token preview that is **not** the
old Windows stub.

From WSL, if `http://127.0.0.1:8765` misses the Windows bind:

```bash
npm run probe:api
# prints the first reachable http://<host>:8765
```

## Chrome identities (Samwise + Black Vault)

Cookies are the identity. Modern Chrome on this box stores them at
`<Profile>/Network/Cookies` (DPAPI) and bookmarks at `AccountBookmarks`.
Tandem does **not** decrypt DPAPI. The designed path is CDP:

1. Close any Chrome started without a debug port (a second launch on the
   same user-data-dir ignores `--remote-debugging-port`).
2. `npm run chrome:cdp -- --profile="Profile 6"` for Samwise, or
   `--profile=Default` for Black Vault Enterprises.
3. After Tandem is up: `POST /import/chrome/identities` with
   `{ "profiles": ["Default", "Profile 6"] }`.
4. Cookies land in `persist:session-chrome-default` and
   `persist:session-chrome-profile-6`. CDP can only see the Chrome
   instance currently on `:9222`, so import one profile at a time or
   pass `cdpProfile`.
5. This endpoint does **not** overwrite `bookmarks.json`.

Do not paste cookie values into chat or commit cookie files.

## What we refused to do

- Upgrade the host to Windows 11
- Disable site isolation or the 8-layer shield
- Bind the Agent API to `0.0.0.0` by default (the existing operator config
  may already do this; leave that as an explicit local choice)
- Pretend WSLg Linux Electron is the production GPU path
