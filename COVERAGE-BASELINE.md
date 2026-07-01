# Coverage Baseline

Measured on **2026-04-09** with vitest v4.1.3 + @vitest/coverage-v8.

## Overall

| Metric     | Coverage |
|------------|----------|
| Statements | 29.55%   |
| Branches   | 24.11%   |
| Functions  | 25.15%   |
| Lines      | 29.92%   |

## Per Directory

| Directory              | % Stmts | % Branch | % Funcs | % Lines |
|------------------------|---------|----------|---------|---------|
| src                    |    0.00 |     0.00 |    0.00 |    0.00 |
| src/activity           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/agents             |   34.30 |    32.82 |   37.03 |   34.97 |
| src/api                |   63.84 |    44.90 |   67.44 |   67.09 |
| src/api/middleware      |   42.52 |    34.66 |   27.27 |   41.02 |
| src/api/routes         |   78.21 |    72.79 |   79.65 |   78.39 |
| src/auth               |    0.00 |     0.00 |    0.00 |    0.00 |
| src/behavior           |    9.40 |     9.43 |   21.73 |    9.82 |
| src/bookmarks          |    0.00 |     0.00 |    0.00 |    0.00 |
| src/bootstrap          |    0.00 |     0.00 |    0.00 |    0.00 |
| src/bridge             |    0.00 |     0.00 |    0.00 |    0.00 |
| src/claronote          |    0.00 |     0.00 |    0.00 |    0.00 |
| src/config             |   85.71 |    75.00 |   95.45 |   86.59 |
| src/content            |    0.00 |     0.00 |    0.00 |    0.00 |
| src/context-menu       |    0.00 |     0.00 |    0.00 |    0.00 |
| src/device             |    0.00 |     0.00 |    0.00 |    0.00 |
| src/devtools           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/downloads          |    0.00 |     0.00 |    0.00 |    0.00 |
| src/draw               |   35.66 |    18.03 |   35.00 |   36.76 |
| src/events             |    0.00 |     0.00 |    0.00 |    0.00 |
| src/extensions         |   13.61 |    11.07 |   13.79 |   13.55 |
| src/headless           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/history            |    0.00 |     0.00 |    0.00 |    0.00 |
| src/import             |    0.00 |     0.00 |    0.00 |    0.00 |
| src/input              |    1.63 |     0.00 |    0.00 |    1.75 |
| src/integrations       |   60.17 |    29.57 |   82.35 |   60.17 |
| src/ipc                |    0.00 |     0.00 |    0.00 |    0.00 |
| src/locators           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/mcp                |    0.00 |     0.00 |    0.00 |    0.00 |
| src/memory             |    0.00 |     0.00 |    0.00 |    0.00 |
| src/menu               |    0.00 |   100.00 |    0.00 |    0.00 |
| src/network            |   17.94 |     6.97 |   22.66 |   17.93 |
| src/notifications      |   20.00 |     0.00 |    0.00 |   20.00 |
| src/openclaw           |   11.39 |     8.00 |    7.69 |   11.68 |
| src/panel              |   46.66 |    32.18 |   34.61 |   47.36 |
| src/passwords          |    3.33 |     0.00 |    0.00 |    3.57 |
| src/pinboards          |    0.00 |     0.00 |    0.00 |    0.00 |
| src/pip                |    0.00 |     0.00 |    0.00 |    0.00 |
| src/scripts            |    0.00 |     0.00 |    0.00 |    0.00 |
| src/security           |   36.57 |    31.10 |   30.08 |   37.74 |
| src/security/analyzers |    0.00 |     0.00 |    0.00 |    0.00 |
| src/security/blocklists|   63.94 |    51.92 |   60.00 |   66.54 |
| src/session            |    0.00 |     0.00 |    0.00 |    0.00 |
| src/sessions           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/sidebar            |    0.00 |     0.00 |    0.00 |    0.00 |
| src/snapshot           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/stealth            |    0.00 |     0.00 |    0.00 |    0.00 |
| src/sync               |    0.00 |     0.00 |    0.00 |    0.00 |
| src/tabs               |   81.36 |    68.53 |   77.50 |   84.97 |
| src/utils              |   69.35 |    54.00 |   76.66 |   68.64 |
| src/video              |    0.00 |     0.00 |    0.00 |    0.00 |
| src/voice              |    0.00 |     0.00 |    0.00 |    0.00 |
| src/watch              |    0.00 |     0.00 |    0.00 |    0.00 |
| src/workflow           |    0.00 |     0.00 |    0.00 |    0.00 |
| src/workspaces         |    0.00 |     0.00 |    0.00 |    0.00 |

## Test Summary

- **Test files**: 36 (34 passed, 2 failed with pre-existing issues)
- **Tests**: 1185 (1142 passed, 4 failed, 39 skipped)
- **4 pre-existing failures**: 3 Windows path normalization issues in screenshot tests, 1 missing OpenClaw connect route

## Notes

- No minimum coverage thresholds are enforced yet — this baseline serves as the starting point for tracking coverage improvements.
- 28 out of 53 directories have 0% coverage.
- Best covered areas: src/api/routes (78%), src/config (86%), src/tabs (81%), src/utils (69%).
