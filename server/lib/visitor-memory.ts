import { mkdir, readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';

const VISITORS_DIR = join(process.cwd(), 'data', 'visitors');

export interface VisitorMemory {
  vid: string;
  firstSeen: string;
  lastVisit: string;
  visits: number;
  totalTimeOnSite: number;
  referrers: string[];
  interactions: {
    clicks: number;
    fled: number;
  };
  pagesVisited: string[];
}

// Validate and sanitize visitor ID
export function validateVid(vid: string): string | null {
  if (!vid || typeof vid !== 'string') return null;

  // Only allow alphanumeric and hyphens
  const safeVid = vid.replace(/[^a-zA-Z0-9-]/g, '');

  // Must match original, be 10-64 chars
  if (safeVid !== vid || safeVid.length < 10 || safeVid.length > 64) {
    return null;
  }

  return safeVid;
}

let dirEnsured = false;

async function ensureDir(): Promise<void> {
  if (dirEnsured) return;

  try {
    await mkdir(VISITORS_DIR, { recursive: true });
    dirEnsured = true;
  } catch (err: unknown) {
    // Only ignore EEXIST, rethrow others
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      dirEnsured = true;
      return;
    }
    throw err;
  }
}

export async function loadVisitor(vid: string): Promise<VisitorMemory> {
  await ensureDir();
  const filePath = join(VISITORS_DIR, `${vid}.json`);

  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    // New visitor
    return {
      vid,
      firstSeen: new Date().toISOString(),
      lastVisit: new Date().toISOString(),
      visits: 0,
      totalTimeOnSite: 0,
      referrers: [],
      interactions: { clicks: 0, fled: 0 },
      pagesVisited: [],
    };
  }
}

export async function saveVisitor(vid: string, visitor: VisitorMemory): Promise<void> {
  await ensureDir();
  const filePath = join(VISITORS_DIR, `${vid}.json`);

  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(visitor, null, 2));
  await rename(tempPath, filePath);
}
