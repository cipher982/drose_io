#!/usr/bin/env bun
/**
 * Unread / mark-read / inbox health API tests
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'temp_dev_password_123';

function log(message: string, emoji = '📝') {
  console.log(`${emoji} ${message}`);
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function adminFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${ADMIN_PASSWORD}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function run() {
  log('Testing unread / mark-read / inbox health', '🧪');
  const visitorId = `unread-test-${Date.now()}`;

  // Visitor sends two messages
  for (const text of ['first unread', 'second unread']) {
    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, type: 'message', text, page: '/test' }),
    });
    assert(res.ok, `feedback failed: ${res.status}`);
  }

  let list = await adminFetch('/api/admin/threads');
  assert(list.ok, 'list threads failed');
  let data = await list.json();
  const thread = (data.threads || []).find((t: any) => t.visitorId === visitorId);
  assert(!!thread, 'thread not found in list');
  assert(thread.unreadFromVisitor === 2, `expected unread 2, got ${thread.unreadFromVisitor}`);

  let health = await adminFetch('/api/admin/inbox/health');
  assert(health.ok, 'inbox health failed');
  let healthData = await health.json();
  assert(healthData.ok === true, 'health.ok');
  assert(healthData.unreadTotal >= 2, `unreadTotal ${healthData.unreadTotal}`);
  assert(typeof healthData.openThreadCount === 'number', 'openThreadCount');

  // Mark read
  const readRes = await adminFetch(`/api/admin/threads/${visitorId}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(readRes.ok, `mark read failed: ${readRes.status}`);
  const readData = await readRes.json();
  assert(readData.unreadFromVisitor === 0, `expected 0 after read, got ${readData.unreadFromVisitor}`);
  assert(typeof readData.unreadTotal === 'number', 'unreadTotal on mark-read');

  list = await adminFetch('/api/admin/threads');
  data = await list.json();
  const after = (data.threads || []).find((t: any) => t.visitorId === visitorId);
  assert(after.unreadFromVisitor === 0, `list still shows unread ${after.unreadFromVisitor}`);

  // New message after read → unread 1
  const again = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId, type: 'message', text: 'after read', page: '/test' }),
  });
  assert(again.ok, 'follow-up feedback failed');

  list = await adminFetch('/api/admin/threads');
  data = await list.json();
  const againThread = (data.threads || []).find((t: any) => t.visitorId === visitorId);
  assert(againThread.unreadFromVisitor === 1, `expected unread 1, got ${againThread.unreadFromVisitor}`);

  // Cleanup
  const del = await adminFetch(`/api/admin/threads/${visitorId}`, { method: 'DELETE' });
  assert(del.ok, 'delete failed');

  list = await adminFetch('/api/admin/threads');
  data = await list.json();
  assert(!(data.threads || []).some((t: any) => t.visitorId === visitorId), 'thread still listed after delete');

  log('All unread/mark-read/health assertions passed', '✅');
}

run().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
