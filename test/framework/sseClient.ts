export type SSEChunk = {
  kind: 'event' | 'comment';
  raw: string[];
  event?: string;
  data?: string;
  id?: string;
};

export interface SSEClientOptions {
  headers?: Record<string, string>;
  fetchOptions?: RequestInit;
  label?: string;
  defaultTimeoutMs?: number;
  onChunk?: (chunk: SSEChunk) => void;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Minimal SSE client built on fetch() streaming.
 */
export class SSEClient {
  private readonly url: string;
  private readonly options: SSEClientOptions;
  private controller: AbortController | null = null;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private consumePromise?: Promise<void>;
  private closed = false;
  private queue: SSEChunk[] = [];
  private waiters: Array<(value: SSEChunk) => void> = [];

  constructor(url: string, options: SSEClientOptions = {}) {
    this.url = url;
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.consumePromise) return;

    this.controller = new AbortController();
    const { headers = {}, fetchOptions = {} } = this.options;

    const openTask = async () => {
      try {
        const response = await fetch(this.url, {
          ...fetchOptions,
          headers: {
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            ...fetchOptions.headers,
            ...headers,
          },
          signal: this.controller?.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error('SSE response has no body');
        }

        this.reader = response.body.getReader();
        await this.consume();
      } catch (error) {
        if (this.closed) return;
        this.emit({ kind: 'comment', raw: ['[sse-client] error'], data: (error as Error)?.message });
        throw error;
      }
    };

    this.consumePromise = openTask();
  }

  async waitFor(
    predicate: (chunk: SSEChunk) => boolean,
    timeoutMs: number = this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<SSEChunk> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('Timed out waiting for SSE chunk');
      }
      const chunk = await this.next(remaining);
      if (predicate(chunk)) {
        return chunk;
      }
    }
  }

  async next(timeoutMs?: number): Promise<SSEChunk> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }

    const effectiveTimeout = timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (effectiveTimeout <= 0) {
      throw new Error('Timed out waiting for SSE chunk');
    }

    return new Promise<SSEChunk>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(resolve);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error('Timed out waiting for SSE chunk'));
      }, effectiveTimeout);

      this.waiters.push((chunk) => {
        clearTimeout(timer);
        resolve(chunk);
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      this.controller?.abort();
    } catch (_) {
      /* no-op */
    }

    try {
      await this.reader?.cancel();
    } catch (_) {
      /* no-op */
    }

    await this.consumePromise?.catch(() => {});

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter({ kind: 'comment', raw: ['[sse-client] closed'] });
      }
    }
  }

  private emit(chunk: SSEChunk) {
    this.options.onChunk?.(chunk);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
    } else {
      this.queue.push(chunk);
    }
  }

  private async consume(): Promise<void> {
    if (!this.reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let rawLines: string[] = [];
    let eventName = 'message';
    let dataLines: string[] = [];
    let id: string | undefined;

    const flushEvent = () => {
      if (rawLines.length === 0 && dataLines.length === 0 && !id) {
        eventName = 'message';
        return;
      }

      const chunk: SSEChunk = {
        kind: 'event',
        raw: [...rawLines],
        event: eventName,
        data: dataLines.join('\n'),
        id,
      };

      this.emit(chunk);

      rawLines = [];
      dataLines = [];
      id = undefined;
      eventName = 'message';
    };

    while (!this.closed) {
      const { value, done } = await this.reader.read();
      if (done) {
        if (dataLines.length > 0 || rawLines.length > 0) {
          flushEvent();
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          break;
        }

        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }

        if (line === '') {
          flushEvent();
          continue;
        }

        if (line.startsWith(':')) {
          const comment = line.slice(1).trimStart();
          this.emit({ kind: 'comment', raw: [line], data: comment });
          continue;
        }

        rawLines.push(line);

        const colonIndex = line.indexOf(':');
        let field: string;
        let value: string;

        if (colonIndex === -1) {
          field = line;
          value = '';
        } else {
          field = line.slice(0, colonIndex);
          value = line.slice(colonIndex + 1);
          if (value.startsWith(' ')) {
            value = value.slice(1);
          }
        }

        switch (field) {
          case 'event':
            eventName = value || 'message';
            break;
          case 'data':
            dataLines.push(value);
            break;
          case 'id':
            id = value;
            break;
          default:
            break;
        }
      }
    }
  }
}
