/** Contextual control shared by the editor, public reader and offline HTML. */
export function createCodeCopyButton(readSource: () => string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'document-code-copy';
  button.contentEditable = 'false';
  button.setAttribute('aria-label', '코드 복사');
  button.title = '코드 복사';
  // Lucide Copy geometry, fixed markup independent of document content.
  button.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const label = document.createElement('span');
  label.setAttribute('aria-live', 'polite');
  label.textContent = '복사';
  button.append(label);
  let disposed = false;
  let reset: ReturnType<typeof setTimeout> | undefined;
  const preserveSelection = (event: MouseEvent) => event.preventDefault();
  // Enter/Space activate this control instead of editor block commands.
  const preserveKeyboard = (event: KeyboardEvent) => event.stopPropagation();
  const copy = async (event: MouseEvent) => {
    event.stopPropagation();
    if (reset) clearTimeout(reset);
    button.disabled = true;
    button.dataset.state = 'copying';
    label.textContent = '복사 중';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(readSource());
      if (disposed) return;
      button.dataset.state = 'copied';
      button.title = '코드를 복사했어요';
      label.textContent = '복사됨';
    } catch {
      if (disposed) return;
      button.dataset.state = 'error';
      button.title = '복사하지 못했어요. 코드를 직접 선택해 복사해 주세요.';
      label.textContent = '복사 실패';
    } finally {
      if (!disposed) {
        button.disabled = false;
        reset = setTimeout(() => {
          delete button.dataset.state;
          button.title = '코드 복사';
          label.textContent = '복사';
        }, 2500);
      }
    }
  };
  button.addEventListener('mousedown', preserveSelection);
  button.addEventListener('keydown', preserveKeyboard);
  button.addEventListener('click', copy);
  return {
    dom: button,
    destroy() {
      disposed = true;
      if (reset) clearTimeout(reset);
      button.removeEventListener('mousedown', preserveSelection);
      button.removeEventListener('keydown', preserveKeyboard);
      button.removeEventListener('click', copy);
    },
  };
}
