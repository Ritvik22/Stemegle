import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  matchmakingRatingWindow,
  normalizeCompetitiveRating,
  pairRatedPlayers,
} from '../src/lib/matchmaking.js';

test('rating normalization and search windows stay bounded', () => {
  assert.equal(normalizeCompetitiveRating('1451.6'), 1452);
  assert.equal(normalizeCompetitiveRating('not-a-rating'), 1200);
  assert.equal(matchmakingRatingWindow(100_000, 100_000), 100);
  assert.equal(matchmakingRatingWindow(100_000, 115_000), 250);
  assert.equal(matchmakingRatingWindow(0, 1_000_000), 600);
});

test('rated matchmaking pairs the closest eligible players deterministically', () => {
  const now = 100_000;
  const players = [
    { playerId: 'oldest', joinedAt: 90_000, rating: 1200 },
    { playerId: 'far', joinedAt: 91_000, rating: 1700 },
    { playerId: 'near', joinedAt: 92_000, rating: 1275 },
    { playerId: 'far-near', joinedAt: 93_000, rating: 1660 },
  ];
  const result = pairRatedPlayers(players, now);
  assert.deepEqual(result.pairs.map((pair) => pair.map((player) => player.playerId)), [
    ['oldest', 'near'],
    ['far', 'far-near'],
  ]);
  assert.deepEqual(result.waiting, []);
});

test('rating bands widen for long waits without forcing new arrivals together', () => {
  const result = pairRatedPlayers([
    { playerId: 'veteran', joinedAt: 0, rating: 1200 },
    { playerId: 'newcomer', joinedAt: 999_000, rating: 1700 },
    { playerId: 'unmatched', joinedAt: 999_500, rating: 2500 },
  ], 1_000_000);
  assert.deepEqual(result.pairs[0].map((player) => player.playerId), ['veteran', 'newcomer']);
  assert.equal(result.waiting[0].playerId, 'unmatched');
});

test('daily-limit players are excluded while guests can still play unranked', () => {
  const result = pairRatedPlayers([
    { playerId: 'daily-capped', joinedAt: 1, rating: 1200, rankedEligible: false },
    { playerId: 'signed-player', joinedAt: 2, rating: 1200, rankedEligible: true },
    { playerId: 'guest-player', joinedAt: 3, rating: 1200, rankedEligible: null },
  ], 10);
  assert.deepEqual(result.pairs.map((pair) => pair.map((player) => player.playerId)), [
    ['signed-player', 'guest-player'],
  ]);
  assert.deepEqual(result.waiting, []);
});
