#!/usr/bin/env bun
// Steady-state energy benchmark for the homepage.
//
// Opens a real, headed Chrome (own temp profile, real GPU compositing) against
// a running site, drives a few "someone has the page open" scenarios, and
// reports what each one costs while nothing is loading:
//
//   frames/s   frames the GPU process actually drew (Display::DrawAndSwap)
//   main ms/s  renderer main-thread busy time per second (TaskDuration)
//   wakes/s    JS entry points per second (rAF + timers + event handlers)
//   cpu W/gpu W   from `powermetrics` when passwordless sudo is primed
//                 or ENERGY_SUDO_PASS is set. Whole-machine numbers: close other apps,
//                 compare runs taken minutes apart, and trust frames/s first.
//
//   bun scripts/perf/energy.ts [--base http://localhost:3000] [--reps 2] [--only top-active,hidden] [--css '<rules>']
//
// Idle thresholds are set per scenario with ?energy=calm:<s>,still:<s> so the
// idle scenarios do not take minutes (public/assets/js/energy.js reads it).

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const REPS = Number(arg('reps', '1'));
const ONLY = arg('only', '').split(',').filter(Boolean);
const WINDOW = Number(arg('seconds', '8'));
// --css '<rules>' injects a stylesheet after load, for trying a change before making it.
const INJECT_CSS = arg('css', '');
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PORT = 9300 + Math.floor(Math.random() * 500);
const ACTIVE_Q = 'energy=calm:600,still:900';
const CALM_Q = 'energy=calm:3,still:600';
const STILL_Q = 'energy=calm:2,still:5';

type Cdp = (method: string, params?: any) => Promise<any>;

async function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map<number, (m: any) => void>();
  const listeners = new Map<string, ((p: any) => void)[]>();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data as string);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
    for (const f of listeners.get(m.method) || []) f(m.params);
  };
  const cdp: Cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = (ev: string, f: (p: any) => void) => listeners.set(ev, [...(listeners.get(ev) || []), f]);
  return { cdp, on, ws };
}

