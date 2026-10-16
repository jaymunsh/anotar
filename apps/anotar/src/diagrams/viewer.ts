let closeCurrent: (() => void) | undefined;

/** Native dialog supplies modal focus containment and Escape handling. */
export function openDiagramViewer(svg: string, trigger?: HTMLElement): () => void {
  closeCurrent?.();
  const previous =
    trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-dialog';
  dialog.setAttribute('aria-label', '다이어그램 확대 보기');
  const toolbar = document.createElement('div');
  toolbar.className = 'diagram-toolbar';
  const title = document.createElement('strong');
  title.textContent = '다이어그램';
  toolbar.append(title);
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite');
  const viewport = document.createElement('div');
  viewport.className = 'diagram-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute(
    'aria-label',
    '다이어그램. 방향키 또는 드래그로 이동, 더하기와 빼기로 확대 또는 축소합니다.',
  );
  const canvas = document.createElement('div');
  canvas.className = 'diagram-canvas';
  canvas.innerHTML = svg;
  viewport.append(canvas);
  let scale = 1,
    x = 0,
    y = 0;
  const update = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    status.textContent = `${Math.round(scale * 100)}%`;
  };
  const zoom = (factor: number) => {
    scale = Math.min(6, Math.max(0.2, scale * factor));
    update();
  };
  const fit = () => {
    scale = 1;
    x = y = 0;
    update();
  };
  const button = (label: string, action: () => void) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.addEventListener('click', action);
    toolbar.append(control);
    return control;
  };
  button('−', () => zoom(1 / 1.25)).setAttribute('aria-label', '축소');
  toolbar.append(status);
  button('+', () => zoom(1.25)).setAttribute('aria-label', '확대');
  button('화면에 맞추기', fit);
  const close = () => {
    if (dialog.open) dialog.close();
  };
  const closeButton = button('닫기', close);
  const hint = document.createElement('p');
  hint.className = 'diagram-viewer-hint';
  hint.textContent = '드래그 또는 방향키로 이동 · + / − 확대·축소 · Esc 닫기';
  dialog.append(toolbar, viewport, hint);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      if (closeCurrent === close) closeCurrent = undefined;
      if (previous?.isConnected) previous.focus();
    },
    { once: true },
  );
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  viewport.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') zoom(1.25);
    else if (event.key === '-') zoom(1 / 1.25);
    else if (event.key === '0' || event.key === 'Home') fit();
    else if (event.key.startsWith('Arrow')) {
      x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
      y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0;
      update();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });
  let pointer: { id: number; x: number; y: number } | undefined;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.focus();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    x += event.clientX - pointer.x;
    y += event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    update();
  });
  viewport.addEventListener('pointerup', () => {
    pointer = undefined;
  });
  viewport.addEventListener('pointercancel', () => {
    pointer = undefined;
  });
  document.body.append(dialog);
  closeCurrent = close;
  dialog.showModal();
  fit();
  closeButton.focus();
  return close;
}
