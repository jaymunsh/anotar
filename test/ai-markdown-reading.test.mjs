import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderReadMarkdown } from '../src/ai/markdownReading.ts';
const render = (value) =>
  renderToStaticMarkup(createElement('article', null, renderReadMarkdown(value)));

test('AI reading renders headings, emphasis, lists, tables and code as structured text', () => {
  const html = render(
    '## Result\n\n**Decision** and *reason*.\n\n1. First\n2. Second\n\n| Time | Plan |\n| --- | --- |\n| 09:00 | Walk |\n\n```js\nconst x = 1;\n```',
  );
  assert.match(html, /<h2>Result<\/h2>/);
  assert.match(html, /<strong>Decision<\/strong>/);
  assert.match(html, /<em>reason<\/em>/);
  assert.match(html, /<ol/);
  assert.match(html, /<table>/);
  assert.match(html, /<code>const x = 1;/);
});

test('provider HTML stays text, dangerous URLs never become links, and remote images never load', () => {
  const html = render(
    '<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [data](data:text/html,hello) [ok](https://example.com)\n\n![image](https://tracker.example/image.png)',
  );
  assert.doesNotMatch(html, /<script|<img|href="javascript:|href="data:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('common escaped text is readable and checked lists are non-interactive', () => {
  const html = render('A &amp; B &lt; C\n\n- [x] Done\n- [ ] Next');
  assert.match(html, /A &amp; B &lt; C/);
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.match(html, /disabled=""/);
});
