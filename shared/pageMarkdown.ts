import { itineraryMarkdown, itineraryPlaceUrl } from './itinerary.ts';
const privateTypes = new Set(['captureRef', 'asset', 'page', 'tableOfContents']);
function inline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (item.type === 'link') return `[${inline(item.content)}](${item.href})`;
      let text = item.text || '';
      if (item.styles?.code) return '`' + text + '`';
      if (item.styles?.bold) text = '**' + text + '**';
      if (item.styles?.italic) text = '_' + text + '_';
      if (item.styles?.strike) text = '~~' + text + '~~';
      return text;
    })
    .join('');
}
// Pure conversion. AI snapshots omit app references by default; explicit page export
// can retain their identifiers. Neither mode fetches private resources or file bytes.
export function renderPageMarkdown(
  blocks: unknown[],
  depth = 0,
  options: { includeAppReferences?: boolean } = {},
): string {
  const out: string[] = [];
  for (const block of blocks as any[]) {
    if (options.includeAppReferences && block.type === 'asset') {
      out.push(
        `첨부 ${block.props.display === 'image' ? '이미지' : '파일'} (앱 전용 참조, 파일 바이트 제외): ${block.props.assetId}`,
      );
    } else if (options.includeAppReferences && block.type === 'page') {
      out.push(`[${block.props.title || '제목 없음'}](/pages/${block.props.pageId})`);
    } else if (!privateTypes.has(block.type)) {
      const text = inline(block.content),
        indent = '  '.repeat(depth);
      const prefixes: Record<string, string> = {
        bulletListItem: '- ',
        numberedListItem: '1. ',
        checkListItem: block.props.checked ? '- [x] ' : '- [ ] ',
        quote: '> ',
        callout: '> ',
        toggleListItem: '- ',
      };
      if (block.type === 'bookmark')
        out.push(`[${String(block.props.title || block.props.url).replace(/[\[\]\\]/g, '\\$&')}](${block.props.url})` + (block.props.description ? '\n\n' + block.props.description : ''));
      else if (block.type === 'heading')
        out.push('#'.repeat(Math.min(6, block.props.level || 1)) + ' ' + text);
      else if (block.type === 'divider') out.push('---');
      else if (block.type === 'itinerary') {
        out.push(itineraryMarkdown(block.props.data));
        if (options.includeAppReferences && block.props.assetId)
          out.push(`지도 이미지 (앱 전용 참조, 파일 바이트 제외): ${block.props.assetId}`);
      } else if (block.type === 'map') {
        const { latitude, longitude, label } = block.props;
        out.push(`[${label || '지도'}](${itineraryPlaceUrl({ latitude, longitude } as any)})`);
        if (options.includeAppReferences && block.props.assetId)
          out.push(`지도 이미지 (앱 전용 참조, 파일 바이트 제외): ${block.props.assetId}`);
      } else if (block.type === 'codeBlock' || block.type === 'diagram')
        out.push(
          '```' +
            (block.type === 'diagram' ? 'mermaid' : block.props.language || '') +
            '\n' +
            text +
            '\n```',
        );
      else if (block.type === 'table') {
        const rows = block.content.rows.map(
          (row: any) =>
            '| ' +
            row.cells
              .map((cell: any) =>
                inline(Array.isArray(cell) ? cell : cell.content)
                  .replace(/\|/g, '\\|')
                  .replace(/\n/g, ' '),
              )
              .join(' | ') +
            ' |',
        );
        rows.splice(1, 0, '| ' + block.content.rows[0].cells.map(() => '---').join(' | ') + ' |');
        out.push(rows.join('\n'));
      } else if (block.type === 'callout' && text)
        out.push(text.split('\n').map(line => indent + '> ' + line).join('\n'));
      else if (text) out.push(indent + (prefixes[block.type] || '') + text);
    }
    if (block.children?.length)
      out.push(
        renderPageMarkdown(block.children, depth + (privateTypes.has(block.type) ? 0 : 1), options),
      );
  }
  return out.filter(Boolean).join('\n\n');
}
