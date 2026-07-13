export const COMPETITIVE_RATING_TIERS = Object.freeze([
  Object.freeze({ minimum: 2000, name: 'Grandmaster' }),
  Object.freeze({ minimum: 1800, name: 'Master' }),
  Object.freeze({ minimum: 1600, name: 'Expert' }),
  Object.freeze({ minimum: 1400, name: 'Scholar' }),
  Object.freeze({ minimum: 1200, name: 'Challenger' }),
  Object.freeze({ minimum: 1000, name: 'Explorer' }),
  Object.freeze({ minimum: 100, name: 'Beginner' }),
]);

export function normalizeCompetitiveRating(value, fallback = 1200) {
  const parsed = Number(value);
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 1200;
  return Math.max(100, Math.min(4000, Math.round(Number.isFinite(parsed) ? parsed : normalizedFallback)));
}

export function getCompetitiveRatingTier(rating, gamesPlayed = 0) {
  const value = normalizeCompetitiveRating(rating);
  const games = Math.max(0, Math.trunc(Number(gamesPlayed) || 0));
  if (games < 10) {
    return {
      name: 'Placement',
      provisional: true,
      placementGames: 10 - games,
      value,
    };
  }

  return {
    name: COMPETITIVE_RATING_TIERS.find((tier) => value >= tier.minimum)?.name || 'Beginner',
    provisional: false,
    placementGames: 0,
    value,
  };
}
