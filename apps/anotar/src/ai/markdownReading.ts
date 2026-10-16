import { createElement as h, Fragment, type ReactNode } from 'react';
import { Lexer, type Token, type MarkedToken } from 'marked';

function text(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match;
      const point =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
    },
  );
}
function safeHref(value: string) {
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function nodes(tokens: Token[]): ReactNode[] {
  return tokens.map((generic, key) => {
    const token = generic as MarkedToken;
    switch (token.type) {
      case 'space':
      case 'def':
        return null;
      case 'heading':
        return h(`h${token.depth}`, { key }, nodes(token.tokens));
      case 'paragraph':
        return h('p', { key }, nodes(token.tokens));
      case 'blockquote':
        return h('blockquote', { key }, nodes(token.tokens));
      case 'strong':
        return h('strong', { key }, nodes(token.tokens));
      case 'em':
        return h('em', { key }, nodes(token.tokens));
      case 'del':
        return h('del', { key }, nodes(token.tokens));
      case 'br':
        return h('br', { key });
      case 'hr':
        return h('hr', { key });
      case 'code':
        return h('pre', { key }, h('code', null, token.text));
      case 'codespan':
        return h('code', { key }, text(token.text));
      case 'link': {
        const href = safeHref(token.href);
        return href
          ? h(
              'a',
              {
                key,
                href,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: token.title ?? undefined,
              },
              nodes(token.tokens),
            )
          : h(Fragment, { key }, nodes(token.tokens));
      }
      // Never execute provider HTML or fetch remote image URLs while reading a result.
      case 'html':
        return h(Fragment, { key }, token.text);
      case 'image':
        return h('span', { key, className: 'ai-result-image-label' }, text(token.text || '이미지'));
      case 'list':
        return h(
          token.ordered ? 'ol' : 'ul',
          { key, ...(token.ordered && token.start !== '' ? { start: token.start } : {}) },
          token.items.map((item, index) =>
            h(
              'li',
              { key: index, className: item.task ? 'ai-result-check-item' : undefined },
              item.task
                ? h('input', {
                    type: 'checkbox',
                    checked: !!item.checked,
                    disabled: true,
                    readOnly: true,
                    'aria-label': item.checked ? '완료됨' : '미완료',
                  })
                : null,
              nodes(item.tokens),
            ),
          ),
        );
      case 'table':
        return h(
          'div',
          { key, className: 'ai-result-table' },
          h(
            'table',
            null,
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                token.header.map((cell, index) =>
                  h(
                    'th',
                    { key: index, style: { textAlign: cell.align ?? undefined } },
                    nodes(cell.tokens),
                  ),
                ),
              ),
            ),
            h(
              'tbody',
              null,
              token.rows.map((row, index) =>
                h(
                  'tr',
                  { key: index },
                  row.map((cell, column) =>
                    h(
                      'td',
                      { key: column, style: { textAlign: cell.align ?? undefined } },
                      nodes(cell.tokens),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      case 'text':
        return h(Fragment, { key }, token.tokens ? nodes(token.tokens) : text(token.text));
      case 'escape':
        return h(Fragment, { key }, text(token.text));
      default:
        return h(Fragment, { key }, generic.raw);
    }
  });
}
export function renderReadMarkdown(markdown: string) {
  return nodes(new Lexer({ gfm: true }).lex(markdown));
}
