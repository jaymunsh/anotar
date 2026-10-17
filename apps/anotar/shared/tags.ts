// #태그: starts a word (line start or after whitespace/opening bracket), begins with a letter,
// then letters, digits, _ - / . URL fragments (page#x), #1 and Markdown headings (# 제목) are not tags.
export const tagPattern = /(?<=^|[\s(\[])#(\p{L}[\p{L}\p{N}_\-/]*)/gu;

export function extractTags(text: string): string[] {
  const tags = new Set<string>();
  for (const match of text.matchAll(tagPattern)) tags.add(match[1].replace(/[-/]+$/, '').toLowerCase());
  return [...tags];
}

/** A page document's text for tag lookup: code and link text become a non-boundary mark, as in the editor. */
export function pageTagText(document: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: string; text?: string; styles?: { code?: boolean }; props?: unknown; children?: unknown };
    if (node.type === 'codeBlock') return;
    if (node.type === 'link') return void parts.push('\u0000');
    if (node.type === 'text') return void parts.push(node.styles?.code ? '\u0000' : (node.text ?? ''));
    if (node.props && node.children) parts.push('\n');
    for (const child of Object.values(node)) visit(child);
  };
  visit(document);
  return parts.join('');
}
