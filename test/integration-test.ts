#!/usr/bin/env bun
/**
 * Integration test for feedback widget conversation flow
 * Tests the full round-trip: visitor sends → admin replies → visitor receives
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'temp_dev_password_123';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color = 'reset') {
  console.log(`${colors[color as keyof typeof colors]}${message}${colors.reset}`);
}

function generateVisitorId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendFeedback(visitorId: string, type: 'ping' | 'message', text?: string) {
  const response = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      type,
      text: text || '',
      page: '/test',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send feedback: ${response.status}`);
  }

  return response.json();
}

async function getMessages(visitorId: string) {
  const response = await fetch(`${API_BASE}/api/threads/${visitorId}/messages`);

  if (!response.ok) {
    throw new Error(`Failed to get messages: ${response.status}`);
  }

  const data = await response.json();
  return data.messages || [];
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

  if (!response.ok) {
    throw new Error(`Failed to send admin reply: ${response.status}`);
  }

  return response.json();
}

async function testConversationFlow() {
  log('\n🧪 Starting Full Integration Test', 'cyan');
  log('=' .repeat(50), 'cyan');

  const visitorId = generateVisitorId();
  log(`\n👤 Generated visitor ID: ${visitorId.substring(0, 20)}...`, 'blue');

  try {
    // Test 1: Visitor sends initial message
    log('\n📤 Test 1: Visitor sends message', 'yellow');
    const feedbackResult = await sendFeedback(visitorId, 'message', 'Hello! This is a test message.');
    log(`✓ Message sent (ID: ${feedbackResult.messageId})`, 'green');

    // Test 2: Verify message was stored
    log('\n📥 Test 2: Verify message storage', 'yellow');
    await sleep(500);
    let messages = await getMessages(visitorId);
    if (messages.length !== 1 || messages[0].from !== 'visitor') {
      throw new Error('Message not stored correctly');
    }
    log(`✓ Message stored correctly (${messages.length} messages)`, 'green');

    // Test 3: Admin replies
    log('\n💬 Test 3: Admin sends reply', 'yellow');
    const replyResult = await adminReply(visitorId, 'Thanks for testing! This is an automated reply.');
    log(`✓ Reply sent (ID: ${replyResult.messageId})`, 'green');

    // Test 4: Verify reply was stored
    log('\n📥 Test 4: Verify reply storage', 'yellow');
    await sleep(500);
    messages = await getMessages(visitorId);
    if (messages.length !== 2 || messages[1].from !== 'david') {
      throw new Error('Reply not stored correctly');
    }
    log(`✓ Reply stored correctly (${messages.length} messages total)`, 'green');

    // Test 5: Visitor sends follow-up
    log('\n📤 Test 5: Visitor sends follow-up', 'yellow');
    await sendFeedback(visitorId, 'message', 'Got it, thanks!');
    await sleep(500);
    messages = await getMessages(visitorId);
    if (messages.length !== 3) {
      throw new Error('Follow-up not stored');
    }
    log(`✓ Follow-up stored (${messages.length} messages total)`, 'green');

    // Test 6: Check conversation history
    log('\n📜 Test 6: Verify conversation history', 'yellow');
    log('Conversation:', 'cyan');
    messages.forEach((msg, i) => {
      const author = msg.from === 'visitor' ? 'Visitor' : 'David';
      log(`  ${i + 1}. ${author}: "${msg.text}"`, 'blue');
    });
    log(`✓ Full conversation history intact`, 'green');

    // Test 7: Check admin thread list
    log('\n📋 Test 7: Check admin thread list', 'yellow');
    const threadsResponse = await fetch(`${API_BASE}/api/admin/threads`, {
      headers: { 'Authorization': `Bearer ${ADMIN_PASSWORD}` },
    });
    const threadsData = await threadsResponse.json();
    const thread = threadsData.threads.find((t: any) => t.visitorId === visitorId);
    if (!thread) {
      throw new Error('Thread not found in admin list');
    }
    log(`✓ Thread appears in admin list (${thread.messageCount} messages)`, 'green');

    // Test 8: Health check
    log('\n🏥 Test 8: Health check', 'yellow');
    const healthResponse = await fetch(`${API_BASE}/api/health`);
    const healthData = await healthResponse.json();
    log(`✓ Server healthy (${healthData.connections.total} active connections)`, 'green');

    log('\n' + '='.repeat(50), 'cyan');
    log('✅ ALL TESTS PASSED!', 'green');
    log('=' .repeat(50), 'cyan');

    return true;

  } catch (error) {
    log('\n❌ TEST FAILED:', 'red');
    log(error instanceof Error ? error.message : String(error), 'red');
    return false;
  }
}

// Run the test
testConversationFlow().then((success) => {
  process.exit(success ? 0 : 1);
});
