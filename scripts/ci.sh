#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npx vitest run
npx tsc -p tsconfig.build.json
node scripts/bundle-cli.mjs
node scripts/bundle-hosted.mjs
node scripts/prove-eve-eval.mjs
