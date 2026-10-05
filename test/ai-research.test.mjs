import test from 'node:test';
import assert from 'node:assert/strict';
import { collectResearch, isPublicAddress } from '../server/ai/research.mjs';

test('public address classifier blocks IPv4/IPv6 private, mapped, documentation, multicast and reserved ranges', () => {
  for (const ip of [
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '172.31.1.1',
    '192.168.1.2',
    '192.0.2.3',
    '198.18.0.1',
    '203.0.113.2',
    '224.0.0.1',
    '240.1.1.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '2001:db8::1',
    '2002:7f00:1::',
    '3fff::1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])
    assert.equal(isPublicAddress(ip), true, ip);
});
test('URL/DNS/redirect defenses validate every hop and pin the connection address', async () => {
  let calls = 0;
  const lookup = async () => [{ address: '1.1.1.1', family: 4 }];
  for (const url of [
    'file:///etc/passwd',
    'http://localhost/x',
    'http://127.1/',
    'http://2130706433/',
    'http://[::1]/',
    'https://user:password@example.com/',
  ])
    await assert.rejects(
      collectResearch(url, undefined, {
        lookup,
        request: async () => {
          calls++;
        },
      }),
      (e) => e.code === 'research_blocked',
    );
  await assert.rejects(
    collectResearch('https://example.com/', undefined, {
      lookup: async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
      request: async () => {
        calls++;
      },
    }),
    (e) => e.code === 'research_blocked',
  );
  await assert.rejects(
    collectResearch('https://example.com/', undefined, {
      lookup,
      request: async (url, address) => {
        assert.equal(address.address, '1.1.1.1');
        calls++;
        return {
          statusCode: 302,
          headers: { location: 'http://192.168.1.1/' },
          body: Buffer.alloc(0),
        };
      },
    }),
    (e) => e.code === 'research_blocked',
  );
  assert.equal(calls, 1);
});
test('redirect/size/type/abort limits and HTML extraction preserve only collected sources', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  const request = async () => ({
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: Buffer.from(
      '<html><title>여행 &amp; 계획</title><script>secret()</script><h1>교토</h1><p>하루 한 장소</p></html>',
    ),
  });
  const material = await collectResearch('https://example.com/', undefined, { lookup, request });
  assert.equal(material.url, 'https://example.com/');
  assert.equal(material.title, '여행 & 계획');
  assert.match(material.text, /하루 한 장소/);
  assert.doesNotMatch(material.text, /secret/);
  await assert.rejects(
    collectResearch('https://example.com/', undefined, {
      lookup,
      request: async () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.alloc(2 * 1024 * 1024 + 1),
      }),
    }),
    (e) => e.code === 'research_too_large',
  );
  let hops = 0;
  await assert.rejects(
    collectResearch('https://example.com/', undefined, {
      lookup,
      request: async () => {
        hops++;
        return { statusCode: 302, headers: { location: '/next' + hops }, body: Buffer.alloc(0) };
      },
    }),
    (e) => e.code === 'research_failed',
  );
  assert.equal(hops, 4);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    collectResearch('https://example.com/', controller.signal, { lookup, request }),
  );
});
test(
  'collection deadline also bounds DNS and injected reads; outer abort stops immediately',
  { timeout: 150 },
  async () => {
    await assert.rejects(
      collectResearch('https://example.com/', undefined, {
        timeoutMs: 15,
        lookup: () => new Promise(() => {}),
      }),
      (e) => e.code === 'research_failed',
    );
    const controller = new AbortController();
    const pending = collectResearch('https://example.com/', controller.signal, {
      lookup: () => new Promise(() => {}),
    });
    controller.abort(new Error('caller stopped'));
    await assert.rejects(pending, /caller stopped/);
  },
);
