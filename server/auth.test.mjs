import assert from 'node:assert/strict';
import { test } from 'node:test';
import { battleNameToAccountEmail, loginIdentityToEmail } from '../src/lib/accountIdentity.js';
import { normalizeBattleName, normalizeContactEmail } from './auth.mjs';

test('battle names are normalized and bounded before account writes', () => {
  assert.equal(normalizeBattleName('  Proton   Pilot  '), 'Proton Pilot');
  assert.equal(normalizeBattleName('A\u0000B'), 'AB');
  assert.equal(normalizeBattleName('A'), '');
  assert.equal(normalizeBattleName('x'.repeat(31)), '');
});

test('battle names produce stable private account emails without punctuation collisions', () => {
  assert.equal(
    battleNameToAccountEmail('  Proton   Pilot  '),
    battleNameToAccountEmail('Proton Pilot'),
  );
  assert.match(
    battleNameToAccountEmail('Proton Pilot'),
    /^protonpilot\.[0-9a-f]{8}@players\.stemegle\.com$/,
  );
  assert.notEqual(battleNameToAccountEmail('A-B'), battleNameToAccountEmail('AB'));
  assert.equal(loginIdentityToEmail(' ADMIN@CHEMMASTER.ORG '), 'admin@chemmaster.org');
  assert.equal(loginIdentityToEmail('Proton Pilot'), battleNameToAccountEmail('Proton Pilot'));
});

test('optional contact emails are normalized and invalid values are rejected', () => {
  assert.equal(normalizeContactEmail(' Player@Example.COM '), 'player@example.com');
  assert.equal(normalizeContactEmail(''), null);
  assert.equal(normalizeContactEmail('not-an-email'), false);
});
