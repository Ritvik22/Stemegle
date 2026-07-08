import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is required');

const migrationPaths = [
  '../supabase/migrations/202607070001_real_leaderboard.sql',
  '../supabase/migrations/202607080001_ranked_leaderboard.sql',
];
const sql = postgres(connectionString, { max: 1, prepare: false });

try {
  for (const path of migrationPaths) {
    const migration = await readFile(new URL(path, import.meta.url), 'utf8');
    await sql.unsafe(migration);
  }
  console.log('Applied leaderboard migrations.');
} finally {
  await sql.end();
}
