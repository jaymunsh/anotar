import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  parseWikiRoute,
  prepare,
  homeSummary,
  wikiLinkSlug,
  splitResult,
  matches,
  monday,
  builtAgo,
} from '../src/wiki/model.ts';
import { renderReadMarkdown } from '../src/ai/markdownReading.ts';

const data = {
  wiki: [
    { slug: 'old', title: 'Old', tldr: 'o', tags: ['a'], updated: '2026-09-01', body: '' },
    { slug: 'new', title: 'New', tldr: 'n', tags: 'b', updated: '2026-10-15', body: 'see [old](./old.md)' },
  ],
  sessions: [
    { slug: 's1', title: 'One', tldr: 't', tool: 'codex', project: 'p', date: '2026-10-14', next: ['x'], body: '' },
    { slug: 's2', title: 'Two', tldr: 't', tool: 'claude-code', project: 'q', date: '2026-09-20', next: 'y', candidates: ['c'], body: '' },
    { slug: 's3', title: '(내용 없음)', tldr: '', tool: 'codex', project: 'p', date: '2026-10-16', body: '' },
  ],
};

test('wiki routes map /wiki paths and decode ids', () => {
  assert.deepEqual(parseWikiRoute('/wiki'), { view: 'home' });
  assert.deepEqual(parseWikiRoute('/wiki/'), { view: 'home' });
  assert.deepEqual(parseWikiRoute('/wiki/pages'), { view: 'pages', slug: null });
  assert.deepEqual(parseWikiRoute('/wiki/pages/llm-wiki'), { view: 'pages', slug: 'llm-wiki' });
  assert.deepEqual(parseWikiRoute('/wiki/log/a%20b'), { view: 'log', slug: 'a b' });
  assert.deepEqual(parseWikiRoute('/wiki/projects/my-memory'), { view: 'projects', name: 'my-memory' });
});

test('prepare sorts newest first, hides empty sessions and groups projects', () => {
  const p = prepare(data);
  assert.deepEqual(p.wiki.map((w) => w.slug), ['new', 'old']);
  assert.deepEqual(p.sessions.map((s) => s.slug), ['s1', 's2']);
  assert.deepEqual([...p.projects.keys()], ['p', 'q']);
  const home = homeSummary(p, '2026-10-16');
  assert.equal(monday('2026-10-16'), '2026-10-12');
  assert.deepEqual(home.thisWeek.map((s) => s.slug), ['s1']);
  assert.deepEqual(home.open.map((o) => o.name), ['p', 'q']);
  assert.deepEqual(home.stale.map((o) => o.name), ['q']);
  assert.deepEqual(home.candidates.map((c) => c.text), ['c']);
});

test('wiki links, result split and search', () => {
  assert.equal(wikiLinkSlug('./old.md'), 'old');
  assert.equal(wikiLinkSlug('../wiki/old.md#part'), 'old');
  assert.equal(wikiLinkSlug('https://x.test/old.md'), null);
  assert.equal(wikiLinkSlug('javascript:alert(1)'), null);
  const { result, rest } = splitResult('## 맥락\na\n## 결과\nb\n## 다음\nc');
  assert.equal(result, '## 결과\nb\n');
  assert.equal(rest, '## 맥락\na\n## 다음\nc');
  assert.equal(matches(['Hello', ['World']], 'hello wor'), true);
  assert.equal(matches(['Hello'], 'bye'), false);
});

test('markdown link option routes wiki links in-app and keeps external links safe', () => {
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      renderReadMarkdown('[old](./old.md) [ext](https://example.com) [bad](javascript:alert(1)) <script>x</script>', {
        link: (href) => (wikiLinkSlug(href) ? { href: '/wiki/pages/' + wikiLinkSlug(href) } : undefined),
      }),
    ),
  );
  assert.match(html, /<a href="\/wiki\/pages\/old">old<\/a>/);
  assert.match(html, /href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /javascript:|<script/);
  // Option does not leak into the next call.
  const plain = renderToStaticMarkup(createElement('div', null, renderReadMarkdown('[old](./old.md)')));
  assert.doesNotMatch(plain, /href/);
});

test('builtAgo says how old the Mac build is', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.equal(builtAgo(null, now), null);
  assert.equal(builtAgo('nope', now), null);
  assert.equal(builtAgo('2026-10-17T11:59:40Z', now), '방금');
  assert.equal(builtAgo('2026-10-17T11:15:00Z', now), '45분 전');
  assert.equal(builtAgo('2026-10-17T09:00:00Z', now), '3시간 전');
  assert.equal(builtAgo('2026-10-15T12:00:00Z', now), '2일 전');
});
