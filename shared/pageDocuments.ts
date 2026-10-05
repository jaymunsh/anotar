type Block = { id: string; type: string; children: Block[]; [key: string]: unknown };

// Hide the reference itself, keeping editable descendants in their existing order.
export function editablePageBlocks<T>(blocks: T[]): T[] {
  return structuredClone(blocks as Block[]).flatMap((block) => {
    const children = editablePageBlocks(block.children || []);
    return block.type === 'captureRef' ? children : [{ ...block, children }];
  }) as T[];
}

// Reinsert raw legacy references only when a user saves an actual edit.
// Their IDs/properties and unedited descendants remain in the stored document.
export function preserveLegacyCaptureRefs<T>(original: T[], edited: T[]): T[] {
  const old = original as Block[];
  let result = (edited as Block[]).map((block) => {
    const previous = old.find((item) => item.id === block.id);
    return {
      ...block,
      children: preserveLegacyCaptureRefs(previous?.children || [], block.children || []),
    };
  });
  old.forEach((block, index) => {
    if (block.type !== 'captureRef') return;
    const childIds = new Set(editablePageBlocks(block.children || []).map((child) => child.id));
    const children = result.filter((child) => childIds.has(child.id));
    result = result.filter((child) => !childIds.has(child.id));
    const restored = {
      ...block,
      children: preserveLegacyCaptureRefs(block.children || [], children),
    };
    const nextId = old
      .slice(index + 1)
      .find((item) => result.some((current) => current.id === item.id))?.id;
    const previousId = old
      .slice(0, index)
      .reverse()
      .find((item) => result.some((current) => current.id === item.id))?.id;
    const at = nextId
      ? result.findIndex((item) => item.id === nextId)
      : previousId
        ? result.findIndex((item) => item.id === previousId) + 1
        : result.length;
    result.splice(at, 0, restored);
  });
  return result as T[];
}
