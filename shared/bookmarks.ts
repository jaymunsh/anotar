export function webBookmarkUrl(raw: string): string {
  const value = raw.trim();
  if (/\s/.test(value)) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.href.length <= 2048
      ? url.href
      : '';
  } catch {
    return '';
  }
}
export function validBookmarkImage(value: unknown): boolean {
  if (value === '' || value === undefined) return true;
  if (typeof value !== 'string' || value.length > 45000) return false;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) return false;
  const prefix = match[2];
  return match[1] === 'png'
    ? prefix.startsWith('iVBORw0KGgo')
    : match[1] === 'jpeg'
      ? prefix.startsWith('/9j/')
      : prefix.startsWith('UklGR');
}
