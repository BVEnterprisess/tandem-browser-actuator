#!/usr/bin/env bash
# One-command Wingman launch from WSL on the gtx1660 rig.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$ROOT/deploy/gtx1660/launch.js" "$@"
