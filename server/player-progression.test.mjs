import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getCompetitiveRatingTier,
  normalizeCompetitiveRating,
} from '../src/lib/playerProgression.js';

test('competitive ratings normalize to the supported Elo range', () => {
  assert.equal(normalizeCompetitiveRating('1432.6'), 1433);
  assert.equal(normalizeCompetitiveRating(-50), 100);
  assert.equal(normalizeCompetitiveRating(9000), 4000);
  assert.equal(normalizeCompetitiveRating('unknown'), 1200);
});

test('competitive tiers stay provisional for ten games then follow Elo thresholds', () => {
  assert.deepEqual(getCompetitiveRatingTier(2100, 9), {
    name: 'Placement',
    provisional: true,
    placementGames: 1,
    value: 2100,
  });
  assert.equal(getCompetitiveRatingTier(999, 10).name, 'Beginner');
  assert.equal(getCompetitiveRatingTier(1000, 10).name, 'Explorer');
  assert.equal(getCompetitiveRatingTier(1200, 10).name, 'Challenger');
  assert.equal(getCompetitiveRatingTier(1400, 10).name, 'Scholar');
  assert.equal(getCompetitiveRatingTier(1600, 10).name, 'Expert');
  assert.equal(getCompetitiveRatingTier(1800, 10).name, 'Master');
  assert.equal(getCompetitiveRatingTier(2000, 10).name, 'Grandmaster');
});
