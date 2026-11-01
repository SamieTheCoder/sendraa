import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';

/**
 * Persists the original MIME bytes.
 *
 * The parsed representation in Postgres is lossy by design, so the raw copy is
 * what makes re-parsing, export, and "show original" possible later.
 */
export async function putRaw(mailboxId: string, raw: Buffer): Promise<string> {
  const now = new Date();
  const key = join(
    mailboxId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.eml`,
  );

  if (env.RAW_STORAGE_DRIVER === 'fs') {
    const path = safeJoin(env.RAW_STORAGE_PATH, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, raw);
    return key;
  }

  throw new Error(`raw storage driver not implemented: ${env.RAW_STORAGE_DRIVER}`);
}

export async function getRaw(key: string): Promise<Buffer> {
  if (env.RAW_STORAGE_DRIVER === 'fs') {
    return readFile(safeJoin(env.RAW_STORAGE_PATH, key));
  }
  throw new Error(`raw storage driver not implemented: ${env.RAW_STORAGE_DRIVER}`);
}

/**
 * Joins a storage key onto the base path, refusing anything that escapes it.
 * Keys are generated internally today, but attachment filenames and future
 * API-supplied keys make traversal a real risk worth closing off here.
 */
function safeJoin(base: string, key: string): string {
  const target = normalize(join(base, key));
  const root = normalize(base.endsWith('/') ? base : `${base}/`);
  if (!target.startsWith(root)) {
    throw new Error('storage key escapes the storage root');
  }
  return target;
}
