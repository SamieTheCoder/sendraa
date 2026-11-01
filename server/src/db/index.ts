import postgres from 'postgres';
import { env } from '../env.js';

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  // Mail bodies are large and arbitrary; let postgres.js parameterise
  // everything rather than interpolating anything by hand.
  transform: { undefined: null },
});

export type Sql = typeof sql;

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
