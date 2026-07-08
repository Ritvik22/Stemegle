import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is required');

const migrationPath = new URL('../supabase/migrations/202607070001_real_leaderboard.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');
const sql = postgres(connectionString, { max: 1, prepare: false });

try {
  await sql.unsafe(migration);
  console.log('Applied real leaderboard migration.');
} finally {
  await sql.end();
}
