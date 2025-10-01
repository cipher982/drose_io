.PHONY: help install dev test test-watch test-full clean deploy docker-up docker-down docker-logs

help:
	@echo "drose.io - Feedback Widget System"
	@echo ""
	@echo "Commands:"
	@echo "  make install      Install dependencies"
	@echo "  make dev          Start development server"
	@echo "  make test         Run automated test suite"
	@echo "  make test-watch   Watch and test continuously"
	@echo "  make test-full    Full integration test with conversation flow"
	@echo "  make docker-up    Start docker compose"
	@echo "  make docker-down  Stop docker compose"
	@echo "  make docker-logs  Tail docker logs"
	@echo "  make deploy       Deploy to clifford"
	@echo "  make clean        Clean build artifacts"

install:
	bun install

dev:
	bun run dev

test:
	@echo "Running automated test suite..."
	@bun test/run-tests.ts

test-watch:
	@echo "Starting test watch mode..."
	@while true; do \
		make test; \
		sleep 5; \
	done

test-full:
	@echo "Running full integration test..."
	@bun test/integration-test.ts

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

deploy:
	@echo "Deploying to clifford..."
	@git push origin main
	@rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude '.env' ./ clifford:~/drose_io/
	@ssh clifford "cd ~/drose_io && docker compose down && docker compose up --build -d"
	@echo "Deployed! Check: http://5.161.97.53:8080"

clean:
	rm -rf node_modules
	rm -rf data/threads/*.jsonl
	rm -f bun.lockb
