const DEFAULT_RATING = 1200;

export function normalizeCompetitiveRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 100 && rating <= 4000
    ? Math.round(rating)
    : DEFAULT_RATING;
}

export function matchmakingRatingWindow(joinedAt, now = Date.now()) {
  const normalizedJoinedAt = Number(joinedAt);
  const waitingSeconds = Number.isFinite(normalizedJoinedAt)
    ? Math.max(0, (now - normalizedJoinedAt) / 1000)
    : 0;
  return Math.min(600, 100 + Math.floor(waitingSeconds / 5) * 50);
}

export function pairRatedPlayers(players, now = Date.now()) {
  const queue = [...players]
    // `false` is reserved for signed players whose server-owned daily quota is
    // exhausted. Guests have no ranked eligibility (`null`/missing) and can
    // still enter an unranked human match.
    .filter((player) => player?.playerId && player.rankedEligible !== false)
    .map((player) => {
      const joinedAt = Number(player.joinedAt);
      return {
        ...player,
        joinedAt: Number.isFinite(joinedAt) ? joinedAt : now,
        rating: normalizeCompetitiveRating(player.rating),
      };
    })
    .sort((left, right) => left.joinedAt - right.joinedAt
      || left.playerId.localeCompare(right.playerId));
  const pairs = [];
  const waiting = [];

  while (queue.length) {
    const player = queue.shift();
    const playerWindow = matchmakingRatingWindow(player.joinedAt, now);
    const candidates = queue
      .map((candidate, index) => ({
        candidate,
        index,
        gap: Math.abs(candidate.rating - player.rating),
        window: Math.max(playerWindow, matchmakingRatingWindow(candidate.joinedAt, now)),
      }))
      .filter((entry) => entry.gap <= entry.window)
      .sort((left, right) => left.gap - right.gap
        || left.candidate.joinedAt - right.candidate.joinedAt
        || left.candidate.playerId.localeCompare(right.candidate.playerId));

    if (!candidates.length) {
      waiting.push(player);
      continue;
    }

    const [{ candidate, index }] = candidates;
    queue.splice(index, 1);
    pairs.push([player, candidate]);
  }

  return { pairs, waiting };
}
