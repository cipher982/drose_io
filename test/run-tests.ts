#!/usr/bin/env bun
/**
 * Simple test runner - runs quick API tests
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

const tests = [
  {
    name: 'Health endpoint',
    fn: async () => {
      const res = await fetch(`${API_BASE}/api/health`);
      const data = await res.json();
      return res.ok && data.status === 'ok';
    }
  },
  {
    name: 'Feedback endpoint (ping)',
    fn: async () => {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: 'quick-test',
          type: 'ping',
          page: '/test'
        })
      });
      const data = await res.json();
      return res.ok && data.success;
    }
  },
  {
    name: 'Feedback endpoint (message)',
    fn: async () => {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: 'quick-test',
          type: 'message',
          text: 'Quick test message',
          page: '/test'
        })
      });
      const data = await res.json();
      return res.ok && data.success && data.messageId;
    }
  },
  {
    name: 'Get messages endpoint',
    fn: async () => {
      const res = await fetch(`${API_BASE}/api/threads/quick-test/messages`);
      const data = await res.json();
      return res.ok && Array.isArray(data.messages);
    }
  },
];

async function runTests() {
  console.log('🧪 Running quick test suite...\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        console.log(`✓ ${test.name}`);
        passed++;
      } else {
        console.log(`✗ ${test.name}`);
        failed++;
      }
    } catch (error) {
      console.log(`✗ ${test.name}: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
  return failed === 0;
}

runTests().then(success => process.exit(success ? 0 : 1));
