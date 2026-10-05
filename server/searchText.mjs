import { cleanItinerary } from '../shared/itinerary.ts';
export function foldSearchText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

// ASCII tokens are lossless code-point pairs. Positions preserve exact substrings,
// including Korean suffixes; FTS5 never interprets the user's operators or quotes.
export function encodeSearchText(value) {
  const points = Array.from(foldSearchText(value), (char) => char.codePointAt(0).toString(16));
  const tokens = [];
  for (let i = 0; i + 1 < points.length; i++) tokens.push('g' + points[i] + 'x' + points[i + 1]);
  return tokens.join(' ');
}

export function encodeSearchCharacters(value) {
  return [...new Set(Array.from(foldSearchText(value)))]
    .filter((char) => char !== ' ')
    .map((char) => 'u' + char.codePointAt(0).toString(16))
    .join(' ');
}

export function captureSearchText(text, url, rawRequest) {
  const request = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;
  return [
    ...new Set(
      [
        text,
        request?.input?.content,
        request?.input?.url,
        request?.template?.name,
        request?.prompt,
      ].filter(Boolean),
    ),
  ].join('\n');
}

export function pageSearchText(rawDocument) {
  const document = typeof rawDocument === 'string' ? JSON.parse(rawDocument) : rawDocument;
  const parts = [];
  const urls = [];
  function inline(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(inline).join('');
    if (!value || typeof value !== 'object') return '';
    if (typeof value.href === 'string') urls.push(value.href);
    if (value.rows) return value.rows.map((row) => row.cells?.map(inline).join('\n')).join('\n');
    return (
      (typeof value.text === 'string' ? value.text : '') +
      (value.content ? inline(value.content) : '')
    );
  }
  function blocks(items) {
    for (const block of items || []) {
      if (block.content) parts.push(inline(block.content));
      if (block.type === 'bookmark') {
        parts.push(block.props?.title, block.props?.description);
        if (block.props?.url) urls.push(block.props.url);
      }
      if (block.type === 'itinerary') {
        try {
          const plan = cleanItinerary(block.props?.data);
          parts.push(plan.title);
          for (const entry of plan.entries) {
            parts.push(entry.date, entry.start, entry.end, entry.title, entry.place, entry.note);
            if (entry.url) urls.push(entry.url);
          }
        } catch {
          /* Invalid legacy props never become searchable JSON. */
        }
      }
      blocks(block.children);
    }
  }
  blocks(document.blocks);
  return [...parts, ...urls].filter(Boolean).join('\n');
}

export function registerSearchFunctions(db) {
  db.function('search_tokens', { deterministic: true }, encodeSearchText);
  db.function('search_characters', { deterministic: true }, encodeSearchCharacters);
  db.function('search_fold', { deterministic: true }, foldSearchText);
  db.function('search_capture_text', { deterministic: true }, captureSearchText);
  db.function('search_page_text', { deterministic: true }, pageSearchText);
}

export function searchSnippet(body, terms, maximum = 180) {
  const text = String(body || '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return '';
  const chars = Array.from(text);
  const folded = text.toLowerCase();
  const position = Math.min(
    ...terms.map((term) => folded.indexOf(term)).filter((index) => index >= 0),
  );
  const start = Number.isFinite(position)
    ? Math.max(0, Array.from(text.slice(0, position)).length - 35)
    : 0;
  return (
    (start ? '…' : '') +
    chars.slice(start, start + maximum).join('') +
    (start + maximum < chars.length ? '…' : '')
  );
}
