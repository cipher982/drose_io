#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';

type CpuProfileNode = {
  id: number;
  callFrame?: {
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
};

type CpuProfile = {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
  startTime?: number;
  endTime?: number;
};

function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return '—';
  return `${ms.toFixed(1)}ms`;
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const path = process.argv[2];
  const limitRaw = process.argv[3];
  const limit = limitRaw ? Math.max(1, Number(limitRaw)) : 20;

  if (!path) {
    console.error('Usage: bun run scripts/perf/analyze-cpuprofile.ts <path-to-cpuprofile.json> [topN]');
    process.exit(2);
  }

  const raw = await readFile(path, 'utf8');
  const profile = JSON.parse(raw) as CpuProfile;
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];

  if (!samples.length || samples.length !== timeDeltas.length) {
    console.error(`Unexpected profile shape: samples=${samples.length} timeDeltas=${timeDeltas.length}`);
    process.exit(2);
  }

  const nodeById = new Map<number, CpuProfileNode>();
  for (const node of profile.nodes ?? []) nodeById.set(node.id, node);

  const timeByKey = new Map<string, number>();
  let totalMicros = 0;

  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const micros = timeDeltas[i] ?? 0;
    totalMicros += micros;

    const node = nodeById.get(nodeId);
    const fn = node?.callFrame?.functionName || '(anonymous)';
    const url = node?.callFrame?.url || '';
    const line = Number.isFinite(node?.callFrame?.lineNumber) ? (node!.callFrame!.lineNumber! + 1) : null;
    const key = url ? `${fn} @ ${url}${line ? `:${line}` : ''}` : fn;
    timeByKey.set(key, (timeByKey.get(key) ?? 0) + micros);
  }

  const totalMs = totalMicros / 1000;
  const rows = [...timeByKey.entries()]
    .map(([key, micros]) => ({ key, micros }))
    .sort((a, b) => b.micros - a.micros)
    .slice(0, limit);

  console.log(`Profile: ${path}`);
  console.log(`Samples: ${samples.length}`);
  console.log(`Total: ${fmtMs(totalMs)}\n`);

  const maxKey = Math.min(90, Math.max(30, ...rows.map((r) => r.key.length)));
  for (const r of rows) {
    const ms = r.micros / 1000;
    const pct = totalMicros ? r.micros / totalMicros : 0;
    const label = r.key.length > maxKey ? `${r.key.slice(0, maxKey - 1)}…` : r.key.padEnd(maxKey, ' ');
    console.log(`${fmtMs(ms).padStart(9, ' ')}  ${fmtPct(pct).padStart(6, ' ')}  ${label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

