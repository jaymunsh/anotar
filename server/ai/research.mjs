import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { AiExecutionError } from './contracts.mjs';

const BYTE_LIMIT = 2 * 1024 * 1024;
const fail = (code) => {
  throw new AiExecutionError(code);
};
const v4 = (ip) => ip.split('.').reduce((result, part) => result * 256 + Number(part), 0);
const inV4 = (ip, base, bits) =>
  Math.floor(v4(ip) / 2 ** (32 - bits)) === Math.floor(v4(base) / 2 ** (32 - bits));
function v6(ip) {
  const [left, right = ''] = ip.split('::');
  const a = left ? left.split(':') : [],
    b = right ? right.split(':') : [];
  return [...a, ...Array(8 - a.length - b.length).fill('0'), ...b].reduce(
    (value, part) => (value << 16n) | BigInt('0x' + part),
    0n,
  );
}
export function isPublicAddress(ip) {
  if (isIP(ip) === 4)
    return ![
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => inV4(ip, base, bits));
  if (isIP(ip) !== 6 || ip.includes('.') || ip.includes('%')) return false;
  const value = v6(ip);
  const within = (base, bits) => value >> BigInt(128 - bits) === v6(base) >> BigInt(128 - bits);
  // Only unicast global space; conservatively omit transition/special/documentation ranges.
  return (
    within('2000::', 3) &&
    ![
      ['2001::', 23],
      ['2001:db8::', 32],
      ['2002::', 16],
      ['3fff::', 20],
    ].some(([base, bits]) => within(base, bits))
  );
}
function publicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('research_blocked');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 2048
  )
    fail('research_blocked');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local)$/i.test(host) || (isIP(host) && !isPublicAddress(host)))
    fail('research_blocked');
  url.hash = '';
  return url;
}
export function readPublicResponse(url, address, signal) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        signal,
        method: 'GET',
        agent: false,
        headers: {
          'User-Agent': 'leneu-research/1.0',
          Accept: 'text/html,text/plain,application/xhtml+xml',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.destroy();
          resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        if (Number(res.headers['content-length']) > BYTE_LIMIT) {
          res.destroy();
          reject(new AiExecutionError('research_too_large'));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > BYTE_LIMIT) {
            res.destroy(new AiExecutionError('research_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, key) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (named[key.toLowerCase()]) return named[key.toLowerCase()];
    const number =
      key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
}
function textFromHtml(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/?(?:p|div|h[1-6]|li|br|tr|section|article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}
function withAbort(promise, signal) {
  signal.throwIfAborted();
  let listener;
  const aborted = new Promise((_, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() =>
    signal.removeEventListener('abort', listener),
  );
}
export async function collectResearch(
  raw,
  outerSignal,
  {
    lookup = (host) => dnsLookup(host, { all: true, verbatim: true }),
    request = readPublicResponse,
    timeoutMs = 10_000,
    allowedContentType = /^(text\/(html|plain)|application\/xhtml\+xml)\b/i,
    transformResponse,
  } = {},
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
  let url = publicUrl(raw);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      signal.throwIfAborted();
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await withAbort(lookup(host), signal);
      signal.throwIfAborted();
      if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
        fail('research_blocked');
      const response = await withAbort(request(url, addresses[0], signal), signal);
      signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        if (hop === 3 || !response.headers.location) fail('research_failed');
        url = publicUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) fail('research_failed');
      if (response.body.length > BYTE_LIMIT) fail('research_too_large');
      const contentType = response.headers['content-type'] || '';
      if (!allowedContentType.test(contentType))
        fail('research_failed');
      if (transformResponse) return transformResponse({ url: url.href, contentType, body: response.body });
      const body = response.body.toString('utf8');
      const html = !/^text\/plain/i.test(contentType);
      const text = (html ? textFromHtml(body) : body.trim()).slice(0, 50_000);
      if (!text) fail('research_failed');
      const title = html
        ? decodeEntities(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
            .replace(/<[^>]*>/g, '')
            .trim()
            .slice(0, 200)
        : '';
      return {
        url: url.href,
        title: title || url.hostname,
        text,
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (error) {
    if (outerSignal?.aborted) throw outerSignal.reason;
    if (error instanceof AiExecutionError) throw error;
    fail('research_failed');
  }
}
