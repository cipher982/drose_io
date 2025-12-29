#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';

type TraceEvent = {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: any;
};

type TraceFile = {
  traceEvents?: TraceEvent[];
  metadata?: Record<string, unknown>;
};

function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return '—';
  return `${ms.toFixed(1)}ms`;
}

function padRight(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  const path = process.argv[2];
  const topRaw = process.argv[3];
  const topN = topRaw ? Math.max(5, Number(topRaw)) : 20;

  if (!path) {
    console.error('Usage: bun run scripts/perf/analyze-trace.ts <path-to-trace.json> [topN]');
    process.exit(2);
  }

  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as TraceFile | TraceEvent[];
  const events: TraceEvent[] = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);

  const threadName = new Map<string, string>();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') {
      const name = e.args?.name;
      if (typeof name === 'string' && typeof e.pid === 'number' && typeof e.tid === 'number') {
        threadName.set(`${e.pid}:${e.tid}`, name);
      }
    }
  }

  let traceStart = Number.POSITIVE_INFINITY;
  let traceEnd = 0;
  for (const e of events) {
    // Metadata events commonly have ts=0; ignore them for the trace window.
    if (e.ph === 'M') continue;
    if (typeof e.ts === 'number' && e.ts > 0) traceStart = Math.min(traceStart, e.ts);
    if (typeof e.ts === 'number' && e.ts > 0) traceEnd = Math.max(traceEnd, e.ts + (e.dur ?? 0));
  }

  const mainThreadKey =
    [...threadName.entries()].find(([, name]) => name === 'CrRendererMain')?.[0] ??
    [...threadName.entries()].find(([, name]) => name.includes('RendererMain'))?.[0] ??
    null;

  const durByNameMain = new Map<string, number>();
  const countByNameMain = new Map<string, number>();
  const durByNameAll = new Map<string, number>();
  const rasterByThread = new Map<string, number>();

  const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
  const inc = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number' || typeof e.name !== 'string') continue;
    add(durByNameAll, e.name, e.dur);

    const key = typeof e.pid === 'number' && typeof e.tid === 'number' ? `${e.pid}:${e.tid}` : '';
    if (e.name === 'RasterTask' && key) add(rasterByThread, key, e.dur);

    if (mainThreadKey && key === mainThreadKey) {
      add(durByNameMain, e.name, e.dur);
      inc(countByNameMain, e.name);
    }
  }

  const rasterTotalMs = [...rasterByThread.values()].reduce((a, b) => a + b, 0) / 1000;
  const paintMainMs = (durByNameMain.get('Paint') ?? 0) / 1000;
  const layoutMainMs = (durByNameMain.get('Layout') ?? 0) / 1000;
  const prePaintMainMs = (durByNameMain.get('PrePaint') ?? 0) / 1000;

  const topMain = [...durByNameMain.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, dur]) => ({
      name,
      durMs: dur / 1000,
      count: countByNameMain.get(name) ?? 0,
    }));

  const topRasterThreads = [...rasterByThread.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, dur]) => ({
      key,
      name: threadName.get(key) ?? '?',
      durMs: dur / 1000,
    }));

  console.log(`Trace: ${path}`);
  console.log(`Events: ${events.length}`);
  console.log(`Window: ${fmtMs((traceEnd - traceStart) / 1000)} (ts ${traceStart} → ${traceEnd})`);
  console.log(`Renderer main: ${mainThreadKey ? `${threadName.get(mainThreadKey) ?? '?'} (${mainThreadKey})` : 'unknown'}`);
  console.log('');
  console.log(`Main thread: Paint=${fmtMs(paintMainMs)} Layout=${fmtMs(layoutMainMs)} PrePaint=${fmtMs(prePaintMainMs)}`);
  console.log(`RasterTask total (sum across threads): ${fmtMs(rasterTotalMs)}\n`);

  if (mainThreadKey) {
    console.log(`Top main-thread events by total duration (top ${topMain.length}):`);
    const nameWidth = Math.min(40, Math.max(18, ...topMain.map((r) => r.name.length)));
    for (const r of topMain) {
      console.log(`${fmtMs(r.durMs).padStart(10, ' ')}  ${String(r.count).padStart(5, ' ')}  ${padRight(r.name, nameWidth)}`);
    }
    console.log('');
  }

  console.log('Top RasterTask threads:');
  for (const t of topRasterThreads) {
    console.log(`${fmtMs(t.durMs).padStart(10, ' ')}  ${padRight(t.name, 28)}  ${t.key}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
