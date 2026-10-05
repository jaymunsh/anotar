import { cleanItinerary } from './itinerary.ts';
import { webBookmarkUrl, validBookmarkImage } from './bookmarks.ts';
import { calloutColors, calloutIcons } from './callout.ts';
const allowedTypes = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'quote',
  'codeBlock',
  'divider',
  'table',
  'diagram',
  'tableOfContents',
  'page',
  'captureRef',
  'asset',
  'map',
  'itinerary',
  'bookmark',
  'callout',
]);

// 본문(content) 없이 저장되는 블록
const noContentTypes = new Set([
  'bookmark',
  'divider',
  'tableOfContents',
  'page',
  'captureRef',
  'asset',
  'map',
  'itinerary',
]);

export class PageValidationError extends Error {
  name = 'PageValidationError';
}

export class PageConflictError extends Error {
  name = 'PageConflictError';
}

export function cleanPageTitle(value) {
  if (typeof value !== 'string') throw new PageValidationError('페이지 제목이 올바르지 않습니다.');
  const title = value.trim() || '제목 없음';
  if (title.length > 160)
    throw new PageValidationError('페이지 제목은 160자까지 입력할 수 있습니다.');
  return title;
}

export function cleanPageIcon(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string')
    throw new PageValidationError('페이지 아이콘이 올바르지 않습니다.');
  const icon = value.trim();
  // 이모지는 결합자·ZWJ 조합으로 길어질 수 있어 UTF-16 기준 여유를 둔다
  if (icon.length > 20)
    throw new PageValidationError('페이지 아이콘은 이모지 하나만 넣을 수 있습니다.');
  return icon;
}

export function cleanPageParentId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9-]{1,100}$/.test(value))
    throw new PageValidationError('상위 페이지가 올바르지 않습니다.');
  return value;
}

function checkValue(value, depth, state) {
  if (depth > 16 || ++state.nodes > 30000)
    throw new PageValidationError('페이지 내용이 너무 복잡합니다.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PageValidationError('올바르지 않은 숫자입니다.');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 50000) throw new PageValidationError('한 블록의 내용이 너무 깁니다.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 3000) throw new PageValidationError('페이지 내용이 너무 깁니다.');
    value.forEach((item) => checkValue(item, depth + 1, state));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw new PageValidationError('올바르지 않은 페이지 데이터입니다.');
  for (const [key, item] of Object.entries(value)) {
    if (['href', 'url', 'src'].includes(key) && typeof item === 'string' && item) {
      const safe = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i.test(item);
      if (!safe) throw new PageValidationError('사용할 수 없는 링크가 포함돼 있습니다.');
    }
    checkValue(item, depth + 1, state);
  }
}

