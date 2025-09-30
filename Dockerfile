FROM oven/bun:1 as base
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY server ./server
COPY public ./public

# Expose port
EXPOSE 3000

# Start server
CMD ["bun", "run", "server/index.ts"]
