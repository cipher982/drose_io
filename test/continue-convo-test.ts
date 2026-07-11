#!/usr/bin/env bun
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'temp_dev_password_123';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log('🧪 Testing continue-after-bounce');
  const visitorId = `continue-test-${Date.now()}`;

  const fb = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      type: 'message',
      text: 'please reply later',
      page: '/',
      email: 'visitor@example.com',
    }),
  });
  assert(fb.ok, `feedback ${fb.status}`);
  const fbData = await fb.json();
  assert(!!fbData.continueUrl, 'missing continueUrl');
  assert(!!fbData.continueToken, 'missing token');
  assert(fbData.contactEmail === 'visitor@example.com', 'email not stored');

  const token = fbData.continueToken;
  const page = await fetch(`${API_BASE}/m/${token}`);
  assert(page.ok, `continue page ${page.status}`);
  const html = await page.text();
  assert(html.includes('please reply later'), 'message missing on page');
  assert(!html.includes(visitorId), 'visitorId leaked into page');

  const post = await fetch(`${API_BASE}/m/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'follow-up from continue page' }),
  });
  assert(post.ok, `continue post ${post.status}`);

  const msgs = await fetch(`${API_BASE}/api/threads/${visitorId}/messages`);
  const msgData = await msgs.json();
  assert(
    msgData.messages.some((m: any) => m.text === 'follow-up from continue page'),
    'follow-up not stored'
  );

  const reply = await fetch(`${API_BASE}/api/admin/threads/${visitorId}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_PASSWORD}`,
    },
    body: JSON.stringify({ text: 'here is my reply' }),
  });
  assert(reply.ok, `reply ${reply.status}`);
  const replyData = await reply.json();
  assert(replyData.emailStatus === 'skipped' || replyData.emailStatus === 'sent', `unexpected emailStatus ${replyData.emailStatus}`);
  assert(replyData.emailed === (replyData.emailStatus === 'sent'), 'emailed should match sent status');

  await fetch(`${API_BASE}/api/admin/threads/${visitorId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ADMIN_PASSWORD}` },
  });

  const gone = await fetch(`${API_BASE}/m/${token}`);
  assert(gone.status === 404, 'token should 404 after delete');

  console.log('✅ continue-after-bounce tests passed');
}

run().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
