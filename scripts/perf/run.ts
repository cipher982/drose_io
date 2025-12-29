#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';

type NetworkPreset = 'wifi' | 'fast3g' | 'slow4g';

type Scenario = {
  name: string;
  cpuThrottleRate?: number;
  network?: NetworkPreset;
  device?: keyof typeof devices;
  block?: {
    umami?: boolean;
    feedbackWidget?: boolean;
  };
  disableAnimations?: boolean;
  disableBackdropFilter?: boolean;
  disableBackgroundAnimations?: boolean;
  disableHeroAnimations?: boolean;
  actions?: Array<'scrollToBottom'>;
};

type RunResult = {
  scenario: string;
  url: string;
  timestamp: string;
  timings: {
    navigationStart: number;
    domContentLoaded: number | null;
    load: number | null;
  };
  webVitals: {
    fcp: number | null;
    lcp: number | null;
    cls: number | null;
    tbt: number | null;
  };
  counts: {
    domNodes: number | null;
    resourceCount: number | null;
  };
  transfer: {
    totalBytes: number | null;
    totalResources: number | null;
    byTypeBytes: Record<string, number>;
    byTypeCount: Record<string, number>;
  };
  cpu: {
    taskDurationMs: number | null;
    scriptDurationMs: number | null;
    layoutDurationMs: number | null;
    recalcStyleDurationMs: number | null;
    jsHeapUsedBytes: number | null;
  };
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    i++;
  }

  const getString = (key: string, fallback: string) =>
    typeof args.get(key) === 'string' ? (args.get(key) as string) : fallback;
  const getNumber = (key: string, fallback: number) => {
    const value = args.get(key);
    if (typeof value !== 'string') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const getBool = (key: string) => args.get(key) === true;

  return {
    url: getString('url', ''),
    port: getNumber('port', 4173),
    runs: getNumber('runs', 3),
    outDir: getString('out', 'test-results/perf'),
    noServer: getBool('no-server'),
    trace: getBool('trace'),
    settleMs: getNumber('settle-ms', 3500),
    cpuProfileMs: getNumber('cpu-profile-ms', 0),
    diagnostics: getBool('diagnostics'),
  };
}

async function waitForHealthy(baseUrl: string, timeoutMs = 10_000) {
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
      if (res.ok) return;
      lastError = new Error(`Health check returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`Server not healthy after ${timeoutMs}ms: ${String(lastError)}`);
}

async function startServer(port: number) {
  const env = { ...process.env, PORT: String(port) };
  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'server/index.ts'],
    cwd: process.cwd(),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const pump = async (stream: ReadableStream<Uint8Array> | null, sink: (s: string) => void) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      sink(decoder.decode(value));
    }
  };

  pump(proc.stdout, (s) => stdoutChunks.push(s));
  pump(proc.stderr, (s) => stderrChunks.push(s));

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealthy(baseUrl, 10_000);
  } catch (err) {
    proc.kill();
    const stderr = stderrChunks.join('');
    const stdout = stdoutChunks.join('');
    throw new Error(
      [
        `Failed to start server on ${baseUrl}`,
        String(err),
        stdout ? `--- stdout ---\n${stdout}` : '',
        stderr ? `--- stderr ---\n${stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    baseUrl,
    stop: () => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    },
  };
}

function networkConditions(preset: NetworkPreset) {
  // Numbers loosely based on Lighthouse defaults.
  // https://github.com/GoogleChrome/lighthouse/blob/main/core/config/constants.js
  if (preset === 'wifi') {
    return {
      offline: false,
      latency: 20,
      downloadThroughput: 30 * 1024 * 1024 / 8, // 30Mbps
      uploadThroughput: 15 * 1024 * 1024 / 8, // 15Mbps
    };
  }
  if (preset === 'fast3g') {
    return {
      offline: false,
      latency: 150,
      downloadThroughput: 1.6 * 1024 * 1024 / 8, // 1.6Mbps
      uploadThroughput: 750 * 1024 / 8, // 750Kbps
    };
  }
  return {
    offline: false,
    latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8, // 1.6Mbps
    uploadThroughput: 750 * 1024 / 8, // 750Kbps
  };
}

