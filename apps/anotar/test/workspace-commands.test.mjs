import test from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
const module = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      stripTypeScriptTypes(
        readFileSync(new URL('../src/search/commands.ts', import.meta.url), 'utf8'),
      ),
    ).toString('base64')
);
test('Commands stay available for a one-character query and only expose page actions in a page', () => {
  assert.equal(
    module.workspaceCommands('m', false).some((command) => command.id === 'memo'),
    true,
  );
  assert.equal(
    module.workspaceCommands('', false).some((command) => command.id === 'move'),
    false,
  );
  assert.ok(module.workspaceCommands('현재 이동', true).some((command) => command.id === 'move'));
  assert.equal(module.workspaceCommands('AI', true)[0].id, 'ai');
  assert.deepEqual(module.workspaceCommands('없는 기능', true), []);
});
