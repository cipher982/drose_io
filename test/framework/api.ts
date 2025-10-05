export interface SendMessageResult {
  messageId: string;
  visitorId: string;
}

export interface ConnectionStats {
  visitors: number;
  admins: number;
  total: number;
}

export async function getConnectionStats(baseUrl: string): Promise<ConnectionStats> {
  const response = await fetch(`${baseUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  const data = await response.json();
  return data.connections as ConnectionStats;
}

export async function sendVisitorMessage(
  baseUrl: string,
  visitorId: string,
  text: string,
  page: string = '/test-realtime',
): Promise<SendMessageResult> {
  const response = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      type: 'message',
      text,
      page,
    }),
  });

  if (!response.ok) {
    throw new Error(`Visitor message failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data?.messageId) {
    throw new Error('Visitor message response missing messageId');
  }

  return {
    messageId: data.messageId,
    visitorId: data.visitorId ?? visitorId,
  };
}

export async function sendAdminReply(
  baseUrl: string,
  adminPassword: string,
  visitorId: string,
  text: string,
): Promise<SendMessageResult> {
  const response = await fetch(`${baseUrl}/api/admin/threads/${visitorId}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminPassword}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Admin reply failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data?.messageId) {
    throw new Error('Admin reply response missing messageId');
  }

  return {
    messageId: data.messageId,
    visitorId,
  };
}

export async function fetchVisitorMessages(baseUrl: string, visitorId: string) {
  const response = await fetch(`${baseUrl}/api/threads/${visitorId}/messages`);
  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.status}`);
  }
  const data = await response.json();
  return data?.messages ?? [];
}
