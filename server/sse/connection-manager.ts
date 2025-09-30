/**
 * SSE Connection Manager
 * Tracks active SSE connections and broadcasts messages to relevant clients
 */

import { EventEmitter } from 'events';

interface SSEConnection {
  visitorId?: string;
  isAdmin?: boolean;
  stream: any; // Hono SSE stream
  lastActivity: number;
}

class ConnectionManager extends EventEmitter {
  private connections: Map<string, SSEConnection[]> = new Map();
  private adminConnections: SSEConnection[] = [];
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    super();

    // Cleanup stale connections every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupStale();
    }, 30000);
  }

  /**
   * Register a visitor connection
   */
  registerVisitor(visitorId: string, stream: any): () => void {
    const connection: SSEConnection = {
      visitorId,
      stream,
      lastActivity: Date.now(),
    };

    if (!this.connections.has(visitorId)) {
      this.connections.set(visitorId, []);
    }
    this.connections.get(visitorId)!.push(connection);

    console.log(`📡 Visitor ${visitorId.substring(0, 8)} connected (${this.getVisitorCount(visitorId)} active)`);

    // Return cleanup function
    return () => {
      this.removeConnection(visitorId, connection);
    };
  }

  /**
   * Register an admin connection
   */
  registerAdmin(stream: any): () => void {
    const connection: SSEConnection = {
      isAdmin: true,
      stream,
      lastActivity: Date.now(),
    };

    this.adminConnections.push(connection);
    console.log(`🔐 Admin connected (${this.adminConnections.length} active)`);

    // Return cleanup function
    return () => {
      const index = this.adminConnections.indexOf(connection);
      if (index > -1) {
        this.adminConnections.splice(index, 1);
        console.log(`🔐 Admin disconnected (${this.adminConnections.length} active)`);
      }
    };
  }

  /**
   * Broadcast message to all connections for a visitor
   */
  notifyVisitor(visitorId: string, message: any): void {
    const connections = this.connections.get(visitorId);
    if (!connections || connections.length === 0) {
      return;
    }

    connections.forEach(conn => {
      try {
        conn.stream.writeSSE({ data: JSON.stringify(message) });
        conn.lastActivity = Date.now();
      } catch (error) {
        console.error('Failed to send to visitor connection:', error);
      }
    });

    console.log(`📤 Notified ${connections.length} connection(s) for visitor ${visitorId.substring(0, 8)}`);
  }

  /**
   * Broadcast to all admin connections
   */
  notifyAdmins(event: string, data: any): void {
    if (this.adminConnections.length === 0) {
      return;
    }

    this.adminConnections.forEach(conn => {
      try {
        conn.stream.writeSSE({
          event,
          data: JSON.stringify(data),
        });
        conn.lastActivity = Date.now();
      } catch (error) {
        console.error('Failed to send to admin connection:', error);
      }
    });

    console.log(`📤 Notified ${this.adminConnections.length} admin(s) of ${event}`);
  }

  /**
   * Remove a specific connection
   */
  private removeConnection(visitorId: string, connection: SSEConnection): void {
    const connections = this.connections.get(visitorId);
    if (!connections) return;

    const index = connections.indexOf(connection);
    if (index > -1) {
      connections.splice(index, 1);
      console.log(`📡 Visitor ${visitorId.substring(0, 8)} disconnected (${connections.length} remaining)`);

      if (connections.length === 0) {
        this.connections.delete(visitorId);
      }
    }
  }

  /**
   * Clean up stale connections (no activity for 5 minutes)
   */
  private cleanupStale(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    let cleaned = 0;

    // Clean visitor connections
    this.connections.forEach((connections, visitorId) => {
      const stale = connections.filter(c => c.lastActivity < fiveMinutesAgo);
      stale.forEach(conn => {
        this.removeConnection(visitorId, conn);
        cleaned++;
      });
    });

    // Clean admin connections
    this.adminConnections = this.adminConnections.filter(conn => {
      if (conn.lastActivity < fiveMinutesAgo) {
        cleaned++;
        return false;
      }
      return true;
    });

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} stale connections`);
    }
  }

  /**
   * Get number of active connections for a visitor
   */
  getVisitorCount(visitorId: string): number {
    return this.connections.get(visitorId)?.length || 0;
  }

  /**
   * Get total connection stats
   */
  getStats() {
    const visitorCount = Array.from(this.connections.values())
      .reduce((sum, conns) => sum + conns.length, 0);

    return {
      visitors: visitorCount,
      admins: this.adminConnections.length,
      total: visitorCount + this.adminConnections.length,
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Export singleton
export const connectionManager = new ConnectionManager();
