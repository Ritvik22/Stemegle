import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

try {
  process.loadEnvFile?.('.env.local');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const { pool, withTransaction } = await import('../server/db.mjs');

const exportDirectory = resolve(process.env.LEGACY_EXPORT_DIR || './legacy-export');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function integer(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`Invalid ${field} in the legacy export`);
  }
  return parsed;
}

function timestamp(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} in the legacy export`);
  }
  return date.toISOString();
}

function profileRow(profile) {
  if (!UUID_PATTERN.test(profile?.id || '')) {
    throw new Error('Invalid profile ID in the legacy export');
  }
  const battleName = String(profile.battle_name || '').trim();
  if (battleName.length < 2 || battleName.length > 30) {
    throw new Error('Invalid battle name in the legacy export');
  }
  return {
    id: profile.id,
    battleName,
    totalScore: integer(profile.total_score, 'profile score'),
    wins: integer(profile.wins, 'profile wins'),
    losses: integer(profile.losses, 'profile losses'),
    matchesPlayed: integer(profile.matches_played, 'profile match count'),
    streak: integer(profile.streak, 'profile streak'),
    bestStreak: integer(profile.best_streak ?? profile.streak, 'profile best streak'),
    createdAt: timestamp(profile.created_at, 'profile creation time'),
    updatedAt: timestamp(profile.updated_at || profile.created_at, 'profile update time'),
  };
}

function matchRow(match) {
  const id = String(match?.id || '');
  if (id.length < 10 || id.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(id)) {
    throw new Error('Invalid match ID in the legacy export');
  }
  return {
    id,
    completedAt: timestamp(match.completed_at, 'match completion time'),
  };
}

async function readJson(filename) {
  const parsed = JSON.parse(await readFile(resolve(exportDirectory, filename), 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${filename} must contain a JSON array`);
  return parsed;
}

try {
  const [profiles, matches] = await Promise.all([
    readJson('profiles.json'),
    readJson('matches.json'),
  ]);
  const profileRows = profiles.map(profileRow);
  const matchRows = matches.map(matchRow);

  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('stemegle-legacy-public-import'))");
    for (const profile of profileRows) {
      await client.query(`
        insert into legacy_profiles (
          legacy_id, battle_name, total_score, wins, losses, matches_played,
          streak, best_streak, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (legacy_id) do update set
          battle_name = excluded.battle_name,
          total_score = excluded.total_score,
          wins = excluded.wins,
          losses = excluded.losses,
          matches_played = excluded.matches_played,
          streak = excluded.streak,
          best_streak = excluded.best_streak,
          updated_at = excluded.updated_at
      `, [
        profile.id,
        profile.battleName,
        profile.totalScore,
        profile.wins,
        profile.losses,
        profile.matchesPlayed,
        profile.streak,
        profile.bestStreak,
        profile.createdAt,
        profile.updatedAt,
      ]);
    }

    for (const match of matchRows) {
      await client.query(`
        insert into matches (id, mode, completed_at)
        values ($1, 'legacy', $2)
        on conflict (id) do nothing
      `, [match.id, match.completedAt]);
    }
  });

  console.log(`Imported ${profileRows.length} legacy profiles and ${matchRows.length} legacy matches.`);
} finally {
  await pool.end();
}
