import assert from 'node:assert/strict';
import test from 'node:test';
import { codeShapeFromSource, isCodeShape, MAX_CODE_SHAPE_LINES } from '../src/lib/codeShape.js';

test('code silhouettes reveal only coarse line widths and indentation', () => {
  const source = 'const privateAnswer = "do not leak";\n  return privateAnswer;\n\n';
  const shape = codeShapeFromSource(source);
  assert.deepEqual(shape, [
    { indent: 0, width: 8 },
    { indent: 1, width: 5 },
    { indent: 0, width: 0 },
    { indent: 0, width: 0 },
  ]);
  assert.equal(JSON.stringify(shape).includes('privateAnswer'), false);
  assert.equal(JSON.stringify(shape).includes('do not leak'), false);
  assert.equal(isCodeShape(shape), true);
  assert.equal(isCodeShape([{ indent: 0, width: 4, source: 'secret' }]), false);
});

test('code silhouettes cap line count, indentation, and width', () => {
  const source = Array.from(
    { length: MAX_CODE_SHAPE_LINES + 20 },
    () => `${' '.repeat(30)}${'x'.repeat(200)}`,
  ).join('\n');
  const shape = codeShapeFromSource(source);
  assert.equal(shape.length, MAX_CODE_SHAPE_LINES);
  assert.deepEqual(shape[0], { indent: 6, width: 12 });
});
