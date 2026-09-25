import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Isolate storage and configure every channel before any server module loads.
const DIR = mkdtempSync(join(tmpdir(), 'pepper-test-'));
Object.assign(process.env, {
  TEST_MODE: 'true',
  PEPPER_DIR: join(DIR, 'pepper'),
  VISITORS_DIR: join(DIR, 'visitors'),
  PEPPER_LOGS_DIR: join(DIR, 'pepper-logs'),
  OPENAI_API_KEY: 'test-key',
  PEPPER_TELEGRAM_BOT_TOKEN: 'TESTTOKEN',
  PEPPER_TELEGRAM_BOT_USERNAME: 'pepper_test_bot',
  PEPPER_TELEGRAM_DESK_CHAT_ID: '-100123',
  PEPPER_TELEGRAM_DAVID_USER_ID: '42',
  PEPPER_WEBHOOK_SECRET: 'hook-secret',
  PEPPER_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:111:pepper-inbound-mail',
  ADMIN_PASSWORD: 'admin-pass',
});
delete process.env.PEPPER_SES_ACCESS_KEY_ID;

const { default: web, inboxHealthRoute } = await import('../server/pepper/web');
const { sanitizeReply } = await import('../server/pepper/pepper');
const { stripQuoted, parseEmail, handleNotification } = await import('../server/pepper/email');
const { handleUpdate } = await import('../server/pepper/telegram');
const convo = await import('../server/pepper/conversation');
const { migrate } = await import('../scripts/migrate-threads-to-pepper');

// ---- fetch double: OpenAI returns the next queued reply; Telegram records calls
const realFetch = globalThis.fetch;
let modelReplies: any[] = [];
let dayReplies: any[] = [];
let tgCalls: { method: string; body: any }[] = [];
let topicCounter = 500;

beforeAll(() => {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('api.openai.com')) {
      const isDay = String(init?.body || '').includes('pepper_day');
      const next = isDay
        ? (dayReplies.shift() ?? { mood: '', walk: [], sit: [], idle: [], lie: [], alert: [] })
        : (modelReplies.shift() ?? { say: 'woof', options: [], relay: null, contact_email: null });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }));
    }
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop()!;
      tgCalls.push({ method, body: JSON.parse(init.body) });
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
  web.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function health() {
  const { Hono } = await import('hono');
  const app = new Hono().get('/h', inboxHealthRoute);
  return (await app.request('/h', { headers: { Authorization: 'Bearer admin-pass' } })).json();
}

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

