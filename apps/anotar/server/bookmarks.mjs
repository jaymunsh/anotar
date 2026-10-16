import { collectResearch } from './ai/research.mjs';
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, key) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (named[key.toLowerCase()]) return named[key.toLowerCase()];
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}
const clean = (value, max) =>
  decode(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
export function parseBookmarkMetadata(html, url) {
  const meta = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    const key = (attributes.property || attributes.name || '').toLowerCase();
    if (!meta.has(key)) meta.set(key, attributes.content || '');
  }
  let imageUrl = '';
  try {
    const image = new URL(decode(meta.get('og:image') || meta.get('twitter:image') || ''), url);
    if (
      (meta.get('og:image') || meta.get('twitter:image')) &&
      ['https:', 'http:'].includes(image.protocol) &&
      !image.username &&
      !image.password
    )
      imageUrl = image.href;
  } catch {}
  return {
    url,
    title:
      clean(
        meta.get('og:title') ||
          meta.get('twitter:title') ||
          html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
        240,
      ) || new URL(url).hostname,
    description: clean(
      meta.get('og:description') || meta.get('description') || meta.get('twitter:description'),
      600,
    ),
    imageUrl,
  };
}
export function safeBookmarkImage(body, contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (body.length > 32 * 1024 || body.length < 12) return '';
  const valid =
    (mime === 'image/png' &&
      body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' && body[0] === 255 && body[1] === 216 && body[2] === 255) ||
    (mime === 'image/webp' &&
      body.toString('ascii', 0, 4) === 'RIFF' &&
      body.toString('ascii', 8, 12) === 'WEBP');
  return valid ? `data:${mime};base64,${body.toString('base64')}` : '';
}
export function createBookmarkService({ collect = collectResearch } = {}) {
  const cache = new Map();
  let active = 0;
  return {
    async read(url, signal) {
      const prior = cache.get(url);
      if (prior && Date.now() - prior.at < 15 * 60 * 1000) return prior.item;
      if (active >= 2) throw Error('잠시 뒤 다시 시도해 주세요.');
      active++;
      try {
        const metadata = await collect(url, signal, {
          timeoutMs: 7000,
          transformResponse: ({ url: finalUrl, body }) =>
            parseBookmarkMetadata(body.toString('utf8'), finalUrl),
        });
        let imageData = '';
        if (metadata.imageUrl)
          try {
            imageData = await collect(metadata.imageUrl, signal, {
              timeoutMs: 4000,
              allowedContentType: /^image\/(png|jpeg|webp)\b/i,
              transformResponse: ({ body, contentType }) => safeBookmarkImage(body, contentType),
            });
          } catch {}
        const item = {
          url: metadata.url,
          title: metadata.title,
          description: metadata.description,
          imageData,
        };
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(url, { at: Date.now(), item });
        return item;
      } finally {
        active--;
      }
    },
  };
}
