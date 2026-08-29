.PHONY: test build ci typecheck

test:
	npx vitest run

build:
	npx tsc -p tsconfig.build.json && node scripts/bundle-cli.mjs && node scripts/bundle-hosted.mjs

typecheck:
	npx tsc --noEmit -p tsconfig.node.json

ci:
	bash scripts/ci.sh
