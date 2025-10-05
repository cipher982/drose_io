import { SSEClient } from './sseClient';
import { sendVisitorMessage, sendAdminReply, getConnectionStats, ConnectionStats } from './api';
import { generateVisitorId } from './utils';

export interface LiveChatTestConfig {
  baseUrl: string;
  adminPassword: string;
  visitorId?: string;
  visitorMessage?: string;
  adminMessage?: string;
  timeoutMs?: number;
  logger?: (message: string) => void;
  adminStreamPath?: string;
  visitorStreamPath?: (visitorId: string) => string;
}

export interface LiveChatTestResult {
  ok: boolean;
  visitorEventReceived: boolean;
  adminEventReceived: boolean;
  visitorEventData?: unknown;
  adminEventData?: unknown;
  visitorId: string;
  details: string[];
}

interface TimelineEntry {
  label: string;
  start: number;
  end?: number;
}

export class LiveChatTester {
  private readonly config: LiveChatTestConfig;
  private readonly log: (message: string) => void;

  constructor(config: LiveChatTestConfig) {
    this.config = config;
    this.log = config.logger ?? (() => {});
  }

  async run(): Promise<LiveChatTestResult> {
    const visitorId = this.config.visitorId ?? generateVisitorId();
    const timeoutMs = this.config.timeoutMs ?? 8000;
    const details: string[] = [];

    const visitorStreamUrl = this.config.visitorStreamPath
      ? this.config.visitorStreamPath(visitorId)
      : `${this.config.baseUrl}/api/threads/${visitorId}/stream`;

    const adminStreamUrl = `${this.config.baseUrl}${
      this.config.adminStreamPath ?? `/api/admin/stream?auth=${encodeURIComponent(this.config.adminPassword)}`
    }`;

    this.log(`👤 Visitor ID: ${visitorId}`);
    this.log(`🔌 Visitor stream: ${visitorStreamUrl}`);
    this.log(`🔌 Admin stream: ${adminStreamUrl}`);

    const visitorClient = new SSEClient(visitorStreamUrl, {
      label: 'visitor',
      defaultTimeoutMs: timeoutMs,
      onChunk: (chunk) => {
        if (chunk.kind === 'comment') {
          details.push(`[visitor] comment: ${chunk.data ?? ''}`);
        } else {
          details.push(`[visitor] event: ${chunk.event ?? 'message'} ${chunk.data ?? ''}`);
        }
      },
    });

    const adminClient = new SSEClient(adminStreamUrl, {
      label: 'admin',
      defaultTimeoutMs: timeoutMs,
      onChunk: (chunk) => {
        if (chunk.kind === 'comment') {
          details.push(`[admin] comment: ${chunk.data ?? ''}`);
        } else {
          details.push(`[admin] event: ${chunk.event ?? 'message'} ${chunk.data ?? ''}`);
        }
      },
    });

    const timeline: TimelineEntry[] = [];
    const startSpan = (label: string) => {
      const entry: TimelineEntry = { label, start: Date.now() };
      timeline.push(entry);
      return () => {
        entry.end = Date.now();
        const duration = entry.end - entry.start;
        this.log(`⏱️ ${label} completed in ${duration}ms`);
      };
    };

    let visitorEventReceived = false;
    let adminEventReceived = false;
    let visitorEventData: unknown;
    let adminEventData: unknown;

    try {
      await adminClient.connect();
      await this.waitForConnectionCount('admin connection', timeoutMs, (stats) => stats.admins >= 1);
      this.log('🟢 Admin SSE registered');

      await visitorClient.connect();
      await this.waitForConnectionCount('visitor connection', timeoutMs, (stats) => stats.visitors >= 1);
      this.log('🟢 Visitor SSE registered');

      const visitorMessage = this.config.visitorMessage ?? `Visitor hello @ ${new Date().toISOString()}`;
      const adminMessage = this.config.adminMessage ?? `Admin response @ ${new Date().toISOString()}`;

      const finishVisitorSend = startSpan('Visitor sends message');
      const visitorSendResult = await sendVisitorMessage(this.config.baseUrl, visitorId, visitorMessage);
      finishVisitorSend();
      this.log(`📤 Visitor message sent (${visitorSendResult.messageId})`);

      const adminWaitStop = startSpan('Admin waits for visitor message');
      const adminChunk = await adminClient.waitFor((chunk) => {
        if (chunk.kind !== 'event') return false;
        if ((chunk.event ?? 'message') !== 'new-message') return false;
        if (!chunk.data) return false;
        try {
          const data = JSON.parse(chunk.data);
          if (data?.visitorId !== visitorId) return false;
          if (data?.message?.id !== visitorSendResult.messageId) return false;
          adminEventData = data;
          return true;
        } catch (_) {
          return false;
        }
      }, timeoutMs);
      adminWaitStop();
      adminEventReceived = Boolean(adminChunk);
      this.log('✅ Admin stream received visitor message');

      const finishAdminSend = startSpan('Admin sends reply');
      const adminReplyResult = await sendAdminReply(
        this.config.baseUrl,
        this.config.adminPassword,
        visitorId,
        adminMessage,
      );
      finishAdminSend();
      this.log(`📥 Admin reply sent (${adminReplyResult.messageId})`);

      const visitorWaitStop = startSpan('Visitor waits for admin reply');
      await visitorClient.waitFor((chunk) => {
        if (chunk.kind !== 'event') return false;
        const eventName = chunk.event ?? 'message';
        if (eventName !== 'new-message') return false;
        if (!chunk.data) return false;
        try {
          const data = JSON.parse(chunk.data);
          if (data?.type !== 'new-message') return false;
          if (data?.message?.id !== adminReplyResult.messageId) return false;
          visitorEventData = data;
          return true;
        } catch (_) {
          return false;
        }
      }, timeoutMs);
      visitorWaitStop();
      visitorEventReceived = true;
      this.log('✅ Visitor stream received admin reply');

      return {
        ok: visitorEventReceived && adminEventReceived,
        visitorEventReceived,
        adminEventReceived,
        visitorEventData,
        adminEventData,
        visitorId,
        details,
      };
    } finally {
      await visitorClient.close();
      await adminClient.close();
      timeline
        .filter((entry) => entry.end)
        .forEach((entry) => {
          const duration = (entry.end ?? entry.start) - entry.start;
          details.push(`[timeline] ${entry.label}: ${duration}ms`);
        });
    }
  }

  private async waitForConnectionCount(
    label: string,
    timeoutMs: number,
    predicate: (stats: ConnectionStats) => boolean,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const stats = await getConnectionStats(this.config.baseUrl);
      if (predicate(stats)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
}
