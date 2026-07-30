import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODEGLE_DIFFICULTIES,
  CODEGLE_LANGUAGES,
  CODEGLE_PROBLEMS,
  getCodegleProblem,
  getCodegleProblemForMatch,
} from '../src/data/codegleProblems.js';
import { codegleTests } from './codegle-tests.mjs';
import { CODEGLE_HINT_PENALTY_MS, codegleHints } from './codegle-hints.mjs';

test('Codegle problems have complete public prompts, four starters, and private judge cases', () => {
  assert.equal(CODEGLE_PROBLEMS.length, 18);
  assert.deepEqual(CODEGLE_LANGUAGES.map(({ id }) => id), ['python', 'java', 'cpp', 'javascript']);
  assert.deepEqual(CODEGLE_DIFFICULTIES.map(({ id }) => id), ['beginner', 'intermediate', 'advanced']);
  for (const { id } of CODEGLE_DIFFICULTIES) {
    assert.equal(CODEGLE_PROBLEMS.filter((problem) => problem.difficulty === id).length, 6);
  }
  for (const problem of CODEGLE_PROBLEMS) {
    assert.equal(getCodegleProblem(problem.id), problem);
    assert.ok(problem.title && problem.description && problem.inputFormat && problem.outputFormat);
    assert.ok(problem.examples.length >= 1);
    for (const language of CODEGLE_LANGUAGES) {
      assert.ok(problem.starter[language.id]?.trim(), `${problem.id} needs a ${language.id} starter`);
    }
    const tests = codegleTests(problem.id);
    assert.ok(tests.length >= 4, `${problem.id} needs at least four hidden cases`);
    assert.ok(tests.every((entry) => typeof entry.input === 'string' && typeof entry.expected === 'string'));
    const hints = codegleHints(problem.id);
    assert.ok(hints.length >= 2, `${problem.id} needs at least two progressive hints`);
    assert.ok(hints.every((hint) => typeof hint === 'string' && hint.length >= 20));
    assert.equal(problem.tests, undefined, 'judge cases must not ship in public problem data');
    assert.equal(problem.hints, undefined, 'hints must be revealed by the server, not shipped publicly');
  }
  assert.equal(CODEGLE_HINT_PENALTY_MS, 10_000);
});

test('Codegle problem selection is deterministic for both opponents', () => {
  const matchId = 'player-a--player-b';
  for (const { id } of CODEGLE_DIFFICULTIES) {
    const problem = getCodegleProblemForMatch(matchId, id);
    assert.equal(problem, getCodegleProblemForMatch(matchId, id));
    assert.equal(problem.difficulty, id);
    assert.ok(CODEGLE_PROBLEMS.includes(problem));
  }
});
