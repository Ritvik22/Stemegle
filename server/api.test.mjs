import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateEloRating,
  deriveAchievements,
  normalizeChatReport,
  normalizeChatReportStatus,
  normalizeLearningAttempt,
  validBotMatchId,
} from './api.mjs';
import { createLearningSession } from '../src/data/learning.js';

test('Elo ratings use provisional and established K factors', () => {
  assert.deepEqual(calculateEloRating(1200, 1200, 1, 0), {
    ratingBefore: 1200,
    ratingAfter: 1220,
    ratingChange: 20,
    kFactor: 40,
  });
  assert.deepEqual(calculateEloRating(1200, 1200, 0.5, 9), {
    ratingBefore: 1200,
    ratingAfter: 1200,
    ratingChange: 0,
    kFactor: 40,
  });
  assert.deepEqual(calculateEloRating(1200, 1200, 0, 10), {
    ratingBefore: 1200,
    ratingAfter: 1188,
    ratingChange: -12,
    kFactor: 24,
  });
});

test('bot match IDs use a namespace disjoint from human participant IDs', () => {
  assert.equal(validBotMatchId('bot-11111111-1111-4111-8111-111111111111'), true);
  assert.equal(validBotMatchId('player-a--player-b'), false);
  assert.equal(validBotMatchId('bot-player-a--player-b'), false);
  assert.equal(validBotMatchId('human-looking-id'), false);
});

test('learning attempts normalize their public contract and reject invalid data', () => {
  const [question] = createLearningSession({
    subject: 'Physics',
    difficulty: 'Hard',
    seed: 'trusted-attempt-test',
    count: 1,
  });
  assert.deepEqual(normalizeLearningAttempt({
    attemptId: '11111111-1111-4111-8111-111111111111',
    questionKey: question.key,
    selectedIndex: question.answer,
    category: 'Biology',
    difficulty: 'easy',
    correct: false,
    timeMs: 4200,
  }), {
    attemptId: '11111111-1111-4111-8111-111111111111',
    questionKey: question.key,
    selectedIndex: question.answer,
    category: 'Physics',
    difficulty: 'hard',
    correct: true,
    responseMs: 4200,
  });
  const wrongIndex = (question.answer + 1) % question.choices.length;
  const spoofed = normalizeLearningAttempt({
    attemptId: '44444444-4444-4444-8444-444444444444',
    questionKey: question.key,
    selectedIndex: wrongIndex,
    category: 'Biology',
    difficulty: 'easy',
    correct: true,
    responseMs: 900,
  });
  assert.equal(spoofed.category, 'Physics');
  assert.equal(spoofed.difficulty, 'hard');
  assert.equal(spoofed.correct, false);
  assert.equal(normalizeLearningAttempt({
    attemptId: 'not-a-uuid',
    questionKey: question.key,
    selectedIndex: question.answer,
    responseMs: 10,
  }), null);
  assert.equal(normalizeLearningAttempt({
    attemptId: '22222222-2222-4222-8222-222222222222',
    questionKey: 'learn-physics-does-not-exist',
    selectedIndex: 0,
    responseMs: 10,
  }), null);
  assert.equal(normalizeLearningAttempt({
    attemptId: '33333333-3333-4333-8333-333333333333',
    questionKey: question.key,
    selectedIndex: question.choices.length,
    responseMs: 10,
  }), null);
});

test('chat reports are bounded, normalized, and allow only supported reasons', () => {
  assert.deepEqual(normalizeChatReport({
    reportToken: 'a'.repeat(43),
    reason: 'SPAM',
  }), {
    reportToken: 'a'.repeat(43),
    reason: 'spam',
  });
  assert.equal(normalizeChatReport({
    reportToken: 'a'.repeat(43),
    reason: 'because-i-said-so',
  }), null);
  assert.equal(normalizeChatReportStatus(' ACTIONED '), 'actioned');
  assert.equal(normalizeChatReportStatus('pending'), '');
});

test('player achievements are derived without storing duplicate state', () => {
  const achievements = deriveAchievements({
    matches_played: 3,
    wins: 5,
    best_streak: 2,
  }, { attempts: 12, mastered_tracks: 1 });
  assert.equal(achievements.find((item) => item.id === 'first-match').earned, true);
  assert.equal(achievements.find((item) => item.id === 'five-wins').earned, true);
  assert.equal(achievements.find((item) => item.id === 'hot-streak').earned, false);
  assert.equal(achievements.find((item) => item.id === 'subject-mastery').earned, true);
});
