import {documentTitle} from '../shared/documentTitle.ts';
import { assetCropStyles, assetFileSize, IMAGE_MIME } from '../shared/assetPresentation.mjs';
import {
  cleanItinerary,
  itineraryPlaceUrl,
  itineraryRelatedUrl,
  itineraryVisitNumbers,
  itineraryRoutes,
  itineraryCategories,
  itineraryDuration,
  itineraryOverlaps,
} from '../shared/itinerary.ts';
import { itineraryPreviewSvg } from '../shared/itineraryPreview.ts';
import { staticMapInput, staticMapStops } from '../shared/staticMap.ts';
import { itineraryDaySummaries, itineraryNoteLines } from '../shared/itineraryReading.ts';
import { calloutColors, calloutIcons, calloutIconSvg } from '../shared/callout.ts';
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );

function safeHref(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function inline(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((node) => {
      if (!node || typeof node !== 'object') return '';
      if (node.type === 'link') {
        const href = safeHref(node.href);
        const label = inline(node.content);
        return href
          ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`
          : label;
      }
      let result = escapeHtml(node.text || '').replace(/\r?\n/g, '<br>');
      const styles = node.styles || {};
      if (styles.code) result = `<code>${result}</code>`;
      if (styles.bold) result = `<strong>${result}</strong>`;
      if (styles.italic) result = `<em>${result}</em>`;
      if (styles.underline) result = `<u>${result}</u>`;
      if (styles.strike) result = `<s>${result}</s>`;
      return result;
    })
    .join('');
}

function flattenPlain(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((node) => (node.type === 'link' ? flattenPlain(node.content) : String(node.text || '')))
    .join('');
}

export function referencedAssetIds(document) {
  const ids = new Set();
  function visit(blocks) {
    for (const block of blocks || []) {
      if (['captureRef', 'page', 'tableOfContents'].includes(block.type)) continue;
      if (['asset', 'map', 'itinerary'].includes(block.type) && block.props?.assetId)
        ids.add(block.props.assetId);
      visit(block.children);
    }
  }
  visit(document?.blocks);
  return ids;
}

function publicExcerpt(block) {
  if (block.type === 'itinerary') {
    try {
      return `일정 · ${cleanItinerary(block.props?.data).title || '일정'}`;
    } catch {
      return '일정';
    }
  }
  if (block.type === 'map') return block.props?.label || '장소 지도';
  if (block.type === 'asset') return '첨부 파일';
  if (block.type === 'table') return '표';
  if (block.type === 'divider') return '구분선';
  return flattenPlain(block.content).trim().slice(0, 200) || '빈 블록';
}

// Lucide 0.468.0 geometry (ISC), matching the editor's activity markers.
function activityIcon(category) {
  const shapes = {
    meal: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    rest: '<path d="M10 2v2M14 2v2M6 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
    stay: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
    other:
      '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    sightseeing:
      '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    travel:
      '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0ZM20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0ZM16 17h4M4 13h4"/>',
  };
  return shapes[category]
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[category]}</svg>`
    : '';
}

function renderBlocks(
  blocks,
  token,
  assets,
  commentsEnabled = false,
  planTasks = [],
  headings = [],
) {
  let listNumber = 0;
  return (blocks || [])
    .map((block) => {
      listNumber = block.type === 'numberedListItem'
        ? (Number.isInteger(block.props?.start) && block.props.start >= 0 ? block.props.start : listNumber + 1)
        : 0;
      if (block.type === 'captureRef') return '';
      if (block.type === 'page')
        return '<section class="block"><p class="private-link">연결된 페이지 · 공유 범위 밖</p></section>';
      const content = inline(block.content);
      let html = '';
      let commentable = true;
      switch (block.type) {
        case 'bookmark': {
          const props = block.props || {};
          html = `<a class="saved-bookmark" href="${escapeHtml(props.url)}" target="_blank" rel="noopener noreferrer">${props.imageData ? `<img src="${escapeHtml(props.imageData)}" alt="" loading="lazy">` : ''}<span><strong>${escapeHtml(props.title || props.url)}</strong>${props.description ? `<span>${escapeHtml(props.description)}</span>` : ''}<small>${escapeHtml(new URL(props.url).hostname)}</small></span></a>`;
          break;
        }
        case 'itinerary': {
          try {
            const plan = cleanItinerary(block.props?.data);
            const numbers = itineraryVisitNumbers(plan.entries);
            const overlaps = itineraryOverlaps(plan.entries);
            const days = itineraryDaySummaries(plan.entries);
            let previousDate = '';
            const entries = plan.entries
              .map((entry) => {
                const date =
                  previousDate === entry.date
                    ? ''
                    : (() => {
                        const day = days.find((day) => day.date === entry.date);
                        return `<div class="itinerary-day itinerary-day-summary"><strong>${escapeHtml(day.label)}</strong><span>${day.start}${day.end !== day.start ? '–' + day.end : ''} · 방문 ${day.visits}곳</span><span class="itinerary-day-labels" aria-hidden="true">시간 / 일정</span></div>`;
                      })();
                previousDate = entry.date;
                const map = itineraryPlaceUrl(entry),
                  related = itineraryRelatedUrl(entry),
                  duration = itineraryDuration(entry);
                const number = numbers.get(entry.id);
                const notes = itineraryNoteLines(entry.note);
                const sharedTasks =
                  planTasks.find(
                    (group) => group.blockId === block.id && group.entryId === entry.id,
                  )?.tasks || [];
                const preparations = sharedTasks.length
                  ? `<ul class="itinerary-preparations" aria-label="준비 할 일">${sharedTasks.map((task) => `<li><span class="itinerary-preparation-status">${task.status === 'done' ? '완료' : '준비 중'}</span><span>${escapeHtml(task.title)}</span></li>`).join('')}</ul>`
                  : '';
                const details =
                  (notes.length
                    ? `<div class="itinerary-entry-note">${notes.map((line) => `<p class="itinerary-note-line${line.time ? ' is-timed' : ''}${line.label ? ' is-property' : ''}">${line.time ? `<span class="itinerary-note-time">${escapeHtml(line.time)}</span>` : ''}${line.label ? `<span class="itinerary-note-label">${escapeHtml(line.label)}</span>` : ''}<span>${escapeHtml(line.text)}</span></p>`).join('')}</div>`
                    : '') + preparations;
                return `<li class="itinerary-activity-${entry.category || 'other'}${number ? '' : ' itinerary-travel'}">${date}<div class="itinerary-stop"><span class="itinerary-time"><time>${entry.start}</time>${entry.end ? `<small>– ${entry.end}</small>` : ''}${duration ? `<span class="itinerary-duration">${duration}</span>` : ''}</span><span class="itinerary-number"${number ? '' : ' aria-hidden="true"'}>${number || activityIcon(entry.category)}</span><span class="itinerary-stop-text"><span class="itinerary-entry-title"><strong>${escapeHtml(entry.title)}</strong>${entry.category ? `<span class="itinerary-category">${itineraryCategories[entry.category]}</span>` : ''}</span>${overlaps.has(entry.id) ? '<span class="itinerary-overlap">시간 겹침</span>' : ''}${entry.place && entry.place !== entry.title ? `<span class="itinerary-entry-place">${escapeHtml(entry.place)}</span>` : ''}</span></div>${map || related ? `<div class="itinerary-links">${map ? `<a href="${escapeHtml(map)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(entry.title)} Google Maps에서 열기">장소 ↗</a>` : ''}${related ? `<a href="${escapeHtml(related)}" target="_blank" rel="noopener noreferrer">관련 링크 ↗</a>` : ''}</div>` : ''}${details}</li>`;
              })
              .join('');
            const asset = assets.get(block.props.assetId);
            const isImage = asset && /^image\/(png|jpeg|webp|gif|avif)$/.test(asset.mime);
            const src = isImage
              ? `/s/${token}/assets/${asset.id}`
              : 'data:image/svg+xml;base64,' +
                Buffer.from(itineraryPreviewSvg(plan.entries)).toString('base64');
            const routes = itineraryRoutes(plan.entries);
            const stops = staticMapStops(plan.entries);
            const mapLegend = stops.length
              ? `<ol class="itinerary-map-stops" aria-label="지도 방문 장소">${stops.map((stop) => `<li><a href="${escapeHtml(stop.url)}" target="_blank" rel="noopener noreferrer"><span class="itinerary-map-stop-number">${stop.number}</span><span><strong>${escapeHtml(stop.name)}</strong><small>${escapeHtml(stop.start)} · 장소 보기</small></span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M21 14v7H3V3h7"/></svg></a></li>`).join('')}</ol>`
              : '';
            const routeLinks = routes.length
              ? `<nav class="itinerary-route-links" aria-label="날짜별 지도 경로">${routes.map((route) => `<a href="${escapeHtml(route.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(route.date)} · ${route.numbers.join(' → ')} ↗</a>`).join('')}</nav>`
              : '';
            const mapCredit =
              isImage && block.props.imageSource === 'geoapify'
                ? `<details class="itinerary-map-credit"><summary>지도 출처</summary><p>Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a></p></details>${block.props.imageInput !== staticMapInput(plan.entries) ? '<p class="itinerary-map-stale" role="status">일정이 변경되어 지도에는 이전 방문 위치·순서가 표시돼요.</p>' : ''}`
                : '';
            const preview = plan.entries.length
              ? `<figure class="itinerary-preview"><a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" aria-label="${isImage ? '지도 이미지 크게 보기' : '방문 순서 이미지 크게 보기'}"${isImage ? '' : ' download="방문순서.svg"'}><img src="${src}" alt="${escapeHtml(isImage ? asset.name : '방문 위치와 순서. 실제 도로 지도는 장소 링크에서 확인하세요.')}" loading="lazy"></a><figcaption><span>방문 순서 · 실제 길찾기는 Google Maps에서</span><a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">크게 보기 ↗</a></figcaption>${mapLegend}<p class="itinerary-image-error" role="status" hidden>이미지를 불러오지 못했어요. 아래 일정과 장소 링크를 이용해 주세요.</p>${mapCredit}${routeLinks}</figure>`
              : '';
            html = `<section class="itinerary-block" data-static-itinerary><div class="itinerary-heading"><strong>${escapeHtml(plan.title || '일정')}</strong><small>UTC+9</small></div><div class="itinerary-reading">${preview}<ol class="itinerary-timeline">${entries || '<li>아직 일정이 없어요.</li>'}</ol></div></section>`;
          } catch {
            html = '<p>일정 자료를 표시할 수 없어요.</p>';
            commentable = false;
          }
          break;
        }
        case 'heading': {
          const authoredLevel = Math.max(1, Math.min(6, Number(block.props?.level) || 1));
          const level = Math.min(6, authoredLevel + 1);
          html = `<h${level} data-heading-level="${authoredLevel}">${content}</h${level}>`;
          break;
        }
        case 'paragraph':
          html = `<p>${content || '&nbsp;'}</p>`;
          break;
        case 'toggleListItem':
          html = content;
          break;
        case 'tableOfContents':
          html = `<nav class="page-toc" aria-label="목차" data-layout="list"><strong class="page-toc-title">목차</strong>${headings.filter(heading => (Number(heading.props?.level) || 1) <= (Number(block.props?.maxLevel) || 6)).map((heading) => `<a class="page-toc-item" style="padding-inline-start:${((Number(heading.props?.level) || 1) - 1) * 18 + 8}px" href="#block-${escapeHtml(heading.id)}">${inline(heading.content)}</a>`).join('')}</nav>`;
          commentable = false;
          break;
        case 'bulletListItem':
          html = `<p class="list-item"><span aria-hidden="true">•</span><span class="list-item-content">${content}</span></p>`;
          break;
        case 'numberedListItem':
          html = `<p class="list-item"><span aria-hidden="true">${listNumber}.</span><span class="list-item-content">${content}</span></p>`;
          break;
        case 'checkListItem':
          html = `<p class="list-item"><span aria-hidden="true">${block.props?.checked ? '☑' : '☐'}</span><span class="list-item-content">${content}</span></p>`;
          break;
        case 'quote':
          html = `<blockquote>${content}</blockquote>`;
          break;
        case 'callout':
          html = `<div class="callout-grid">${block.props?.icon === 'none' ? '' : `<span class="callout-marker">${calloutIconSvg(block.props?.icon)}</span>`}<div class="callout-content">${content || '&nbsp;'}</div></div>`;
          break;
        case 'codeBlock':
          html = `<pre data-document-code data-language="${escapeHtml(block.props?.language || 'text')}"><span class="shared-code-language">${escapeHtml(block.props?.language || 'text')}</span><code>${escapeHtml(flattenPlain(block.content))}</code></pre>`;
          break;
        case 'diagram':
          html = `<figure class="document-diagram"><div class="diagram-preview" aria-label="다이어그램"></div><details class="diagram-source-details"><summary>다이어그램 소스</summary><pre class="diagram-source"><code>${escapeHtml(flattenPlain(block.content))}</code></pre></details></figure>`;
          break;
        case 'divider':
          html = '<hr>';
          break;
        case 'table': {
          const rows = block.content?.rows || [];
          const widths = block.content?.columnWidths;
          const sized = Array.isArray(widths) && widths.length && widths.every(width => Number.isFinite(width) && width > 0);
          const total = sized ? widths.reduce((sum, width) => sum + width, 0) : 0;
          const columns = sized ? `<colgroup>${widths.map(width => `<col style="width:${(width / total * 100).toFixed(3)}%">`).join('')}</colgroup>` : '';
          html = `<div class="table-scroll" tabindex="0" aria-label="좌우로 스크롤할 수 있는 표"><table${sized ? ' style="width:100%;table-layout:fixed"' : ''}>${columns}${rows
            .map(
              (row, rowIndex) =>
                `<tr>${(row.cells || [])
                  .map((cell, columnIndex) =>
                    rowIndex < (block.content?.headerRows || 0) || columnIndex < (block.content?.headerCols || 0)
                      ? `<th scope="${rowIndex < (block.content?.headerRows || 0) ? 'col' : 'row'}">${inline(Array.isArray(cell) ? cell : cell.content)}</th>`
                      : `<td>${inline(Array.isArray(cell) ? cell : cell.content)}</td>`,
                  )
                  .join('')}</tr>`,
            )
            .join(
              '',
            )}</table></div><small class="table-hint">표를 좌우로 밀어 전체 내용을 확인하세요.</small>`;
          break;
        }
        case 'asset': {
          const asset = assets.get(block.props?.assetId);
          if (asset) {
            const href = escapeHtml(`/s/${token}/assets/${asset.id}`);
            const image = block.props.display === 'image' && IMAGE_MIME.test(asset.mime);
            const crop = image && assetCropStyles(block.props.crop);
            const style = value => Object.entries(value).map(([key, val]) => `${key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())}:${val}`).join(';');
            const preview = image ? `<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="원본 이미지 열기">${crop ? `<div style="${escapeHtml(style(crop.viewport))}"><img src="${href}" alt="${escapeHtml(asset.name)}" loading="lazy" style="${escapeHtml(style(crop.image))}"></div>` : `<img src="${href}" alt="${escapeHtml(asset.name)}" loading="lazy">`}</a>` : '';
            const label = [escapeHtml(asset.name), assetFileSize(asset.size), '원본 내려받기'].filter(Boolean).join(' · ');
            const caption = block.props.caption ? `<p>${escapeHtml(block.props.caption)}</p>` : '';
            if (image) {
              const tools = `<a href="${href}" target="_blank" rel="noopener noreferrer">원본 보기</a><a href="${href}" download="${escapeHtml(asset.name)}">내려받기</a>`;
              html = `<figure class="shared-image-attachment"><div class="shared-image-preview">${preview}<div class="shared-image-toolbar">${tools}</div><details class="shared-image-mobile-tools"><summary aria-label="이미지 메뉴"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></summary><div>${tools}</div></details></div>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
            } else html = `<figure><figcaption><a href="${href}" download="${escapeHtml(asset.name)}">${label}</a></figcaption></figure>`;
          }
          break;
        }
        case 'map': {
          const { latitude, longitude, label } = block.props || {};
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            const open = itineraryPlaceUrl({ latitude, longitude });
            const asset = assets.get(block.props.assetId);
            const image = asset && /^image\/(png|jpeg|webp|gif|avif)$/.test(asset.mime);
            const src = image
              ? `/s/${token}/assets/${asset.id}`
              : 'data:image/svg+xml;base64,' +
                Buffer.from(
                  itineraryPreviewSvg([
                    {
                      id: block.id,
                      date: '',
                      start: '',
                      title: label || '장소',
                      place: label || '장소',
                      latitude,
                      longitude,
                    },
                  ]),
                ).toString('base64');
            const preview = `<img src="${src}" alt="${escapeHtml(image ? asset.name : '장소 위치 미리보기')}" loading="lazy">`;
            html = `<div class="map-card"><strong>${escapeHtml(label || '장소 지도')}</strong>${preview}<a href="${escapeHtml(open)}" target="_blank" rel="noopener noreferrer">Google Maps에서 열기</a></div>`;
          }
          break;
        }
        case 'page':
          html = '<p class="private-link">연결된 페이지 · 공유 범위 밖</p>';
          break;
        case 'captureRef':
          html = '';
          break;
        default:
          html = content ? `<p>${content}</p>` : '';
      }
      const children =
        block.type === 'tableOfContents'
          ? ''
          : renderBlocks(block.children, token, assets, commentsEnabled, planTasks, headings);
      const metadata =
        commentsEnabled && commentable && html && block.id
          ? ` data-comment-block-id="${escapeHtml(block.id)}" data-comment-excerpt="${escapeHtml(publicExcerpt(block))}"`
          : '';
      const contents =
        block.type === 'toggleListItem'
          ? `<details class="page-reference-toggle"><summary>${html}</summary><div>${children}</div></details>`
          : block.type === 'callout'
            ? `<aside class="callout-box" data-background-color="${calloutColors.includes(block.props?.backgroundColor) ? block.props.backgroundColor : 'default'}" data-border="${block.props?.border !== false}" data-icon="${calloutIcons.includes(block.props?.icon) ? block.props.icon : 'lightbulb'}" data-text-color="${calloutColors.includes(block.props?.textColor) ? block.props.textColor : 'default'}" data-text-alignment="${['left','center','right','justify'].includes(block.props?.textAlignment) ? block.props.textAlignment : 'left'}">${html}${children ? `<div class="callout-children">${children}</div>` : ''}</aside>`
            : html + (children ? `<div class="block-children">${children}</div>` : '');
      return html || children
        ? `<section class="block" id="block-${escapeHtml(block.id)}" data-text-alignment="${['left', 'center', 'right', 'justify'].includes(block.props?.textAlignment) ? block.props.textAlignment : 'left'}"${metadata}>${contents}</section>`
        : '';
    })
    .join('');
}

export function renderSharedPage(
  page,
  token,
  assets = new Map(),
  { commentsEnabled = false, planTasks = [] } = {},
) {
  const title = escapeHtml(page.title);
  const headings = [];
  let hasDiagram = false;
  let hasCode = false;
  const collect = (blocks) => {
    for (const block of blocks || []) {
      if (['captureRef', 'page', 'tableOfContents'].includes(block.type)) continue;
      if (block.type === 'heading') headings.push(block);
      if (block.type === 'diagram') hasDiagram = true;
      if (block.type === 'codeBlock') hasCode = true;
      collect(block.children);
    }
  };
  collect(page.document.blocks);
  const diagramAssets = (hasDiagram || hasCode ? '<link rel="stylesheet" href="/share-assets/diagram.css"><script type="module" src="/share-viewer/entry.js"></script>' : '')
    + (hasCode ? '<script src="/share-assets/share-code.js" defer></script>' : '');
  const body = renderBlocks(
    page.document.blocks,
    token,
    assets,
    commentsEnabled,
    planTasks,
    headings,
  );
  const commentAssets = commentsEnabled
    ? '<link rel="stylesheet" href="/share-assets/share-comments.css"><script src="/share-assets/share-comments.js" defer></script>'
    : '';
  const commentEndpoint = commentsEnabled
    ? ` data-share-comments="/s/${escapeHtml(token)}/comments"`
    : '';
  const commentControl = commentsEnabled
    ? '<button class="share-comments-toggle" type="button" aria-expanded="false" aria-controls="share-comments-panel">댓글 <span data-comment-total>0</span></button>'
    : '';
  const planAssets = body.includes('data-static-itinerary')
    ? '<style>main{max-width:880px}.block>p,.block>h2,.block>h3,.block>blockquote{max-width:75ch}</style><link rel="stylesheet" href="/share-assets/share-plan.css"><script src="/share-assets/share-plan.js" defer></script>'
    : '';
  const updated = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(page.updatedAt));
  return `<!doctype html><html lang="ko" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(documentTitle(page.title))}</title><meta name="description" content="anotar에서 공유한 읽기 전용 문서입니다. 지정된 문서와 공개 첨부만 확인할 수 있어요."><meta property="og:type" content="article"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="anotar"><meta property="og:title" content="${escapeHtml(documentTitle(page.title))}"><meta property="og:description" content="anotar에서 공유한 읽기 전용 문서입니다."><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(documentTitle(page.title))}"><meta name="twitter:description" content="anotar에서 공유한 읽기 전용 문서입니다."><link rel="icon" type="image/png" href="/share-assets/favicon.png"><style>
  :root{color-scheme:light;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:#f7f7f2;color:#21352c}
  .saved-bookmark{display:flex;gap:14px;border:1px solid #dfe7dc;border-radius:8px;padding:14px;text-decoration:none;align-items:center;margin:12px 0}.saved-bookmark>span{display:flex;flex:1;min-width:0;flex-direction:column;gap:6px}.saved-bookmark strong{font-size:15px}.saved-bookmark span>span{font-size:13px;line-height:1.6;color:#60766a}.saved-bookmark small{font-size:12px;color:#60766a}.saved-bookmark img{width:100px;max-height:120px;object-fit:cover}@media(max-width:600px){.saved-bookmark img{width:72px}}
  *{box-sizing:border-box}body{margin:0}header{padding:17px max(22px,calc((100vw - 1050px)/2));border-bottom:1px solid #dfe7dc;background:#fff}header strong{font-size:20px;letter-spacing:-.03em}main{max-width:780px;margin:0 auto;padding:56px 24px 100px}h1{font-size:clamp(31px,5vw,46px);line-height:1.25;letter-spacing:-.03em;margin:0 0 18px}h2{font-size:26px;margin:36px 0 14px}h3{font-size:21px;margin:30px 0 12px}h4{font-size:18px;margin:28px 0 10px}p,li,blockquote{line-height:1.75}p{margin:9px 0}.meta{color:#60766a;font-size:13px;margin-bottom:42px}.block{overflow-wrap:anywhere}.list-item{display:flex;gap:10px}.list-item>span[aria-hidden]{color:#547660;flex-shrink:0}.list-item-content{min-width:0;flex:1}a{color:#315b41;text-underline-offset:3px}blockquote{border-left:2px solid #8da48e;margin:20px 0;padding:6px 18px;color:#526b5b}pre{padding:16px;overflow:auto;border-radius:8px;background:#e9eee7}hr{border:0;border-top:1px solid #d9e3d8;margin:30px 0}.table-scroll{overflow:auto;margin:18px 0}table{border-collapse:collapse;min-width:100%}td{border:1px solid #d9e3d8;padding:10px 12px;min-width:130px}figure{margin:22px 0}img{max-width:100%;height:auto;border-radius:8px}figcaption{color:#60766a;font-size:12px}.private-link{color:#788b7d;font-size:13px}footer{max-width:780px;margin:0 auto;padding:0 24px 40px;color:#6d8072;font-size:12px}
  .map-card{border:1px solid #d9e3d8;border-radius:12px;padding:15px;margin:18px 0}.map-card>strong{display:block;font-size:15px}.map-card>a{display:block;margin:5px 0 12px;font-size:12px}.map-card summary{cursor:pointer;color:#315b41;font-size:13px}.map-card img{display:block;max-height:360px;object-fit:contain;margin:12px 0}.map-card small{display:block;margin-top:8px;color:#60766a;font-size:11px}
  .itinerary-preparations{list-style:none;margin:8px 0 8px 54px;padding:0;font-size:12px}.itinerary-preparations>li{display:flex;gap:8px;align-items:baseline;padding:3px 0;line-height:1.6}.itinerary-preparation-status{font-size:10px;color:#60766a;white-space:nowrap}.itinerary-preparations>li>span:last-child{overflow-wrap:anywhere}@media(max-width:600px){.itinerary-preparations{margin-left:0}}@media(prefers-color-scheme:dark){.itinerary-preparation-status{color:#a8b7a8}}
  th{border:1px solid #d9e3d8;padding:10px 12px;min-width:130px;text-align:left}
  h1{text-wrap:balance}.table-hint{display:none;color:#60766a;font-size:11px}.table-scroll:focus-visible{outline:2px solid #315b41;outline-offset:2px}@media(max-width:600px){.table-scroll{margin-bottom:4px}table{min-width:570px}.table-hint{display:block;margin-bottom:20px}}
  </style>${planAssets}${commentAssets}<link rel="stylesheet" href="/share-assets/share-theme.css"><link rel="stylesheet" href="/share-assets/itinerary-timetable.css"><link rel="stylesheet" href="/share-assets/callout.css"><link rel="stylesheet" href="/share-assets/document-fonts.css"><link rel="stylesheet" href="/share-assets/document.css">${diagramAssets}<script src="/share-assets/share-theme.js"></script></head><body><header><div class="share-brand"><img src="/share-assets/favicon.png" alt="" width="24" height="24" style="border-radius:6px"><strong>anotar</strong><select class="share-theme-select" data-share-theme aria-label="화면 모드" hidden><option value="light">밝게</option><option value="dark">어둡게</option><option value="system">시스템</option></select><select class="share-theme-select" data-document-font-select aria-label="문서 글꼴" hidden><option value="default">기본 글꼴</option><option value="pretendard">Pretendard</option><option value="ridibatang">리디바탕</option></select><select class="share-theme-select" data-document-size-select aria-label="글자 크기" hidden><option value="compact" selected>작게</option><option value="standard">보통</option><option value="roomy">크게</option></select></div>${commentControl}</header><main class="shared-document"${commentEndpoint}>${page.icon ? `<div class="shared-document-icon" aria-hidden="true">${escapeHtml(page.icon)}</div>` : ''}<h1>${title}</h1><p class="meta">읽기 전용 공유 · 마지막 수정 ${escapeHtml(updated)}</p>${body}</main><footer>이 링크는 이 페이지만 보여줍니다. 연결된 비공개 문서는 열리지 않습니다.</footer></body></html>`;
}
