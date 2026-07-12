import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

try {
  process.loadEnvFile?.('.env.local');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');

const runtimeRole = 'stemegle_app';
const runtimePassword = process.env.APP_DATABASE_PASSWORD;
if (!runtimePassword || !/^[A-Za-z0-9_-]{32,}$/.test(runtimePassword)) {
  throw new Error('APP_DATABASE_PASSWORD must be at least 32 URL-safe characters');
}

const { Pool } = pg;
const pool = new Pool({ connectionString, max: 1 });
const migrationsDirectory = new URL('../migrations/', import.meta.url);

function checksum(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

const client = await pool.connect();
try {
  await client.query('select pg_advisory_lock($1)', [741_902_611]);
  const runtimeRoleExists = await client.query(
    'select 1 from pg_roles where rolname = $1',
    [runtimeRole],
  );
  if (runtimeRoleExists.rowCount) {
    await client.query(`alter role ${runtimeRole} with login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole noinherit`);
  } else {
    await client.query(`create role ${runtimeRole} with login password '${runtimePassword}' nosuperuser nocreatedb nocreaterole noinherit`);
  }
  await client.query(`
    create table if not exists stemegle_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const filename of filenames) {
    const contents = await readFile(new URL(filename, migrationsDirectory), 'utf8');
    const digest = checksum(contents);
    const existing = await client.query(
      'select checksum from stemegle_schema_migrations where filename = $1',
      [filename],
    );

    if (existing.rowCount) {
      if (existing.rows[0].checksum !== digest) {
        throw new Error(`Applied migration ${filename} has changed`);
      }
      console.log(`Already applied ${filename}`);
      continue;
    }

    await client.query('begin');
    try {
      await client.query(contents);
      await client.query(
        'insert into stemegle_schema_migrations (filename, checksum) values ($1, $2)',
        [filename, digest],
      );
      await client.query('commit');
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  const databaseName = (await client.query('select current_database() as name')).rows[0].name;
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) throw new Error('Database name is not grant-safe');
  await client.query('begin');
  try {
    await client.query(`grant connect on database "${databaseName}" to ${runtimeRole}`);
    await client.query(`grant usage on schema public to ${runtimeRole}`);
    await client.query(`grant select, insert, update, delete on all tables in schema public to ${runtimeRole}`);
    await client.query(`grant usage, select, update on all sequences in schema public to ${runtimeRole}`);
    await client.query(`alter default privileges in schema public grant select, insert, update, delete on tables to ${runtimeRole}`);
    await client.query(`alter default privileges in schema public grant usage, select, update on sequences to ${runtimeRole}`);
    await client.query(`revoke all on stemegle_schema_migrations from ${runtimeRole}`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
} finally {
  await client.query('select pg_advisory_unlock($1)', [741_902_611]).catch(() => {});
  client.release();
  await pool.end();
}
