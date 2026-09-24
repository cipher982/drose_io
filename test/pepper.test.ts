import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Isolate all storage before any server module loads.
const DIR = mkdtempSync(join(tmpdir(), 'pepper-test-'));
process.env.TEST_MODE = 'true';
process.env.THREADS_DIR = join(DIR, 'threads');
process.env.BLOCKED_DIR = join(DIR, 'blocked');
process.env.PEPPER_DIR = join(DIR, 'pepper');
process.env.OPENAI_API_KEY = 'test-key';
process.env.PEPPER_TELEGRAM_BOT_TOKEN = 'TESTTOKEN';
process.env.PEPPER_TELEGRAM_BOT_USERNAME = 'pepper_test_bot';
process.env.PEPPER_TELEGRAM_DESK_CHAT_ID = '-100123';
process.env.PEPPER_TELEGRAM_DAVID_USER_ID = '42';
process.env.PEPPER_TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
delete process.env.PEPPER_SES_ACCESS_KEY_ID;

const { default: pepper } = await import('../server/pepper/routes');
const { stripQuoted, parseInbound } = await import('../server/pepper/inbound');
const { sanitizeReply } = await import('../server/pepper/llm');
const store = await import('../server/pepper/store');
const { getMessages } = await import('../server/storage/threads');

// ---- fetch double: OpenAI returns the next queued reply; Telegram records calls
const realFetch = globalThis.fetch;
let modelReplies: any[] = [];
let tgCalls: { method: string; body: any }[] = [];
let topicCounter = 500;

beforeAll(() => {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('api.openai.com')) {
      const next = modelReplies.shift() ?? { say: 'woof', options: [], relay: null, contact_email: null };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }));
    }
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop()!;
      const body = JSON.parse(init.body);
      tgCalls.push({ method, body });
      const result = method === 'createForumTopic' ? { message_thread_id: ++topicCounter } : { message_id: 1 };
      return new Response(JSON.stringify({ ok: true, result }));
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as any;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(DIR, { recursive: true, force: true });
});
beforeEach(() => { modelReplies = []; tgCalls = []; });

const post = (path: string, body: any, headers: Record<string, string> = {}) =>
  pepper.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('model output is clamped to what the UI renders', () => {
  test('options capped at 3 and short; bad email dropped; empty relay ignored', () => {
    const r = sanitizeReply({ say: 'hi', options: ['a', 'b', 'c', 'd', 'x'.repeat(80)], relay: { message: '  ', summary: 's' }, contact_email: 'nope' });
    expect(r.options).toEqual(['a', 'b', 'c']);
    expect(r.relay).toBeNull();
    expect(r.contact_email).toBeNull();
  });
  test('valid email normalized', () => {
    expect(sanitizeReply({ say: 'x', options: [], relay: null, contact_email: ' Maya@Evals.dev ' }).contact_email).toBe('maya@evals.dev');
  });
});

