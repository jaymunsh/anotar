import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the URL contract without loading a browser editor or accessing user data.
const load = () => import('../shared/pageLinks.ts');
const id = '12345678-abcd-4321-9876-123456789abc';
const origin = 'https://notes.example';

test('a copied owner page URL identifies its existing page and preserves a normal link', async () => {
  const { parsePageLink } = await load();
  assert.deepEqual(parsePageLink(`${origin}/pages/${id}?view=read#section`, origin), {
    pageId: id,
    url: `${origin}/pages/${id}?view=read#section`,
  });
  assert.deepEqual(parsePageLink(`/pages/${id}`, origin), {
    pageId: id,
    url: `${origin}/pages/${id}`,
  });
});

test('external pages, public shares and malformed paths remain ordinary URLs', async () => {
  const { parsePageLink } = await load();
  for (const value of [
    `https://other.example/pages/${id}`,
    `${origin}/s/token`,
    `${origin}/pages/no-id`,
    `${origin}/pages/${id}/children`,
    `${origin}/pages/${id}\n/pages/${id}`,
    `https://user:secret@notes.example/pages/${id}`,
    `//notes.example/pages/${id}`,
  ])
    assert.equal(parsePageLink(value, origin), null, value);
});

test('copying a page link does not retain comment, AI or editor query state', async () => {
  const { pageLinkAddress } = await load();
  assert.equal(
    pageLinkAddress(id, `${origin}/pages/other?aiJob=private#comment`),
    `${origin}/pages/${id}`,
  );
});
