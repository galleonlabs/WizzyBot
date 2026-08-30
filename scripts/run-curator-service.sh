#!/usr/bin/env bash
set -euo pipefail

: "${UNABOT_BUN_BIN:?UNABOT_BUN_BIN is required}"

"${UNABOT_BUN_BIN}" src/curator/cli.ts