async function setupContext(browser: Browser, scenario: Scenario) {
  const device = scenario.device ? devices[scenario.device] : null;

  const context = await browser.newContext({
    ...(device ?? {}),
    locale: 'en-US',
  });

  // Block external analytics to keep results stable/offline-friendly.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (scenario.block?.umami && url.includes('analytics.drose.io/script.js')) {
      return route.abort();
    }
    if (scenario.block?.feedbackWidget && url.includes('/assets/js/feedback-widget')) {
      return route.abort();
    }
    return route.continue();
  });

  // Capture Web Vitals-like signals in-page (FCP/LCP/CLS/TBT).
  await context.addInitScript(() => {
    // @ts-ignore - injected into page context
    window.__drosePerf = { fcp: null, lcp: null, cls: 0, tbt: 0 };

    try {
      // FCP via paint timing
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            // @ts-ignore
            window.__drosePerf.fcp = entry.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {}

    try {
      // LCP
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          // @ts-ignore
          window.__drosePerf.lcp = last.startTime;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}

    try {
      // CLS (ignore shifts after user input)
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          if (entry.hadRecentInput) continue;
          cls += entry.value;
        }
        // @ts-ignore
        window.__drosePerf.cls = cls;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}

    try {
      // TBT approximation from long tasks (duration > 50ms)
      let tbt = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          const blocking = entry.duration - 50;
          if (blocking > 0) tbt += blocking;
        }
        // @ts-ignore
        window.__drosePerf.tbt = tbt;
      }).observe({ type: 'longtask', buffered: true } as any);
    } catch {}
  });

  return context;
}

async function maybeDisableAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    `,
  });
}

async function maybeDisableBackdropFilter(page: Page) {
  await page.addStyleTag({
    content: `
      .main-container,
      .window,
      .window-panel,
      .metric-card,
      .section-header,
      button,
      .win98-button {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
    `,
  });
}

async function maybeDisableBackgroundAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      body::before,
      body::after,
      .particle-bg::before,
      .particle-bg::after,
      .main-container::after {
        animation: none !important;
      }
    `,
  });
}

