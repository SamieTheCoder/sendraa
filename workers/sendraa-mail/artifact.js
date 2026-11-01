// Node-side loader for the deployable artifact: the bundled script, its D1
// migrations and a version that changes whenever either changes. The
// provisioner and the fleet upgrader read this; the Worker never does.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export const WORKER_NAME = 'sendraa-mail';
// Keep in sync with wrangler.jsonc.
export const COMPATIBILITY_DATE = '2026-10-23';

const root = new URL('./', import.meta.url);

export async function loadArtifact() {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  let script;
  try {
    script = await readFile(new URL('dist/worker.js', root), 'utf8');
  } catch {
    throw new Error('workers/sendraa-mail/dist/worker.js is missing. Run `pnpm --filter @sendraa/mail-worker build`.');
  }
  const files = (await readdir(new URL('schema/', root))).filter((f) => f.endsWith('.sql')).sort();
  const migrations = await Promise.all(
    files.map(async (name) => ({ name, sql: await readFile(new URL(`schema/${name}`, root), 'utf8') })),
  );
  const hash = createHash('sha256');
  hash.update(script);
  for (const m of migrations) hash.update(m.name).update(m.sql);
  return {
    name: WORKER_NAME,
    compatibilityDate: COMPATIBILITY_DATE,
    version: `${pkg.version}+${hash.digest('hex').slice(0, 10)}`,
    script,
    migrations,
  };
}
