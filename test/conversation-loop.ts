#!/usr/bin/env bun
/**
 * Automated conversation loop test
 * Simulates back-and-forth messages between visitor and admin
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'temp_dev_password_123';
const ITERATIONS = parseInt(process.env.ITERATIONS || '5');
const DELAY_MS = parseInt(process.env.DELAY_MS || '2000');

function log(message: string, emoji = '📝') {
  console.log(`${emoji} ${new Date().toLocaleTimeString()}: ${message}`);
}

async function sendMessage(visitorId: string, text: string) {
  const response = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      type: 'message',
      text,
      page: '/test-loop',
    }),
  });

  if (!response.ok) throw new Error(`Send failed: ${response.status}`);
  return response.json();
}

async function adminReply(visitorId: string, text: string) {
  const response = await fetch(`${API_BASE}/api/admin/threads/${visitorId}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_PASSWORD}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) throw new Error(`Reply failed: ${response.status}`);
  return response.json();
}

async function getMessageCount(visitorId: string): Promise<number> {
  const response = await fetch(`${API_BASE}/api/threads/${visitorId}/messages`);
  if (!response.ok) return 0;

  const data = await response.json();
  return data.messages?.length || 0;
}

async function runConversationLoop() {
  const visitorId = `loop-test-${Date.now()}`;

  log(`Starting conversation loop (${ITERATIONS} iterations)`, '🚀');
  log(`Visitor ID: ${visitorId}`, '👤');
  log(`Delay between messages: ${DELAY_MS}ms`, '⏱️');
  log('');

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      // Visitor sends message
      const visitorMsg = `Message #${i + 1}: This is test iteration ${i + 1}`;
      log(`Visitor sends: "${visitorMsg}"`, '👤');
      await sendMessage(visitorId, visitorMsg);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      // Admin replies
      const adminMsg = `Reply #${i + 1}: Got your message! (iteration ${i + 1})`;
      log(`Admin replies: "${adminMsg}"`, '💬');
      await adminReply(visitorId, adminMsg);
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));

      // Verify count
      const count = await getMessageCount(visitorId);
      const expected = (i + 1) * 2;
      if (count !== expected) {
        throw new Error(`Expected ${expected} messages, got ${count}`);
      }
      log(`Verified: ${count} messages in thread`, '✓');
      log('');
    }

    log(`✅ Conversation loop completed successfully!`, '🎉');
    log(`Total messages: ${ITERATIONS * 2}`, '📊');
    log(`View thread: ${API_BASE}/api/threads/${visitorId}/messages`, '🔗');

    return true;

  } catch (error) {
    log(`❌ Test failed: ${error instanceof Error ? error.message : String(error)}`, '💥');
    return false;
  }
}

// Run the loop
runConversationLoop().then(success => {
  process.exit(success ? 0 : 1);
});