async function maybeDisableHeroAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      header h1,
      header img {
        animation: none !important;
      }
    `,
  });
}

async function collectRun(
  context: BrowserContext,
  browserName: string,
  scenario: Scenario,
  url: string,
  traceEnabled: boolean,
  outDir: string,
  runIndex: number,
  settleMs: number,
  cpuProfileMs: number,
): Promise<RunResult> {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  await client.send('Performance.enable');
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });

  if (scenario.cpuThrottleRate && scenario.cpuThrottleRate > 1) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: scenario.cpuThrottleRate });
  }

  if (scenario.network) {
    await client.send('Network.emulateNetworkConditions', networkConditions(scenario.network));
  }

  const tracePath = `${outDir}/${scenario.name.replaceAll(' ', '_')}-run${runIndex + 1}.trace.json`;
  if (traceEnabled) {
    await client.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'loading',
        'blink.user_timing',
        'v8',
        'gpu',
        'disabled-by-default-gpu.service',
      ].join(','),
      options: 'sampling-frequency=10000',
    });
  }

  const startTimestamp = new Date().toISOString();
  await page.goto(url, { waitUntil: 'load' });

  if (scenario.disableAnimations) {
    await maybeDisableAnimations(page);
  }
  if (scenario.disableBackdropFilter) {
    await maybeDisableBackdropFilter(page);
  }
  if (scenario.disableBackgroundAnimations) {
    await maybeDisableBackgroundAnimations(page);
  }
  if (scenario.disableHeroAnimations) {
    await maybeDisableHeroAnimations(page);
  }

  if (scenario.actions?.includes('scrollToBottom')) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
  }

  const profilePath = `${outDir}/${scenario.name.replaceAll(' ', '_')}-run${runIndex + 1}.cpuprofile.json`;
  const shouldProfileCpu = cpuProfileMs > 0;
  if (shouldProfileCpu) {
    await client.send('Profiler.enable');
    await client.send('Profiler.start');
  }

  // Give the page a bit of time to settle; avoid waiting for "networkidle" because SSE stays open.
  await page.waitForTimeout(settleMs);

  if (shouldProfileCpu) {
    const stopped = (await client.send('Profiler.stop')) as any;
    await client.send('Profiler.disable');
    await Bun.write(profilePath, JSON.stringify(stopped.profile, null, 2));
  }

  if (traceEnabled) {
    const traceComplete = new Promise<{ stream: string }>((resolve) => {
      client.once('Tracing.tracingComplete', (evt) => resolve(evt as any));
    });
    await client.send('Tracing.end');

    const { stream } = await traceComplete;
    const chunks: string[] = [];
    while (true) {
      const { data, eof } = (await client.send('IO.read', { handle: stream })) as any;
      if (data) chunks.push(data);
      if (eof) break;
    }
    await client.send('IO.close', { handle: stream });
    await Bun.write(tracePath, chunks.join(''));
  }

  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return entry ? entry.toJSON() : null;
  });

  const perf = await page.evaluate(() => {
    // @ts-ignore
    return window.__drosePerf ?? null;
  });

  const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);

  const resources = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return entries.map((e) => ({
      name: e.name,
      initiatorType: e.initiatorType,
      transferSize: (e as any).transferSize ?? 0,
      encodedBodySize: e.encodedBodySize ?? 0,
    }));
  });

  const metrics = (await client.send('Performance.getMetrics')) as any;
  const metricsMap = new Map<string, number>();
  for (const m of metrics.metrics ?? []) {
    metricsMap.set(m.name, m.value);
  }

  const byTypeBytes: Record<string, number> = {};
  const byTypeCount: Record<string, number> = {};
  let totalBytes = 0;
  for (const r of resources ?? []) {
    const t = r.initiatorType || 'other';
    byTypeBytes[t] = (byTypeBytes[t] ?? 0) + (r.transferSize || 0);
    byTypeCount[t] = (byTypeCount[t] ?? 0) + 1;
    totalBytes += r.transferSize || 0;
  }

  const result: RunResult = {
    scenario: scenario.name,
    url,
    timestamp: startTimestamp,
    timings: {
      navigationStart: 0,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
    },
    webVitals: {
      fcp: perf?.fcp ?? null,
      lcp: perf?.lcp ?? null,
      cls: typeof perf?.cls === 'number' ? perf.cls : null,
      tbt: typeof perf?.tbt === 'number' ? perf.tbt : null,
    },
    counts: {
      domNodes,
      resourceCount: Array.isArray(resources) ? resources.length : null,
    },
    transfer: {
      totalBytes,
      totalResources: Array.isArray(resources) ? resources.length : null,
      byTypeBytes,
      byTypeCount,
    },
    cpu: {
      taskDurationMs: metricsMap.has('TaskDuration') ? metricsMap.get('TaskDuration')! * 1000 : null,
      scriptDurationMs: metricsMap.has('ScriptDuration') ? metricsMap.get('ScriptDuration')! * 1000 : null,
      layoutDurationMs: metricsMap.has('LayoutDuration') ? metricsMap.get('LayoutDuration')! * 1000 : null,
      recalcStyleDurationMs: metricsMap.has('RecalcStyleDuration') ? metricsMap.get('RecalcStyleDuration')! * 1000 : null,
      jsHeapUsedBytes: metricsMap.has('JSHeapUsedSize') ? metricsMap.get('JSHeapUsedSize')! : null,
    },
  };

  await page.close();
  return result;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return null;
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function fmtMs(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(0)}ms`;
}

function fmtBytes(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v < 1024) return `${v}B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)}KB`;
  return `${(v / (1024 * 1024)).toFixed(2)}MB`;
}

