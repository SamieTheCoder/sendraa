import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getMigrations } from 'better-auth/db/migration';

import { auth } from './auth.js';
import { pool } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main() {
  // 1. Better Auth's own tables (user, session, account, verification).
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) {
    await runMigrations();
    console.log(`auth schema: created ${toBeCreated.map((t) => t.table).join(', ') || 'nothing'}, updated ${toBeAdded.map((t) => t.table).join(', ') || 'nothing'}`);
  } else {
    console.log('auth schema: up to date');
  }

  // 2. Control-plane migrations, each applied once in its own transaction.
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set((await pool.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(await readFile(join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('migrations up to date');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
