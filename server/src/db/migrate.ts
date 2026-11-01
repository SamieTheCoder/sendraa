import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, closeDb } from './index.js';
import { logger } from '../lib/logger.js';

// SQL lives outside src/ so it is not subject to tsc's rootDir, and resolves
// identically whether running from src/ via tsx or from dist/ after a build.
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../db/migrations');

async function main() {
  await sql`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const ddl = await readFile(join(migrationsDir, file), 'utf8');
    logger.info({ file }, 'applying migration');

    // Each migration runs in its own transaction so a failure leaves the
    // database on the last good migration rather than half-applied.
    await sql.begin(async (tx) => {
      await tx.unsafe(ddl);
      await tx`insert into schema_migrations (name) values (${file})`;
    });

    count += 1;
  }

  logger.info({ applied: count, total: files.length }, 'migrations up to date');
}

main()
  .catch((err) => {
    logger.error({ err }, 'migration failed');
    process.exitCode = 1;
  })
  .finally(closeDb);
