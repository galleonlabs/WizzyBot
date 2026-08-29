.PHONY: test build ci typecheck

test:
	npx vitest run

build:
	npx tsc -p tsconfig.build.json && node scripts/bundle-cli.mjs

typecheck:
	npx tsc --noEmit -p tsconfig.json

ci:
	bash scripts/ci.sh
