const baseUrl = new URL(process.env.STEMEGLE_URL || 'http://127.0.0.1:8787');

if (process.env.STEMEGLE_BACKEND_URL) {
  const healthResponse = await fetch(new URL('/health', process.env.STEMEGLE_BACKEND_URL));
  if (!healthResponse.ok) throw new Error(`Backend health check failed (${healthResponse.status})`);
  const health = await healthResponse.json();
  if (health.ok !== true) throw new Error('Backend reported an unhealthy database');
}

const response = await fetch(new URL('/api/stats', baseUrl));
if (!response.ok) throw new Error(`Stats request failed (${response.status})`);
const stats = await response.json();

for (const field of ['onlineCount', 'gamesPlayed', 'registeredUsers']) {
  if (!Number.isInteger(stats[field]) || stats[field] < 0) {
    throw new Error(`Stats response contains an invalid ${field}`);
  }
}
if (!Array.isArray(stats.leaders)) throw new Error('Stats response omitted the leaderboard');
if (stats.leaders.length > 10) throw new Error('Leaderboard returned more than ten rows');

stats.leaders.forEach((leader, index) => {
  if (Number(leader.rank_position) !== index + 1) {
    throw new Error('Leaderboard ranks are not sequential');
  }
  if (index > 0 && Number(leader.total_score) > Number(stats.leaders[index - 1].total_score)) {
    throw new Error('Leaderboard is not ordered by score');
  }
});

console.log(
  `LEADERBOARD_SMOKE_OK: ${stats.gamesPlayed} matches, ${stats.registeredUsers} players, ${stats.leaders.length} visible ranks`,
);
