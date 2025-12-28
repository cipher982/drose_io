FROM oven/bun:1 as base
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and scripts
COPY server ./server
COPY public ./public
COPY content ./content
COPY scripts ./scripts

# Run build-time tasks (like Umami injection)
RUN bun run build

# Expose port
EXPOSE 3000

# Start server using the start script which includes any runtime injections
CMD ["bun", "run", "start"]
