import { QUESTION_BANK, getQuestionsForMatch } from '../src/data/questions.js';

const prompts = new Set();
const categories = new Map();

for (const question of QUESTION_BANK) {
  if (question.choices.length !== 4) throw new Error(`Expected four choices: ${question.q}`);
  if (question.answer < 0 || question.answer > 3) throw new Error(`Invalid answer: ${question.q}`);
  if (prompts.has(question.q)) throw new Error(`Duplicate prompt: ${question.q}`);
  prompts.add(question.q);
  categories.set(question.category, (categories.get(question.category) ?? 0) + 1);
}

if (QUESTION_BANK.length < 100) throw new Error(`Expected 100+ questions, found ${QUESTION_BANK.length}`);

const first = getQuestionsForMatch('shared-match-id');
const second = getQuestionsForMatch('shared-match-id');
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Match selection is not deterministic.');
if (new Set(first.map((question) => question.category)).size !== first.length) {
  throw new Error('A match should use distinct STEM categories.');
}

console.log(`QUESTION_BANK_OK:${QUESTION_BANK.length}`);
console.log(`CATEGORIES:${JSON.stringify(Object.fromEntries(categories))}`);
console.log(`MATCH_SAMPLE:${first.map((question) => question.q).join(' | ')}`);