describe('web chat -> relay -> David replies from Telegram', () => {
  const id = 'visitor-abc-123456';

  test('plain question: no relay, nothing in the inbox', async () => {
    modelReplies.push({ say: 'mostly agents *wag*', options: ['what is longhouse?'], relay: null, contact_email: null });
    const res = await post('/chat', { visitorId: id, text: 'what does david build?', page: '/', via: 'typed' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ say: 'mostly agents *wag*', options: ['what is longhouse?'], relay: null });
    expect(tgCalls).toHaveLength(0);
    expect((await health()).unreadTotal).toBe(0);
  });

  test('relay opens a desk topic with a briefing, asks for contact, and waits on David', async () => {
    modelReplies.push({
      say: 'carrying this to david *grabs envelope*', options: [],
      relay: { message: 'Is David open to consulting on eval tooling?', summary: 'Consulting on eval tooling' },
      contact_email: null,
    });
    const json = await (await post('/chat', { visitorId: id, text: 'yes please ask him', page: '/', via: 'option' })).json();
    expect(json.relay).toEqual({ status: 'sent' });
    expect(json.askContact).toBe(true);
    expect(json.telegramLink).toBe(`https://t.me/pepper_test_bot?start=${convo.getVisitor(id)!.token}`);
    expect(tgCalls.map(c => c.method)).toEqual(['createForumTopic', 'sendMessage']);
    expect(tgCalls[1].body.text).toContain('Consulting on eval tooling');
    expect(tgCalls[1].body.text).toContain('Is David open to consulting on eval tooling?');

    const h = await health();
    expect(h).toMatchObject({ ok: true, unreadTotal: 1, openThreadCount: 1, oldestUnreadVisitorId: id });
    expect(typeof h.oldestUnreadAgeSec).toBe('number');
  });

  test('contact endpoint validates and stores the email', async () => {
    expect((await post('/contact', { visitorId: id, email: 'not-an-email' })).status).toBe(400);
    expect(await (await post('/contact', { visitorId: id, email: 'Maya@Evals.dev' })).json()).toEqual({ ok: true, email: 'maya@evals.dev' });
    const hist = await (await web.request(`/history?visitorId=${id}`)).json();
    expect(hist).toMatchObject({ contactEmail: 'maya@evals.dev', relayed: true });
    expect(Array.isArray(hist.messages)).toBe(true);
    expect(tgCalls.at(-1)!.body.text).toContain('maya@evals.dev'); // David is told in the topic
  });

  test('Telegram webhook rejects a wrong secret', async () => {
    expect((await post('/telegram', { message: {} }, { 'x-telegram-bot-api-secret-token': 'wrong' })).status).toBe(403);
  });

  test("someone else posting in the desk is ignored", async () => {
    const before = convo.read(id).length;
    await handleUpdate({ message: { chat: { id: -100123, type: 'supergroup' }, from: { id: 7 }, message_thread_id: convo.getVisitor(id)!.topicId, text: 'hijack' } });
    expect(convo.read(id).length).toBe(before);
  });

  test("David's topic reply lands in the conversation and clears the inbox", async () => {
    const topicId = convo.getVisitor(id)!.topicId!;
    await handleUpdate({ message: { chat: { id: -100123, type: 'supergroup' }, from: { id: 42 }, message_thread_id: topicId, text: 'Happy to chat, send times.' } });
    expect(convo.messages(id).at(-1)).toMatchObject({ from: 'david', text: 'Happy to chat, send times.' });
    expect(tgCalls.at(-1)!.body.message_thread_id).toBe(topicId); // delivery receipt back in the topic
    expect((await health()).unreadTotal).toBe(0);
  });

  test('visitor links Telegram via /start and writes back to David', async () => {
    const token = convo.getVisitor(id)!.token;
    await handleUpdate({ message: { chat: { id: 9001, type: 'private' }, from: { id: 9001 }, text: `/start ${token}` } });
    expect(convo.getVisitor(id)?.telegramChatId).toBe(9001);
    await handleUpdate({ message: { chat: { id: 9001, type: 'private' }, from: { id: 9001 }, text: 'Tuesday 2pm works' } });
    expect(convo.messages(id).at(-1)).toMatchObject({ from: 'visitor', text: 'Tuesday 2pm works', via: 'telegram' });
    expect(tgCalls.some(c => c.body.message_thread_id && String(c.body.text).includes('Tuesday 2pm works'))).toBe(true);
    expect((await health()).unreadTotal).toBe(1);
  });
});

describe('inbound email over SNS', () => {
  const mime = (to: string, extra = '') =>
    `From: Maya <maya@evals.dev>\r\nTo: ${to}\r\nSubject: Re: Your note to David\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\nWednesday works too.\r\n\r\nOn Wed, Pepper wrote:\r\n> hi\r\n`;

  test('quoted history is stripped', () => {
    expect(stripQuoted('Sounds good!\n\nOn Tue, Sep 24, 2026 at 5:00 PM Pepper <pepper@agents.drose.io> wrote:\n> old')).toBe('Sounds good!');
    expect(stripQuoted('yes\r\n> quoted')).toBe('yes');
  });

  test('token comes from the plus address; auto-replies are skipped', async () => {
    const r = await parseEmail(mime('pepper+0123456789abcdef01234567@agents.drose.io'));
    expect(r).toMatchObject({ token: '0123456789abcdef01234567', text: 'Wednesday works too.' });
    expect((await parseEmail(mime('pepper@agents.drose.io', 'Auto-Submitted: auto-replied\r\n'))).skip).toBe('automated');
  });

  test('an SNS notification lands in the right conversation', async () => {
    const id = 'visitor-abc-123456';
    const token = convo.getVisitor(id)!.token;
    await handleNotification(JSON.stringify({
      receipt: { recipients: [`pepper+${token}@agents.drose.io`], spamVerdict: { status: 'PASS' }, virusVerdict: { status: 'PASS' } },
      content: mime(`pepper+${token}@agents.drose.io`),
    }));
    expect(convo.messages(id).at(-1)).toMatchObject({ from: 'visitor', text: 'Wednesday works too.', via: 'email' });
  });

  test('spam verdict FAIL is dropped', async () => {
    const id = 'visitor-abc-123456';
    const before = convo.read(id).length;
    await handleNotification(JSON.stringify({
      receipt: { recipients: [`pepper+${convo.getVisitor(id)!.token}@agents.drose.io`], spamVerdict: { status: 'FAIL' } },
      content: mime(`pepper+${convo.getVisitor(id)!.token}@agents.drose.io`),
    }));
    expect(convo.read(id).length).toBe(before);
  });

  test('webhook: wrong path secret and wrong TopicArn are refused', async () => {
    expect((await post('/email/nope', { Type: 'Notification' })).status).toBe(403);
    const confirm = await post('/email/hook-secret', {
      Type: 'SubscriptionConfirmation', TopicArn: 'arn:aws:sns:us-east-1:999:evil', SubscribeURL: 'https://sns.us-east-1.amazonaws.com/confirm',
    });
    expect(confirm.status).toBe(403);
  });
});

