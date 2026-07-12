import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBattleName } from './auth.mjs';

test('battle names are normalized and bounded before account writes', () => {
  assert.equal(normalizeBattleName('  Proton   Pilot  '), 'Proton Pilot');
  assert.equal(normalizeBattleName('A\u0000B'), 'AB');
  assert.equal(normalizeBattleName('A'), '');
  assert.equal(normalizeBattleName('x'.repeat(31)), '');
});
