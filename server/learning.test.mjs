import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createLearningSession,
  getLearningQuestionByKey,
  getWeakAreaRecommendation,
  LEARNING_DIFFICULTIES,
  LEARNING_SUBJECTS,
} from '../src/data/learning.js';

test('every subject and difficulty produces a deterministic ten-question lesson', () => {
  for (const subject of LEARNING_SUBJECTS) {
    for (const difficulty of LEARNING_DIFFICULTIES) {
      const input = { subject: subject.id, difficulty: difficulty.id, seed: 'test-seed', count: 10 };
      const first = createLearningSession(input);
      const second = createLearningSession(input);
      assert.equal(first.length, 10);
      assert.deepEqual(first, second);
      assert.equal(new Set(first.map((question) => question.key)).size, 10);
      assert.ok(first.every((question) => question.category === subject.id));
      assert.ok(first.every((question) => question.difficulty === difficulty.id));
      assert.ok(first.every((question) => question.topic && question.explanation));
      assert.ok(first.every((question) => /^[A-Za-z0-9:_-]{1,120}$/.test(question.key)));
      assert.ok(first.every((question) => {
        const trusted = getLearningQuestionByKey(question.key);
        return trusted?.category === question.category
          && trusted.difficulty === question.difficulty
          && trusted.answer === question.answer
          && trusted.choiceCount === question.choices.length;
      }));
    }
  }
});

test('trusted question lookups reject unknown keys and cannot be mutated', () => {
  const [question] = createLearningSession({
    subject: 'Chemistry',
    difficulty: 'Medium',
    seed: 'lookup-test',
    count: 1,
  });
  const trusted = getLearningQuestionByKey(question.key);
  assert.ok(Object.isFrozen(trusted));
  assert.equal(trusted.category, 'Chemistry');
  assert.equal(getLearningQuestionByKey('learn-chemistry-ffffffff'), null);
  assert.equal(getLearningQuestionByKey(null), null);
});

test('weak-area recommendations understand the player hub mastery contract', () => {
  assert.deepEqual(getWeakAreaRecommendation({
    mastery: [
      { category: 'Physics', difficulty: 'hard', masteryScore: 72 },
      { category: 'Biology', difficulty: 'medium', masteryScore: 38 },
    ],
  }), {
    subject: 'Biology',
    difficulty: 'Medium',
    topic: null,
    accuracy: 38,
  });
});
