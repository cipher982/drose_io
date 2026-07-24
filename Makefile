.PHONY: help dev test smoke deploy optimize-images

help:
	@echo "drose.io"
	@echo ""
	@echo "  make dev              run the site locally on :3000"
	@echo "  make test             unit tests (no server needed)"
	@echo "  make smoke            verify a deployment matches this checkout"
	@echo "  make deploy           deploy to clifford, then smoke-test it"
	@echo "  make optimize-images  recompress blog images (idempotent)"
	@echo ""
	@echo "  BASE=http://localhost:3000 make smoke   check a local instance"

dev:
	@bun run server/index.ts

test:
	@bun test test/analytics-identity.test.ts

BASE ?= https://drose.io

smoke:
	@bun run scripts/smoke.ts $(BASE)

# The only deploy path. manual-app syncs the working tree to clifford and
# rebuilds the container; smoke then proves production is actually serving this
# checkout, byte for byte. A failing smoke fails the target.
deploy:
	@~/git/me/domains/mytech/bin/manual-app deploy david-site --repo-dir .
	@echo ""
	@bun run scripts/smoke.ts $(BASE)

optimize-images:
	@bun run scripts/optimize-blog-images.ts
