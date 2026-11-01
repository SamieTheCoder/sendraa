import pg from 'pg';

import { env } from './env.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = [], db: Queryable = pool) {
  const result = await db.query<T>(text, values);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(text: string, values: unknown[] = [], db: Queryable = pool) {
  const rows = await query<T>(text, values, db);
  return rows[0] ?? null;
}

/** Runs `fn` in a transaction. Any thrown error rolls it back. */
export async function transaction<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(
  db: Queryable,
  entry: { tenantId: string | null; actorId: string | null; action: string; resource?: string; metadata?: Record<string, unknown> },
) {
  await db.query(
    'insert into audit_log (tenant_id, actor_id, action, resource, metadata) values ($1, $2, $3, $4, $5)',
    [entry.tenantId, entry.actorId, entry.action, entry.resource ?? null, JSON.stringify(entry.metadata ?? {})],
  );
}
