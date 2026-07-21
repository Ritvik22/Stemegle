import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuestionPackInput, validQuestionPackImage } from './api.mjs';

test('question packs normalize valid author input', () => {
  const normalized = normalizeQuestionPackInput({
    title: '  Algebra   Review  ',
    questions: [{
      prompt: '  What is   2 + 2? ',
      choices: [' 3 ', ' 4 ', ' 5 ', ' 6 '],
      answerIndex: 1,
      imageId: 'f65b0944-6d8e-4f7c-9ad7-47f68356de8c',
    }],
  });
  assert.deepEqual(normalized, {
    title: 'Algebra Review',
    questions: [{
      prompt: 'What is 2 + 2?',
      choices: ['3', '4', '5', '6'],
      answerIndex: 1,
      imageId: 'f65b0944-6d8e-4f7c-9ad7-47f68356de8c',
    }],
  });
});

test('question packs reject incomplete, duplicate, oversized, and malformed questions', () => {
  const base = {
    title: 'Review',
    questions: [{ prompt: 'Question?', choices: ['A', 'B', 'C', 'D'], answerIndex: 0 }],
  };
  assert.equal(normalizeQuestionPackInput({ ...base, title: '' }), null);
  assert.equal(normalizeQuestionPackInput({ ...base, questions: [] }), null);
  assert.equal(normalizeQuestionPackInput({ ...base, questions: [{ ...base.questions[0], choices: ['A', 'A', 'C', 'D'] }] }), null);
  assert.equal(normalizeQuestionPackInput({ ...base, questions: [{ ...base.questions[0], answerIndex: 4 }] }), null);
  assert.equal(normalizeQuestionPackInput({ ...base, questions: [{ ...base.questions[0], imageId: 'not-a-uuid' }] }), null);
  assert.equal(normalizeQuestionPackInput({ ...base, questions: Array.from({ length: 51 }, () => base.questions[0]) }), null);
});

test('question image validation checks declared type, size, and file signature', () => {
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.from('valid-enough-test-payload'),
  ]);
  assert.equal(validQuestionPackImage('image/png', png), true);
  assert.equal(validQuestionPackImage('image/jpeg', png), false);
  assert.equal(validQuestionPackImage('image/svg+xml', png), false);
  assert.equal(validQuestionPackImage('image/png', Buffer.alloc(7)), false);
  assert.equal(validQuestionPackImage('image/png', Buffer.alloc(1024 * 1024 + 1)), false);
});