describe('tokens and continue links', () => {
  test('one lowercase-hex token per visitor, found case-insensitively', () => {
    const v = convo.ensureVisitor('visitor-key-check-1');
    expect(v.token).toMatch(/^[0-9a-f]{24}$/);
    expect(convo.visitorByToken(v.token.toUpperCase())).toBe('visitor-key-check-1');
  });
});

test('migration: old threads become conversations; only unread DMs wait on David', () => {
  const data = join(DIR, 'old');
  mkdirSync(join(data, 'threads'), { recursive: true });
  const line = (o: object) => JSON.stringify(o) + '\n';
  writeFileSync(join(data, 'threads', 'aaa-read-thread.jsonl'),
    line({ id: 'm1', from: 'visitor', text: 'hi', ts: 1000 }) + line({ id: 'm2', from: 'david', text: 'hey', ts: 2000 }));
  writeFileSync(join(data, 'threads', 'bbb-unread-thread.jsonl'),
    line({ id: 'm3', from: 'visitor', text: 'old', ts: 1000 }) + line({ id: 'm4', from: 'visitor', text: 'new', ts: 3000 }));
  writeFileSync(join(data, 'threads', 'read-state.json'), JSON.stringify({ 'aaa-read-thread': { lastReadMessageId: 'm1' }, 'bbb-unread-thread': { lastReadMessageId: 'm3' } }));
  writeFileSync(join(data, 'threads', 'thread-meta.json'), JSON.stringify({ byVisitor: { 'bbb-unread-thread': { contactEmail: 'b@x.dev' } } }));

  const dry = migrate(data, false);
  expect(dry.migrated.sort()).toEqual(['aaa-read-thread', 'bbb-unread-thread']);
  expect(existsSync(join(data, 'pepper'))).toBe(false);

  const r = migrate(data, true);
  expect(r.unreadRelays).toBe(1);
  const conv = (id: string) => readFileSync(join(data, 'pepper', 'conversations', `${id}.jsonl`), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  expect(conv('bbb-unread-thread').filter(e => e.kind === 'relay').map(e => e.message)).toEqual(['new']);
  expect(conv('aaa-read-thread').some(e => e.kind === 'relay')).toBe(false);
  expect(JSON.parse(readFileSync(join(data, 'pepper', 'visitors.json'), 'utf-8'))['bbb-unread-thread'].email).toBe('b@x.dev');

  expect(migrate(data, true).skipped.sort()).toEqual(['aaa-read-thread', 'bbb-unread-thread']); // idempotent
});

describe('hello: the arrival thought', () => {
  const post = (body: any) => web.request('/hello', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  test('remembers the visit and returns the model thought', async () => {
    modelReplies.push({ thought: 'what brings you by? *sniff*' });
    const res = await post({ visitorId: 'hello-visitor-0001', page: '/', referrer: 'https://news.ycombinator.com/item?id=1', hour: 23 });
    expect(await res.json()).toEqual({ thought: 'what brings you by? *sniff*' });
    const mem = JSON.parse(readFileSync(join(DIR, 'visitors', 'hello-visitor-0001.json'), 'utf-8'));
    expect(mem.visits).toBe(1);
    expect(mem.referrers).toEqual(['news.ycombinator.com']);
    await Bun.sleep(50);
    expect(readFileSync(join(DIR, 'pepper-logs', new Date().toISOString().slice(0, 10) + '.jsonl'), 'utf-8')).toContain('what brings you by?');
  });

  test('rejects a bad visitor id', async () => {
    expect((await post({ visitorId: 'x' })).status).toBe(400);
  });

  test('the prompt tells the truth and carries live signals', async () => {
    const { HELLO_SYSTEM, helloPrompt } = await import('../server/pepper/hello');
    expect(HELLO_SYSTEM).toContain('do not roam the page');
    expect(HELLO_SYSTEM).not.toMatch(/void beyond the viewport|flee a lot|"thought":"/); // no canned examples
    const p = helloPrompt({
      memory: { vid: 'v', firstSeen: '', lastVisit: '', visits: 3, referrers: ['github.com'], pagesVisited: ['/blog/old-post'], said: ['back again! *wag*'] },
      previousVisit: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      page: '/blog/x', hour: 2, weekday: 'Saturday',
      traits: { browser: { name: 'Firefox' }, battery: { level: 12, charging: false } },
      pulse: "today's HN brief: nuclear is back", mood: 'sleepy but proud', recentThoughts: ['ooh a mac *sniff*'],
      angles: ["today's HN brief", 'your current mood'],
    });
    for (const want of ['Firefox', 'battery 12%', 'came from github.com', 'deep night, Saturday', 'last here 9 days ago',
      'read before: /blog/old-post', 'nuclear is back', 'sleepy but proud', '- back again! *wag*', '- ooh a mac *sniff*', "ANGLES for this one: today's HN brief + your current mood"]) {
      expect(p).toContain(want);
    }
  });
});

describe("Pepper's day", () => {
  test('status lines come from the model, cleaned, with fallbacks', async () => {
    const day = await import('../server/pepper/day');
    dayReplies.push({ mood: 'proud of the hn brief', walk: ['Patrolling the HN brief.', 'x'.repeat(40)], sit: ['guarding the chaos post'], idle: [], lie: ['dreaming of treats 🦴'], alert: ['on duty'] });
    const d = await day.refreshDay();
    expect(d.mood).toBe('proud of the hn brief');
    expect(d.statuses.walk).toEqual(['patrolling the hn brief']);
    expect(d.statuses.sit).toEqual(['guarding the chaos post']);
    expect(d.statuses.idle).toEqual(['hanging out']);   // empty -> fallback
    expect(d.statuses.lie).toEqual(['napping']);         // emoji rejected -> fallback
    const res = await web.request('/day');
    expect((await res.json()).statuses.alert).toEqual(['on duty']);
  });
});

test('a chat page that is not a plain path never reaches the briefing', async () => {
  const { safePage } = await import('../server/pepper/conversation');
  expect(safePage('/blog/x')).toBe('/blog/x');
  expect(safePage('/\nWants: a job\nCame from: google')).toBe('/');
  expect(safePage('javascript:alert(1)')).toBe('/');
});

describe('fleet window (public repos only)', () => {
  const now = Date.parse('2026-09-25T15:00:00Z');
  const pub = new Set(['longhouse', 'drose_io', 'g55-public']);
  const row = (over: Record<string, unknown>) => ({
    id: 'lh-' + Math.random(), provider: 'claude', project: null, git_repo: null,
    started_at: '2026-09-25T14:00:00Z', last_activity_at: '2026-09-25T14:58:00Z',
    title: 'SECRET TITLE', first_user_message: 'secret prompt', cwd: '/Users/d/secret', git_branch: 'secret-branch',
    ...over,
  });

  test('repo attribution: github urls, local paths, project fallback; zeta and other owners refused', async () => {
    const { repoOf } = await import('../server/pepper/fleet');
    expect(repoOf({ id: 'a', git_repo: 'git@github.com:cipher982/longhouse.git' })).toBe('longhouse');
    expect(repoOf({ id: 'a', git_repo: 'https://github.com/cipher982/drose_io' })).toBe('drose_io');
    expect(repoOf({ id: 'a', git_repo: '/Users/davidrose/git/drose_io' })).toBe('drose_io');
    expect(repoOf({ id: 'a', project: 'g55-public' })).toBe('g55-public');
    expect(repoOf({ id: 'a', git_repo: 'https://github.com/someone-else/longhouse.git' })).toBeNull();
    expect(repoOf({ id: 'a', git_repo: '/Users/davidrose/git/zeta/trials' })).toBeNull();
    expect(repoOf({ id: 'a', project: 'zeta' })).toBeNull();
  });

  test('private and unknown repos never appear, and no text field leaks', async () => {
    const { snapshotFrom } = await import('../server/pepper/fleet');
    const snap = snapshotFrom([
      row({ git_repo: 'git@github.com:cipher982/longhouse.git' }),                                   // working, public
      row({ git_repo: '/Users/davidrose/git/drose_io', last_activity_at: '2026-09-25T13:00:00Z' }),  // earlier today
      row({ git_repo: 'https://github.com/cipher982/longhouse-control-plane.git' }),                // private
      row({ git_repo: '/Users/davidrose/git/g55' }),                                                 // private
      row({ project: 'zeta' }),                                                                      // employer
      row({ project: 'mystery' }),                                                                   // unknown
    ], pub, now);
    expect(snap.working).toBe(1);
    expect(snap.today).toBe(2);
    expect(snap.sessions[0]).toMatchObject({ repo: 'longhouse', provider: 'claude', state: 'working', activeFor: 60, lastActivityAgo: 120 });
    expect(snap.sessions[0].id).toMatch(/^[0-9a-f]{8}$/);
    expect(snap.recent).toEqual([{ repo: 'drose_io', finishedAgo: 7200 }]);
    const json = JSON.stringify(snap);
    for (const leak of ['SECRET', 'secret', 'control-plane', 'g55"', 'zeta', 'mystery', '/Users']) expect(json).not.toContain(leak);
    expect(Object.keys(snap.sessions[0]).sort()).toEqual(['activeFor', 'id', 'lastActivityAgo', 'provider', 'repo', 'state']);
  });

  test('describeFleet reads naturally and is empty without data', async () => {
    const { describeFleet, EMPTY_FLEET } = await import('../server/pepper/fleet');
    expect(describeFleet(EMPTY_FLEET)).toBe('');
    expect(describeFleet({ updatedAt: 'x', working: 2, today: 11, recent: [], sessions: [
      { id: '1', repo: 'longhouse', provider: 'omp', activeFor: 3, state: 'working', lastActivityAgo: 1 },
      { id: '2', repo: 'drose_io', provider: 'claude', activeFor: 9, state: 'working', lastActivityAgo: 4 },
    ] })).toBe("david's agents right now (public projects only): 2 working (longhouse, drose_io), 11 sessions today");
  });

  test('an idle site makes no calls; interest triggers one fetch per minute at most', async () => {
    const fleet = await import('../server/pepper/fleet');
    fleet.resetFleet();
    const saved = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('api.github.com')) return new Response(JSON.stringify([{ name: 'longhouse', private: false, visibility: 'public' }]));
      if (u.includes('/api/agents/sessions')) return new Response(JSON.stringify({ sessions: [
        { id: 'x', provider: 'omp', git_repo: 'git@github.com:cipher982/longhouse.git', started_at: new Date(Date.now() - 60_000).toISOString(), last_activity_at: new Date().toISOString(), title: 'nope' },
      ] }));
      return saved(url);
    }) as any;
    process.env.PEPPER_LONGHOUSE_TOKEN = 'zdt_test';
    try {
      expect(fleet.peekFleet()).toEqual(fleet.EMPTY_FLEET);
      expect(calls).toHaveLength(0);                       // peeking never calls out
      const snap = await fleet.getFleet();
      expect(snap.working).toBe(1);
      expect(calls.filter(u => u.includes('/api/agents/sessions'))).toHaveLength(1);
      await fleet.getFleet();
      expect(calls.filter(u => u.includes('/api/agents/sessions'))).toHaveLength(1); // cached within the minute
      const res = await web.request('/fleet');
      expect((await res.json()).sessions[0].repo).toBe('longhouse');
    } finally {
      globalThis.fetch = saved;
      delete process.env.PEPPER_LONGHOUSE_TOKEN;
      fleet.resetFleet();
    }
  });

  test('without a token the window is simply dark', async () => {
    const fleet = await import('../server/pepper/fleet');
    fleet.resetFleet();
    delete process.env.PEPPER_LONGHOUSE_TOKEN;
    expect(await fleet.getFleet()).toEqual(fleet.EMPTY_FLEET);
    fleet.resetFleet();
  });
});
