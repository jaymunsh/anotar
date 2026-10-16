import { AiValidationError } from './ai/contracts.mjs';
import { renderPageMarkdown } from '../shared/pageMarkdown.ts';

const privateTypes = new Set(['captureRef', 'asset', 'page', 'tableOfContents']);
export function pageAiSource(page, blockIds = []) {
  if (
    !Array.isArray(blockIds) ||
    blockIds.length > 1000 ||
    new Set(blockIds).size !== blockIds.length ||
    blockIds.some((id) => typeof id !== 'string' || !id || id.length > 100)
  )
    throw new AiValidationError('선택한 블록 정보가 올바르지 않아요.');
  const byId = new Map();
  const visit = (blocks) => {
    for (const block of blocks) {
      byId.set(block.id, block);
      visit(block.children);
    }
  };
  visit(page.document.blocks);
  if (blockIds.some((id) => !byId.has(id) || privateTypes.has(byId.get(id).type)))
    throw new AiValidationError('저장된 글·표·코드 블록을 선택해 주세요.');
  const selected = new Set(blockIds);
  const roots = [];
  function collect(blocks) {
    for (const block of blocks) {
      if (selected.has(block.id)) roots.push(block);
      else collect(block.children);
    }
  }
  if (selected.size) collect(page.document.blocks);
  const content =
    (selected.size ? '' : '# ' + page.title + '\n\n') +
    renderPageMarkdown(selected.size ? roots : page.document.blocks);
  if (content.length > 64000)
    throw new AiValidationError(
      '페이지 입력은 64,000자까지 요청할 수 있어요. 선택한 블록으로 범위를 줄여 주세요.',
    );
  if (!content.trim() || (!selected.size && !renderPageMarkdown(page.document.blocks).trim()))
    throw new AiValidationError('AI에 전달할 저장된 본문을 작성해 주세요.');
  return { content: content.trim(), targetBlockIds: [...blockIds] };
}
