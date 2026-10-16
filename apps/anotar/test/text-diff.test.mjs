import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTextLines } from '../shared/textDiff.ts';
const collect = (rows, side) =>
  rows
    .filter((row) => row[side] !== undefined)
    .map((row) => row[side])
    .join('\n');
test('changed lines keep equal context and pair red before with green after', () => {
  const a = '유지할 첫 줄\n회의 10시\n유지할 끝 줄',
    b = '유지할 첫 줄\n회의 11시\n유지할 끝 줄';
  const diff = compareTextLines(a, b);
  assert.deepEqual(
    diff.rows.map((row) => row.kind),
    ['same', 'changed', 'same'],
  );
  assert.equal(collect(diff.rows, 'before'), a);
  assert.equal(collect(diff.rows, 'after'), b);
});
test('added and removed lines retain repeated lines, blank lines and original order', () => {
  for (const [a, b] of [
    ['반복\n반복\n끝', '반복\n새 줄\n반복\n끝'],
    ['첫\n삭제\n\n끝', '첫\n\n끝'],
    ['', '새 내용'],
    ['삭제할 내용', ''],
  ]) {
    const diff = compareTextLines(a, b);
    assert.equal(collect(diff.rows, 'before'), a);
    assert.equal(collect(diff.rows, 'after'), b);
    assert.ok(diff.rows.some((row) => row.kind !== 'same'));
  }
});
test('missing blocks have only added or only removed lines; unchanged text is neutral', () => {
  assert.deepEqual(
    compareTextLines(null, '코드\n둘째').rows.map((row) => row.kind),
    ['added', 'added'],
  );
  assert.deepEqual(
    compareTextLines('없어질 줄', null).rows.map((row) => row.kind),
    ['removed'],
  );
  assert.ok(
    compareTextLines('같은 텍스트', '같은 텍스트').rows.every((row) => row.kind === 'same'),
  );
});
test('large comparisons bound matching work while preserving full text', () => {
  const a = Array.from({ length: 700 }, (_, i) => '기존 ' + i).join('\n');
  const b = Array.from({ length: 700 }, (_, i) => '변경 ' + i).join('\n');
  const diff = compareTextLines(a, b);
  assert.equal(diff.coarse, true);
  assert.equal(collect(diff.rows, 'before'), a);
  assert.equal(collect(diff.rows, 'after'), b);
});
test('text comparisons preserve Korean, emoji, literal HTML and trailing newlines', () => {
  const a = '안녕 👩‍💻\n<script>alert(1)</script>\n',
    b = '안녕 👨‍💻\n<script>alert(2)</script>\n';
  const diff = compareTextLines(a, b);
  assert.equal(collect(diff.rows, 'before'), a);
  assert.equal(collect(diff.rows, 'after'), b);
});