function summarize(results: RunResult[]) {
  const byScenario = new Map<string, RunResult[]>();
  for (const r of results) {
    const list = byScenario.get(r.scenario) ?? [];
    list.push(r);
    byScenario.set(r.scenario, list);
  }

  const lines: string[] = [];
  lines.push('');
  lines.push('Performance summary (median across runs):');

  for (const [scenario, runs] of byScenario) {
    const dcl = median(runs.map((r) => r.timings.domContentLoaded ?? NaN).filter(Number.isFinite));
    const load = median(runs.map((r) => r.timings.load ?? NaN).filter(Number.isFinite));
    const fcp = median(runs.map((r) => r.webVitals.fcp ?? NaN).filter(Number.isFinite));
    const lcp = median(runs.map((r) => r.webVitals.lcp ?? NaN).filter(Number.isFinite));
    const cls = median(runs.map((r) => r.webVitals.cls ?? NaN).filter(Number.isFinite));
    const tbt = median(runs.map((r) => r.webVitals.tbt ?? NaN).filter(Number.isFinite));
    const bytes = median(runs.map((r) => r.transfer.totalBytes ?? NaN).filter(Number.isFinite));
    const scriptMs = median(runs.map((r) => r.cpu.scriptDurationMs ?? NaN).filter(Number.isFinite));
    const layoutMs = median(runs.map((r) => r.cpu.layoutDurationMs ?? NaN).filter(Number.isFinite));
    const styleMs = median(runs.map((r) => r.cpu.recalcStyleDurationMs ?? NaN).filter(Number.isFinite));
    const taskMs = median(runs.map((r) => r.cpu.taskDurationMs ?? NaN).filter(Number.isFinite));

    lines.push('');
    lines.push(`- ${scenario}`);
    lines.push(`  DCL: ${fmtMs(dcl)}  Load: ${fmtMs(load)}  FCP: ${fmtMs(fcp)}  LCP: ${fmtMs(lcp)}`);
    lines.push(`  CLS: ${cls === null ? '—' : cls.toFixed(3)}  TBT: ${fmtMs(tbt)}  Transfer: ${fmtBytes(bytes)}`);
    lines.push(`  CPU (ms): script=${fmtMs(scriptMs)} layout=${fmtMs(layoutMs)} style=${fmtMs(styleMs)} task=${fmtMs(taskMs)}`);
  }

  return lines.join('\n');
}

async function main() {
  const { url: urlArg, port, runs, outDir, noServer, trace, settleMs, cpuProfileMs, diagnostics } = parseArgs(process.argv.slice(2));
  const server = noServer ? null : await startServer(port);
  const baseUrl = urlArg || `${server?.baseUrl ?? `http://127.0.0.1:${port}`}`;
  const url = urlArg || `${baseUrl}/`;

  await mkdir(outDir, { recursive: true });

  const scenarios: Scenario[] = [
    {
      name: 'desktop (no throttle)',
      block: { umami: true },
    },
    {
      name: 'mobile (slow4g + 4x cpu)',
      device: 'Pixel 5',
      network: 'slow4g',
      cpuThrottleRate: 4,
      block: { umami: true },
    },
    {
      name: 'desktop (no widget)',
      block: { umami: true, feedbackWidget: true },
    },
    {
      name: 'desktop (scroll to code)',
      block: { umami: true },
      actions: ['scrollToBottom'],
    },
    {
      name: 'desktop (animations off)',
      block: { umami: true },
      disableAnimations: true,
    },
  ];

  if (diagnostics) {
    scenarios.push(
      {
        name: 'desktop (no backdrop-filter)',
        block: { umami: true },
        disableBackdropFilter: true,
      },
      {
        name: 'desktop (no bg animations)',
        block: { umami: true },
        disableBackgroundAnimations: true,
      },
      {
        name: 'desktop (no hero animations)',
        block: { umami: true },
        disableHeroAnimations: true,
      },
    );
  }

  const browser = await chromium.launch({ headless: true });
  const allResults: RunResult[] = [];

  try {
    for (const scenario of scenarios) {
      for (let i = 0; i < runs; i++) {
        const context = await setupContext(browser, scenario);
        const result = await collectRun(context, 'chromium', scenario, url, trace, outDir, i, settleMs, cpuProfileMs);
        allResults.push(result);
        await context.close();
        process.stdout.write('.');
      }
      process.stdout.write('\n');
    }
  } finally {
    await browser.close();
    server?.stop();
  }

  const outPath = `${outDir}/results.json`;
  await Bun.write(outPath, JSON.stringify({ url, runs, results: allResults }, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(summarize(allResults));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
