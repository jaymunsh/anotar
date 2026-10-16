export type PastedPageLink = { pageId: string; url: string };
export function parsePageLink(raw: string, origin: string): PastedPageLink | null {
  const value = raw.trim();
  if (!value || /\s/.test(value) || value.startsWith('//')) return null;
  if (!value.startsWith('/pages/') && !/^https?:\/\//i.test(value)) return null;
  try {
    const base = new URL(origin);
    const url = new URL(value, base.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return null;
    const match = url.pathname.match(
      /^\/pages\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i,
    );
    return match ? { pageId: match[1].toLowerCase(), url: url.href } : null;
  } catch {
    return null;
  }
}
export function pageLinkAddress(pageId: string, origin: string): string {
  return new URL(`/pages/${pageId}`, new URL(origin).origin).href;
}