describe('chat → relay → David replies from Telegram', () => {
  const vid = 'visitor-abc-123456';

  test('plain question: no relay, no thread message', async () => {
    modelReplies.push({ say: 'mostly agents *wag*', options: ['what is longhouse?'], relay: null, contact_email: null });
    const res = await post('/chat', { visitorId: vid, text: 'what does david build?', page: '/', via: 'typed' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.say).toBe('mostly agents *wag*');
    expect(json.options).toEqual(['what is longhouse?']);
    expect(json.relay).toBeNull();
    expect(getMessages(vid)).toHaveLength(0); // Pepper chat never pages David's inbox
  });

  test('relay writes the thread, opens a topic with a briefing, asks for contact', async () => {
    modelReplies.push({
      say: 'carrying this to david *grabs envelope*', options: [],
      relay: { message: 'Is David open to consulting on eval tooling?', summary: 'Consulting on eval tooling' },
      contact_email: null,
    });
    const res = await post('/chat', { visitorId: vid, text: 'yes please ask him', page: '/', via: 'option' });
    const json = await res.json();
    expect(json.relay).toEqual({ status: 'sent' });
    expect(json.askContact).toBe(true);
    expect(json.telegramLink).toMatch(/^https:\/\/t\.me\/pepper_test_bot\?start=[A-Za-z0-9_-]+$/);

    const thread = getMessages(vid);
    expect(thread.at(-1)).toMatchObject({ from: 'visitor', text: 'Is David open to consulting on eval tooling?' });
    expect(tgCalls.map(c => c.method)).toEqual(['createForumTopic', 'sendMessage']);
    expect(tgCalls[1].body.text).toContain('Consulting on eval tooling');
    expect(store.getVisitor(vid)?.topicId).toBe(topicCounter);
  });

  test('contact endpoint stores the email on the thread', async () => {
    const bad = await post('/contact', { visitorId: vid, email: 'not-an-email' });
    expect(bad.status).toBe(400);
    const ok = await post('/contact', { visitorId: vid, email: 'Maya@Evals.dev' });
    expect(await ok.json()).toEqual({ ok: true, email: 'maya@evals.dev' });
    const hist = await (await pepper.request(`/history?visitorId=${vid}`)).json();
    expect(hist.contactEmail).toBe('maya@evals.dev');
    expect(hist.relayed).toBe(true);
  });

  test('webhook rejects a wrong secret', async () => {
    const res = await post('/telegram', { message: {} }, { 'x-telegram-bot-api-secret-token': 'wrong' });
    expect(res.status).toBe(403);
  });

  test("David's topic reply lands in the thread and the chat, marked as David", async () => {
    const { handleTelegramUpdate } = await import('../server/pepper/routes');
    const topicId = store.getVisitor(vid)!.topicId!;
    await handleTelegramUpdate({ message: { chat: { id: -100123, type: 'supergroup' }, from: { id: 42 }, message_thread_id: topicId, text: 'Happy to chat, send times.' } });
    expect(getMessages(vid).at(-1)).toMatchObject({ from: 'david', text: 'Happy to chat, send times.' });
    expect(store.readChat(vid).at(-1)).toMatchObject({ from: 'david', text: 'Happy to chat, send times.' });
    expect(tgCalls.at(-1)!.body.message_thread_id).toBe(topicId); // delivery receipt back in the topic
  });

  test('someone else posting in the desk is ignored', async () => {
    const { handleTelegramUpdate } = await import('../server/pepper/routes');
    const before = getMessages(vid).length;
    await handleTelegramUpdate({ message: { chat: { id: -100123, type: 'supergroup' }, from: { id: 7 }, message_thread_id: store.getVisitor(vid)!.topicId, text: 'hijack' } });
    expect(getMessages(vid).length).toBe(before);
  });

  test('visitor links Telegram via /start and can write back', async () => {
    const { handleTelegramUpdate } = await import('../server/pepper/routes');
    const hist = await (await pepper.request(`/history?visitorId=${vid}`)).json();
    const token = new URL(hist.telegramLink).searchParams.get('start');
    await handleTelegramUpdate({ message: { chat: { id: 9001, type: 'private' }, from: { id: 9001 }, text: `/start ${token}` } });
    expect(store.getVisitor(vid)?.telegramChatId).toBe(9001);
    await handleTelegramUpdate({ message: { chat: { id: 9001, type: 'private' }, from: { id: 9001 }, text: 'Tuesday 2pm works' } });
    expect(getMessages(vid).at(-1)).toMatchObject({ from: 'visitor', text: 'Tuesday 2pm works' });
  });
});

describe('inbound email', () => {
  test('quoted history is stripped', () => {
    expect(stripQuoted('Sounds good!\n\nOn Tue, Sep 24, 2026 at 5:00 PM Pepper <pepper@drose.io> wrote:\n> old')).toBe('Sounds good!');
    expect(stripQuoted('yes\r\n> quoted')).toBe('yes');
  });

  const mime = (to: string, extra = '') => new TextEncoder().encode(
    `From: Maya <maya@evals.dev>\r\nTo: ${to}\r\nSubject: Re: Your note to David\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\nTuesday works.\r\n\r\nOn Wed, Pepper wrote:\r\n> hi\r\n`);

  test('reply key comes from the plus address', async () => {
    const r = await parseInbound(mime('pepper+0123456789abcdef01234567@swarmlet.com'));
    expect(r.replyKey).toBe('0123456789abcdef01234567');
    expect(r.text).toBe('Tuesday works.');
  });

  test('auto-replies are skipped', async () => {
    const r = await parseInbound(mime('pepper+0123456789abcdef01234567@swarmlet.com', 'Auto-Submitted: auto-replied\r\n'));
    expect(r.skip).toBe('automated');
  });

  test('reply keys are lowercase hex so the mail edge cannot mangle them', () => {
    const v = store.ensureVisitor('visitor-key-check-1');
    expect(v.replyKey).toMatch(/^[0-9a-f]{24}$/);
    expect(store.visitorByReplyKey(v.replyKey.toUpperCase())).toBe('visitor-key-check-1');
  });
});

test('test storage stayed inside the temp dir', () => {
  expect(existsSync(join(DIR, 'pepper', 'meta.json'))).toBe(true);
  expect(readFileSync(join(DIR, 'pepper', 'meta.json'), 'utf-8')).toContain('visitor-abc-123456');
});
