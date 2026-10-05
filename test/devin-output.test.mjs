import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDevinOutput } from '../server/ai/devinOutput.mjs';
test('Devin print onboarding banner and ANSI styling are separated from the strict JSON response', () => {
  const output = '\u001b[1mWelcome to Devin CLI!\u001b[0m\n\n{"markdown":"실제 결과"}\n';
  assert.equal(parseDevinOutput(output).markdown, '실제 결과');
  assert.equal(parseDevinOutput('```json\n{"markdown":"확인"}\n```').markdown, '확인');
  assert.throws(() => parseDevinOutput('unrecognized logs\n{"markdown":"not accepted"}'));
  assert.throws(() => parseDevinOutput('{"markdown":123}'));
});