async function power(seconds: number): Promise<{ cpu: number; gpu: number } | null> {
  // sudo's cached credential does not reach a child of bun, so take the
  // password from the environment (ENERGY_SUDO_PASS) when it is set.
  const pass = Bun.env.ENERGY_SUDO_PASS;
  const p = Bun.spawn(['sudo', pass ? '-S' : '-n', '-p', '', 'powermetrics', '-n', '1', '-i', String(seconds * 1000), '--samplers', 'cpu_power,gpu_power'],
    { stdin: pass ? new Blob([pass + '\n']) : 'ignore', stdout: 'pipe', stderr: 'ignore' });
  const out = await new Response(p.stdout).text();
  const c = out.match(/CPU Power: (\d+)/), g = out.match(/GPU Power: (\d+)/);
  return c && g ? { cpu: +c[1] / 1000, gpu: +g[1] / 1000 } : null;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

const profile = await mkdtemp(join(tmpdir(), 'energy-chrome-'));
const chrome = Bun.spawn([CHROME, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--window-size=1512,945', '--window-position=0,0', 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });

try {
  let browserWs = '';
  for (let i = 0; i < 50 && !browserWs; i++) {
    try { browserWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await Bun.sleep(200); }
  }
  const browser = await connect(browserWs);
  const pageInfo = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t: any) => t.type === 'page');
  const page = await connect(pageInfo.webSocketDebuggerUrl);
  await page.cdp('Page.enable');
  await page.cdp('Performance.enable');
  await page.cdp('Page.bringToFront');

  const ev = async (x: string) => (await page.cdp('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const nav = async (path: string) => {
    await page.cdp('Page.navigate', { url: BASE + path });
    for (let i = 0; i < 100; i++) { if ((await ev('document.readyState')) === 'complete') break; await Bun.sleep(100); }
    if (INJECT_CSS) await ev(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(INJECT_CSS)};document.head.append(s)})()`);
  };
  let jiggle: ReturnType<typeof setInterval> | null = null;
  const activeInput = (on: boolean | 'sweep') => {
    if (jiggle) clearInterval(jiggle);
    jiggle = null;
    if (!on) return;
    if (on === 'sweep') { // the pointer moving the whole time, across the page
      let k = 0;
      jiggle = setInterval(() => { k++; page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200 + (k * 7) % 1100, y: 250 + (k * 3) % 500 }); }, 16);
      return;
    }
    let k = 0; // a person reading: the pointer moves now and then, far from Pepper
    jiggle = setInterval(() => { k++; page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300 + (k % 2) * 3, y: 300 }); }, 1500);
  };

  // Each scenario: set up, settle, then measure a WINDOW-second window.
  const scenarios: Record<string, { setup: () => Promise<void>; settle: number }> = {
    'blank': { settle: 2, setup: async () => { activeInput(false); await page.cdp('Page.navigate', { url: 'about:blank' }); } },
    'top-active': { settle: 4, setup: async () => { activeInput(true); await nav('/?' + ACTIVE_Q); } },
    'pointer-moving': { settle: 3, setup: async () => { activeInput('sweep'); await nav('/?' + ACTIVE_Q); } },
    'top-idle-calm': { settle: 5, setup: async () => { activeInput(false); await nav('/?' + CALM_Q); } },
    'top-idle-still': { settle: 7, setup: async () => { activeInput(false); await nav('/?' + STILL_Q); } },
    'videos-active': {
      settle: 4, setup: async () => {
        activeInput(true); await nav('/?' + ACTIVE_Q);
        await ev(`(document.querySelector('video.loop-video:not([hidden])')||document.querySelector('video')).scrollIntoView({block:'center'})`);
      },
    },
    'videos-idle-calm': {
      settle: 5, setup: async () => {
        activeInput(false); await nav('/?' + CALM_Q);
        await ev(`(document.querySelector('video.loop-video:not([hidden])')||document.querySelector('video')).scrollIntoView({block:'center'})`);
      },
    },
    'blog-active': { settle: 4, setup: async () => { activeInput(true); await nav('/blog/fine-tuning-llms-practical-tips?' + ACTIVE_Q); } },
    'blog-idle-calm': { settle: 5, setup: async () => { activeInput(false); await nav('/blog/fine-tuning-llms-practical-tips?' + CALM_Q); } },
    'hidden': {
      settle: 3, setup: async () => {
        activeInput(false); await nav('/?' + ACTIVE_Q);
        const t = await browser.cdp('Target.createTarget', { url: 'about:blank' });
        hiddenTarget = t.result.targetId;
      },
    },
  };
  let hiddenTarget: string | null = null;

  // Cold load: what one visit costs before it settles (cache off, first 5 s).
  if (!ONLY.length || ONLY.includes('load')) {
    await page.cdp('Network.enable');
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
    let bytes = 0, requests = 0;
    const byType = new Map<string, number>();
    const types = new Map<string, string>();
    page.on('Network.responseReceived', (p) => types.set(p.requestId, p.type));
    page.on('Network.loadingFinished', (p) => {
      bytes += p.encodedDataLength; requests++;
      const t = types.get(p.requestId) || 'Other';
      byType.set(t, (byType.get(t) || 0) + p.encodedDataLength);
    });
    await page.cdp('Page.navigate', { url: 'about:blank' });
    await Bun.sleep(500);
    const m0 = await page.cdp('Performance.getMetrics');
    await page.cdp('Page.navigate', { url: BASE + '/?' + ACTIVE_Q });
    await Bun.sleep(5000);
    const m1 = await page.cdp('Performance.getMetrics');
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
    await page.cdp('Network.disable');
    const metric = (m: any, k: string) => m.result.metrics.find((x: any) => x.name === k)?.value ?? 0;
    const kb = (n: number) => (n / 1024).toFixed(0) + ' KB';
    console.log(`load             ${requests} requests, ${kb(bytes)} (${[...byType].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${kb(n)}`).join(', ')}), main thread ${((metric(m1, 'TaskDuration') - metric(m0, 'TaskDuration')) * 1000).toFixed(0)} ms in 5 s`);
  }

  const names = Object.keys(scenarios).filter((n) => !ONLY.length || ONLY.includes(n));
  const rows: any[] = [];
  for (const name of names) {
    const reps: any[] = [];
    for (let r = 0; r < REPS; r++) {
      await scenarios[name].setup();
      await Bun.sleep(scenarios[name].settle * 1000);

      const events: any[] = [];
      let done: () => void = () => {};
      browser.on('Tracing.dataCollected', (p) => events.push(...p.value));
      browser.on('Tracing.tracingComplete', () => done());
      const m0 = await page.cdp('Performance.getMetrics');
      await browser.cdp('Tracing.start', { traceConfig: { includedCategories: ['viz', 'devtools.timeline'] }, transferMode: 'ReportEvents' });
      const [pw] = await Promise.all([power(WINDOW), Bun.sleep(WINDOW * 1000)]);
      const finished = new Promise<void>((r) => (done = r));
      await browser.cdp('Tracing.end');
      await finished;
      const m1 = await page.cdp('Performance.getMetrics');
      const level = (await ev('document.documentElement.dataset.energy')) || '-';
      const metric = (m: any, k: string) => m.result.metrics.find((x: any) => x.name === k)?.value ?? 0;

      const count = (n: string) => events.filter((e) => e.name === n && (e.ph === 'X' || e.ph === 'B' || e.ph === 'I' || e.ph === 'i')).length;
      const frames = count('Display::DrawAndSwap');
      const wakes = count('FireAnimationFrame') + count('TimerFire') + count('EventDispatch');
      reps.push({
        frames: frames / WINDOW,
        mainMs: ((metric(m1, 'TaskDuration') - metric(m0, 'TaskDuration')) * 1000) / WINDOW,
        wakes: wakes / WINDOW,
        raf: count('FireAnimationFrame') / WINDOW,
        cpu: pw?.cpu ?? NaN,
        gpu: pw?.gpu ?? NaN,
        level,
      });
      if (hiddenTarget) { await browser.cdp('Target.closeTarget', { targetId: hiddenTarget }); hiddenTarget = null; await page.cdp('Page.bringToFront'); }
    }
    const row: any = { scenario: name, level: reps.map((x) => x.level).join('/') };
    for (const k of ['frames', 'mainMs', 'wakes', 'raf', 'cpu', 'gpu']) row[k] = median(reps.map((x) => x[k]));
    rows.push(row);
    const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
    console.log(`${name.padEnd(16)} frames/s ${f(row.frames, 0).padStart(4)}  main ms/s ${f(row.mainMs).padStart(6)}  wakes/s ${f(row.wakes, 0).padStart(4)}  rAF/s ${f(row.raf, 0).padStart(4)}  cpu ${f(row.cpu)} W  gpu ${f(row.gpu)} W  [${row.level}]`);
  }
  activeInput(false);
  if (arg('json', '')) await Bun.write(arg('json', ''), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));
} finally {
  chrome.kill();
  await chrome.exited;
  await rm(profile, { recursive: true, force: true });
}
