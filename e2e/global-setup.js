import { promises as fs } from 'fs';
import { join } from 'path';

export default async function globalSetup() {
  process.env.TEST_MODE = process.env.TEST_MODE ?? 'true';
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'temp_dev_password_123';
  process.env.NTFY_TOPIC = process.env.NTFY_TOPIC ?? '';
  process.env.NTFY_SERVER = process.env.NTFY_SERVER ?? 'https://ntfy.sh';
  process.env.THREADS_DIR = process.env.THREADS_DIR ?? './data/threads/test';
  process.env.BLOCKED_DIR = process.env.BLOCKED_DIR ?? './data/blocked/test';

  await ensureDirClean(process.env.THREADS_DIR, 'test-');
  await ensureDirClean(process.env.BLOCKED_DIR, 'test-');
}

async function ensureDirClean(dir, prefix) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir);
    await Promise.all(entries.filter((entry) => entry.startsWith(prefix)).map((entry) => fs.rm(join(dir, entry), { force: true }))); 
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}