export function serializePageDocument(document) {
  if (
    !document ||
    document.schemaVersion !== 1 ||
    !Array.isArray(document.blocks) ||
    document.blocks.length < 1
  )
    throw new PageValidationError('올바르지 않은 블록 문서입니다.');
  const ids = new Set();
  let blockCount = 0;
  function checkBlocks(blocks, depth) {
    if (depth > 8) throw new PageValidationError('블록을 너무 깊게 중첩했습니다.');
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || Array.isArray(block))
        throw new PageValidationError('올바르지 않은 블록입니다.');
      if (++blockCount > 1000)
        throw new PageValidationError('페이지는 최대 1,000개 블록까지 저장합니다.');
      if (typeof block.id !== 'string' || !block.id || block.id.length > 100 || ids.has(block.id))
        throw new PageValidationError('블록 ID가 올바르지 않습니다.');
      if (!allowedTypes.has(block.type)) throw new PageValidationError('지원하지 않는 블록입니다.');
      if (!block.props || typeof block.props !== 'object' || Array.isArray(block.props))
        throw new PageValidationError('블록 속성이 올바르지 않습니다.');
      if (block.type === 'callout') {
        const props = block.props;
        if (Object.keys(props).some(key => !['backgroundColor', 'textColor', 'textAlignment', 'icon', 'border'].includes(key)) ||
            !calloutColors.includes(props.backgroundColor ?? 'default') ||
            !calloutColors.includes(props.textColor ?? 'default') ||
            !['left', 'center', 'right', 'justify'].includes(props.textAlignment ?? 'left') ||
            !calloutIcons.includes(props.icon ?? 'lightbulb') ||
            (props.border !== undefined && typeof props.border !== 'boolean') ||
            !Array.isArray(block.content))
          throw new PageValidationError('콜아웃의 색상·아이콘·내용이 올바르지 않아요.');
      }
      if (block.type === 'table') {
        const rows = block.content?.rows;
        const columns = rows?.[0]?.cells?.length;
        if (
          block.content?.type !== 'tableContent' ||
          !Array.isArray(rows) ||
          rows.length < 1 ||
          rows.length > 200 ||
          !Number.isInteger(columns) ||
          columns < 1 ||
          columns > 30 ||
          !rows.every(
            (row) =>
              Array.isArray(row?.cells) &&
              row.cells.length === columns &&
              row.cells.every(
                (cell) =>
                  Array.isArray(cell) ||
                  (cell?.type === 'tableCell' && Array.isArray(cell.content)),
              ),
          )
        )
          throw new PageValidationError('표 데이터가 올바르지 않습니다.');
      } else if (block.type === 'captureRef' || block.type === 'asset') {
        const field = block.type === 'captureRef' ? 'captureId' : 'assetId';
        if (
          typeof block.props[field] !== 'string' ||
          !/^[a-f0-9-]{1,100}$/.test(block.props[field])
        )
          throw new PageValidationError(
            block.type === 'asset'
              ? '첨부 파일 ID가 올바르지 않습니다.'
              : '원본 메모 ID가 올바르지 않습니다.',
          );
        if (block.type === 'asset' && !['image', 'file'].includes(block.props.display))
          throw new PageValidationError('첨부 표시 방식이 올바르지 않습니다.');
        if (
          Object.keys(block.props).some(
            (key) => ![field, ...(block.type === 'asset' ? ['display'] : [])].includes(key),
          )
        )
          throw new PageValidationError('참조 블록에는 ID와 표시 방식만 저장합니다.');
      } else if (block.type === 'bookmark') {
        if (typeof block.props.url !== 'string' || !webBookmarkUrl(block.props.url) ||
          Object.keys(block.props).some(key => !['url','title','description','imageData'].includes(key)) ||
          (block.props.title !== undefined && (typeof block.props.title !== 'string' || block.props.title.length > 240)) ||
          (block.props.description !== undefined && (typeof block.props.description !== 'string' || block.props.description.length > 600)) ||
          !validBookmarkImage(block.props.imageData))
          throw new PageValidationError('북마크 정보를 확인해 주세요.');
      } else if (block.type === 'page') {
        if (
          typeof block.props.pageId !== 'string' ||
          !/^[a-f0-9-]{1,100}$/.test(block.props.pageId)
        )
          throw new PageValidationError('페이지 블록의 대상이 올바르지 않습니다.');
        if (
          'title' in block.props &&
          (typeof block.props.title !== 'string' || block.props.title.length > 160)
        )
          throw new PageValidationError('페이지 블록의 제목이 올바르지 않습니다.');
      } else if (block.type === 'itinerary') {
        if (
          Object.keys(block.props).some((key) => !['data', 'assetId', 'imageSource', 'imageInput'].includes(key)) ||
          typeof block.props.data !== 'string'
        )
          throw new PageValidationError('일정 블록의 자료가 올바르지 않아요.');
        if (
          block.props.assetId !== undefined &&
          (typeof block.props.assetId !== 'string' ||
            (block.props.assetId !== '' && !/^[a-f0-9-]{1,100}$/.test(block.props.assetId)))
        )
          throw new PageValidationError('지도 이미지 ID가 올바르지 않아요.');
        if ((block.props.imageSource !== undefined && !['', 'geoapify'].includes(block.props.imageSource)) ||
            (block.props.imageInput !== undefined && (typeof block.props.imageInput !== 'string' || block.props.imageInput.length > 15000)))
          throw new PageValidationError('지도 이미지 출처가 올바르지 않아요.');
        try {
          cleanItinerary(block.props.data);
        } catch (error) {
          throw new PageValidationError(error.message);
        }
      } else if (block.type === 'map') {
        const { latitude, longitude, zoom, label } = block.props;
        if (
          typeof latitude !== 'number' ||
          !Number.isFinite(latitude) ||
          latitude < -90 ||
          latitude > 90 ||
          typeof longitude !== 'number' ||
          !Number.isFinite(longitude) ||
          longitude < -180 ||
          longitude > 180 ||
          !Number.isInteger(zoom) ||
          zoom < 1 ||
          zoom > 19 ||
          typeof label !== 'string' ||
          label.length > 160 ||
          Object.keys(block.props).some(
            (key) => !['latitude', 'longitude', 'zoom', 'label', 'assetId'].includes(key),
          ) ||
          (block.props.assetId !== undefined &&
            (typeof block.props.assetId !== 'string' ||
              (block.props.assetId !== '' && !/^[a-f0-9-]{1,100}$/.test(block.props.assetId))))
        )
          throw new PageValidationError('지도 위치가 올바르지 않습니다.');
      } else if (!noContentTypes.has(block.type) && !Array.isArray(block.content)) {
        throw new PageValidationError('블록 내용이 올바르지 않습니다.');
      }
      if (!Array.isArray(block.children))
        throw new PageValidationError('블록 자식이 올바르지 않습니다.');
      ids.add(block.id);
      checkBlocks(block.children, depth + 1);
    }
  }
  checkBlocks(document.blocks, 0);
  checkValue(document, 0, { nodes: 0 });
  const serialized = JSON.stringify(document);
  if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024)
    throw new PageValidationError('페이지는 최대 1MB까지 저장합니다.');
  return serialized;
}
