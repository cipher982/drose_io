FROM oven/bun:1 as base
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and scripts
COPY server ./server
COPY public ./public
COPY templates ./templates
COPY content ./content
COPY scripts ./scripts

# Create data directories for persistence
RUN mkdir -p /app/data/visitors /app/data/pepper-logs

# Expose port
EXPOSE 3000

# Templates render at runtime, so analytics env vars are available at render time
CMD ["bun", "run", "start"]
