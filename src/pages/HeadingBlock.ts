import { createHeadingBlockSpec } from '@blocknote/core';

export function createDocumentHeadingBlockSpec() {
  const spec = createHeadingBlockSpec({ levels: [1, 2, 3, 4] });
  const parse = spec.implementation.parse;
  spec.implementation.parse = function (element) {
    const props = parse?.call(this, element);
    // Imports of deeper Markdown/HTML headings retain their text at level 4.
    return props ? { ...props, level: Math.min(4, props.level ?? 1) } : props;
  };
  return spec;
}
