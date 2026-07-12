import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL
  || 'postgresql://stemegle:stemegle@127.0.0.1:5432/stemegle';

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_SIZE) || 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
