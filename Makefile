.PHONY: help install start stop restart status dev test test-watch test-full test-e2e test-e2e-ui test-e2e-debug test-e2e-headed test-all clean deploy docker-up docker-down docker-logs logs

PID_FILE := .server.pid
LOG_FILE := .server.log

# Read PORT from .env if it exists, otherwise default to 3000
PORT := $(shell grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000)

help:
	@echo "drose.io - Personal Portfolio & Pepper AI"
	@echo ""
	@echo "Server:"
	@echo "  make start        Start server in background"
	@echo "  make stop         Stop server"
	@echo "  make restart      Restart server"
	@echo "  make status       Check server status"
	@echo "  make logs         Tail server logs"
	@echo "  make dev          Start server in foreground (interactive)"
	@echo ""
	@echo "Testing:"
	@echo "  make test         Run automated test suite"
	@echo "  make test-watch   Watch and test continuously"
	@echo "  make test-full    Full integration test"
	@echo "  make test-e2e     Run Playwright e2e tests"
	@echo "  make test-all     Run all test suites"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up    Start docker compose"
	@echo "  make docker-down  Stop docker compose"
	@echo "  make docker-logs  Tail docker logs"
	@echo ""
	@echo "Other:"
	@echo "  make install      Install dependencies"
	@echo "  make deploy       Deploy to clifford"
	@echo "  make clean        Clean build artifacts"

install:
	bun install

dev:
	bun run scripts/inject-umami.ts && bun run server/index.ts

start:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "Server already running (PID $$(cat $(PID_FILE)))"; \
		grep -o 'http://[^[:space:]]*' $(LOG_FILE) 2>/dev/null | head -1 || echo "http://localhost:$(PORT)"; \
	else \
		bun run scripts/inject-umami.ts; \
		nohup bun run server/index.ts > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE); \
		for i in 1 2 3 4 5; do \
			if grep -q 'Server running' $(LOG_FILE) 2>/dev/null; then break; fi; \
			sleep 0.5; \
		done; \
		if kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
			URL=$$(grep -o 'http://[^[:space:]]*' $(LOG_FILE) | head -1); \
			echo ""; \
			echo "  $$URL"; \
			echo ""; \
		else \
			echo "Failed to start server:"; \
			cat $(LOG_FILE); \
			rm -f $(PID_FILE); \
			exit 1; \
		fi \
	fi

stop:
	@if [ -f $(PID_FILE) ]; then \
		PID=$$(cat $(PID_FILE)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill $$PID; \
			for i in 1 2 3 4 5; do \
				if ! kill -0 $$PID 2>/dev/null; then break; fi; \
				sleep 0.2; \
			done; \
			if kill -0 $$PID 2>/dev/null; then \
				kill -9 $$PID 2>/dev/null || true; \
			fi; \
			echo "Stopped"; \
		else \
			echo "Not running (stale pid)"; \
		fi; \
		rm -f $(PID_FILE); \
	else \
		PIDS=$$(pgrep -f "bun run server/index.ts" 2>/dev/null || true); \
		if [ -n "$$PIDS" ]; then \
			echo "$$PIDS" | xargs kill 2>/dev/null || true; \
			echo "Killed orphan: $$PIDS"; \
		else \
			echo "Not running"; \
		fi \
	fi

restart: stop start

status:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		URL=$$(grep -o 'http://[^[:space:]]*' $(LOG_FILE) 2>/dev/null | head -1 || echo "http://localhost:$(PORT)"); \
		echo "Running (PID $$(cat $(PID_FILE))) at $$URL"; \
	else \
		PIDS=$$(pgrep -f "bun run server/index.ts" 2>/dev/null || true); \
		if [ -n "$$PIDS" ]; then \
			echo "Running (orphan: $$PIDS)"; \
		else \
			echo "Not running"; \
		fi \
	fi

logs:
	@tail -f $(LOG_FILE)

test:
	@bun test/run-tests.ts

test-watch:
	@while true; do make test; sleep 5; done

test-full:
	@bun test/integration-test.ts

test-e2e:
	TEST_MODE=true bunx playwright test

test-e2e-debug:
	TEST_MODE=true bunx playwright test --debug

test-e2e-ui:
	TEST_MODE=true bunx playwright test --ui

test-e2e-headed:
	TEST_MODE=true bunx playwright test --headed

test-all:
	@make test && make test-full && make test-e2e

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

deploy:
	@git push origin main
	@rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' ./ clifford:~/drose_io/
	@ssh clifford "cd ~/drose_io && docker compose down && docker compose up --build -d"
	@echo "Deployed: https://drose.io"

clean:
	rm -rf node_modules data/threads/*.jsonl data/threads/test data/blocked/test
	rm -f bun.lockb $(PID_FILE) $(LOG_FILE)
