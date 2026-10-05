(() => {
  'use strict';
  const main = document.querySelector('main[data-share-comments]');
  if (!main) return;
  const endpoint = main.dataset.shareComments;
  const toggle = document.querySelector('.share-comments-toggle');
  const blocks = new Map(
    [...main.querySelectorAll('[data-comment-block-id]')].map((el) => [
      el.dataset.commentBlockId,
      el,
    ]),
  );
  const prefix = 'leneu:shared-comment:' + endpoint + ':';
  const rememberedNameKey = 'leneu:shared-comment-name:v1';
  const storage = {
    get(key, persistent = false) {
      try {
        return (persistent ? localStorage : sessionStorage).getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value, persistent = false) {
      try {
        (persistent ? localStorage : sessionStorage).setItem(key, value);
      } catch {
        /* Input remains in memory if browser storage is unavailable. */
      }
    },
    remove(key) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* No-op. */
      }
    },
  };
  const paths = {
    comment:
      'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z',
    close: 'M18 6 6 18M6 6l12 12',
    back: 'm15 18-6-6 6-6',
    up: 'm6 15 6-6 6 6',
    down: 'm6 9 6 6 6-6',
    locate: 'M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6',
    send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
    check: 'm20 6-11 11-5-5',
    refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 7M4 17l2.3 2a7 7 0 0 0 11.6-2',
  };
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function icon(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, val] of Object.entries({
      viewBox: '0 0 24 24',
      width: '18',
      height: '18',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }))
      svg.setAttribute(key, val);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[type]);
    svg.append(path);
    return svg;
  }
  function button(label, type, onClick, className = '') {
    const el = node('button', 'share-comments-button ' + className);
    el.type = 'button';
    if (type) el.append(icon(type));
    if (label) el.append(node('span', '', label));
    el.addEventListener('click', onClick);
    return el;
  }
  function iconButton(label, type, action) {
    const el = button('', type, action, 'share-comments-icon-button');
    el.setAttribute('aria-label', label);
    return el;
  }
  let threads = [],
    selectedId = null,
    selectedBlock = null,
    filter = 'open',
    opened = false,
    expanded = false,
    loading = false,
    sending = false,
    error = '',
    generation = 0,
    loadController;
  let returnFocus = toggle,
    draft = '',
    pending = null;
  const draftCache = new Map();
  const panel = node('aside', 'share-comments-panel');
  panel.id = 'share-comments-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '공유 댓글');
  const head = node('div', 'share-comments-head');
  const back = iconButton('댓글 목록', 'back', () => select(null, null));
  const title = node('strong', 'share-comments-title', '댓글');
  const size = iconButton('댓글 패널 펼치기', 'up', () => {
    expanded = !expanded;
    resizePanel();
  });
  size.classList.add('share-comments-size');
  const close = iconButton('댓글 닫기', 'close', closePanel);
  const refresh = iconButton('댓글 새로고침', 'refresh', () => {
    if (!loading && !sending && !pending) load();
  });
  refresh.title = '댓글 새로고침';
  head.append(back, icon('comment'), title, refresh, size, close);
  const tabs = node('div', 'share-comments-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', '댓글 상태');
  const openTab = button('진행 중', null, () => {
    filter = 'open';
    select(null, null);
  });
  const resolvedTab = button('해결됨', null, () => {
    filter = 'resolved';
    select(null, null);
  });
  tabs.append(openTab, resolvedTab);
  const quote = node('div', 'share-comments-quote');
  const quoteText = node('p');
  const locate = iconButton('본문 위치', 'locate', locateBlock);
  quote.append(quoteText, locate);
  const status = node('div', 'share-comments-status');
  status.setAttribute('role', 'status');
  const body = node('div', 'share-comments-body');
  const form = node('form', 'share-comments-composer');
  const nameLabel = node('label', 'share-comments-name-label', '이름');
  const name = node('input', 'share-comments-name');
  name.type = 'text';
  name.maxLength = 30;
  name.required = true;
  name.autocomplete = 'nickname';
  name.placeholder = '댓글에 표시할 이름';
  name.setAttribute('aria-label', '이름');
  name.value = storage.get(rememberedNameKey, true) || '';
  nameLabel.append(name);
  const text = node('textarea', 'share-comments-input');
  text.rows = 3;
  text.maxLength = 2000;
  text.required = true;
  text.setAttribute('aria-label', '댓글 입력');
  text.placeholder = '이 블록에 의견을 남겨보세요.';
  const controls = node('div', 'share-comments-compose-controls');
  const hint = node('small', '', '이름만으로 참여할 수 있어요');
  const editPending = button('내용 수정', null, () => {
    pending = null;
    saveDraft();
    render();
    text.focus();
  });
  const submit = button('댓글 남기기', 'send', () => {}, 'share-comments-submit');
  submit.type = 'submit';
  controls.append(hint, editPending, submit);
  form.append(nameLabel, text, controls);
  panel.append(head, tabs, quote, status, body, form);
  document.body.append(panel);
  toggle.prepend(icon('comment'));
  toggle.setAttribute('aria-label', '댓글 열기');
  toggle.addEventListener('click', () => (opened ? closePanel() : openPanel()));
  text.addEventListener('input', () => {
    draft = text.value;
    saveDraft();
    updateSubmit();
  });
  name.addEventListener('input', () => {
    storage.set(rememberedNameKey, name.value, true);
    updateSubmit();
  });
  name.addEventListener('focus', expandForInput);
  text.addEventListener('focus', expandForInput);
  text.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', submitComment);
  document.addEventListener('keydown', (event) => {
    if (opened && event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      closePanel();
    }
  });
  window.addEventListener('pagehide', saveDraft);
  window.addEventListener('resize', resizePanel);
  window.visualViewport?.addEventListener('resize', resizePanel);
  window.visualViewport?.addEventListener('scroll', resizePanel);
  function targetKey() {
    return selectedId ? 'thread:' + selectedId : selectedBlock ? 'block:' + selectedBlock : null;
  }
  function saveDraft() {
    const key = targetKey();
    if (!key) return;
    const value = { text: text.value, pending };
    draftCache.set(key, value);
    storage.set(prefix + key, JSON.stringify(value));
  }
  function readDraft(key) {
    let value = key && draftCache.get(key);
    if (!value && key) {
      try {
        value = JSON.parse(storage.get(prefix + key) || 'null');
      } catch {
        /* Ignore a malformed browser draft. */
      }
    }
    return value;
  }
  function restoreDraft() {
    const key = targetKey();
    let value = readDraft(key);
    // A visitor may start this conversation while our first comment is still a draft.
    // Move the draft into the conversation without changing any pending request snapshot.
    if (!value && selectedId && selectedBlock) {
      const blockKey = 'block:' + selectedBlock;
      value = readDraft(blockKey);
      if (value) {
        draftCache.set(key, value);
        storage.set(prefix + key, JSON.stringify(value));
        draftCache.delete(blockKey);
        storage.remove(prefix + blockKey);
      }
    }
    draft = typeof value?.text === 'string' ? value.text.slice(0, 2000) : '';
    pending = value?.pending && typeof value.pending.requestId === 'string' ? value.pending : null;
    text.value = draft;
  }
  function threadForSelection() {
    return threads.find((thread) => thread.id === selectedId);
  }
  function select(threadId, blockId, trigger) {
    if (sending) return;
    saveDraft();
    selectedId = threadId;
    selectedBlock = blockId || threads.find((t) => t.id === threadId)?.blockId || null;
    error = '';
    if (trigger) returnFocus = trigger;
    restoreDraft();
    render();
  }
  function openPanel(threadId = null, blockId = null, trigger = toggle) {
    if (sending && (threadId !== selectedId || blockId !== selectedBlock)) return;
    opened = true;
    panel.hidden = false;
    document.body.classList.add('share-comments-open');
    toggle.setAttribute('aria-expanded', 'true');
    select(threadId, blockId, trigger);
    resizePanel();
    close.focus({ preventScroll: true });
  }
  function closePanel() {
    saveDraft();
    opened = false;
    panel.hidden = true;
    document.body.classList.remove('share-comments-open');
    toggle.setAttribute('aria-expanded', 'false');
    blocks.forEach((el) => el.classList.remove('share-comments-selected'));
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function expandForInput() {
    if (matchMedia('(max-width: 1239px)').matches) {
      expanded = true;
      resizePanel();
    }
  }
  function resizePanel() {
    panel.classList.toggle('share-comments-expanded', expanded);
    size.replaceChildren(icon(expanded ? 'down' : 'up'));
    size.setAttribute('aria-label', expanded ? '댓글 패널 줄이기' : '댓글 패널 펼치기');
    const viewport = window.visualViewport;
    panel.style.setProperty(
      '--share-comments-viewport-height',
      (viewport?.height || innerHeight) + 'px',
    );
    panel.style.setProperty(
      '--share-comments-keyboard-bottom',
      Math.max(0, innerHeight - (viewport?.height || innerHeight) - (viewport?.offsetTop || 0)) +
        'px',
    );
    panel.classList.toggle(
      'share-comments-keyboard',
      !!viewport && innerHeight - viewport.height > 150,
    );
  }
  function locateBlock() {
    const el = blocks.get(selectedBlock);
    if (!el) return;
    document.activeElement?.blur();
    expanded = false;
    resizePanel();
    el.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  function timeLabel(timestamp) {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }
  function updateSubmit() {
    submit.disabled = sending || !name.value.trim() || !text.value.trim();
  }
  function render() {
    refresh.disabled = loading || sending || !!pending;
    title.textContent = '댓글 ' + threads.reduce((n, t) => n + t.comments.length, 0);
    back.hidden = !selectedBlock && !selectedId;
    tabs.hidden = !!selectedBlock || !!selectedId;
    openTab.setAttribute('aria-pressed', String(filter === 'open'));
    resolvedTab.setAttribute('aria-pressed', String(filter === 'resolved'));
    openTab.querySelector('span').textContent =
      '진행 중 ' + threads.filter((t) => !t.resolved).length;
    resolvedTab.querySelector('span').textContent =
      '해결됨 ' + threads.filter((t) => t.resolved).length;
    const thread = threadForSelection();
    quote.hidden = !selectedBlock && !selectedId;
    quoteText.textContent =
      thread?.excerpt || blocks.get(selectedBlock)?.dataset.commentExcerpt || '';
    locate.disabled = !blocks.has(selectedBlock);
    body.replaceChildren();
    status.replaceChildren();
    if (error) {
      status.append(
        node('span', '', error),
        button('다시 불러오기', null, () => load()),
      );
    } else if (loading) status.append(node('span', '', '댓글을 불러오는 중…'));
    status.hidden = !error && !loading;
    if (thread) {
      const state = node(
        'div',
        'share-comments-thread-state',
        thread.resolved ? '해결된 대화' : '대화 중',
      );
      if (thread.resolved) state.prepend(icon('check'));
      body.append(state);
      for (const comment of thread.comments) {
        const item = node('article', 'share-comments-message');
        const avatar = node('span', 'share-comments-avatar', [...(comment.name || '방문자')][0]);
        avatar.setAttribute('aria-hidden', 'true');
        if (comment.isOwner) avatar.classList.add('share-comments-owner-avatar');
        const message = node('div', 'share-comments-message-content');
        const byline = node('div', 'share-comments-byline');
        byline.append(node('strong', '', comment.name || '방문자'));
        if (comment.isOwner) byline.append(node('span', 'share-comments-owner-label', '작성자'));
        const time = node('time', '', timeLabel(comment.createdAt));
        time.dateTime = new Date(comment.createdAt).toISOString();
        byline.append(time);
        message.append(byline, node('p', '', comment.text));
        item.append(avatar, message);
        body.append(item);
      }
      if (thread.orphaned)
        body.append(
          node('p', 'share-comments-note', '원본 블록이 삭제되었어요. 대화는 그대로 보관됩니다.'),
        );
    } else if (selectedBlock) {
      body.append(
        node('p', 'share-comments-empty', '함께 확인할 내용이나 궁금한 점을 남겨보세요.'),
      );
    } else {
      const listed = threads.filter((t) => t.resolved === (filter === 'resolved'));
      for (const item of listed) {
        const entry = button(
          '',
          null,
          (event) => select(item.id, item.blockId, event.currentTarget),
          'share-comments-thread-row',
        );
        const first = item.comments[0],
          last = item.comments.at(-1);
        entry.append(
          node('strong', 'share-comments-thread-excerpt', item.excerpt),
          node('span', 'share-comments-thread-preview', last?.text || ''),
          node(
            'small',
            '',
            `${last?.name || first?.name || '방문자'} · ${item.comments.length}개 · ${last ? timeLabel(last.createdAt) : ''}`,
          ),
        );
        body.append(entry);
      }
      if (!listed.length)
        body.append(
          node(
            'p',
            'share-comments-empty',
            filter === 'resolved'
              ? '해결된 대화가 없어요.'
              : '본문 옆 말풍선을 눌러 첫 댓글을 남겨보세요.',
          ),
        );
    }
    form.hidden = (!selectedBlock && !selectedId) || !!thread?.resolved;
    text.setAttribute('aria-label', thread ? '답글 입력' : '댓글 입력');
    text.placeholder = thread ? '이 대화에 답글을 남겨보세요.' : '이 블록에 의견을 남겨보세요.';
    submit.querySelector('span').textContent = sending
      ? '등록 중…'
      : pending
        ? '다시 등록'
        : thread
          ? '답글 등록'
          : '댓글 남기기';
    editPending.hidden = !pending || sending;
    hint.hidden = !!pending;
    name.disabled = sending || !!pending;
    text.disabled = sending || !!pending;
    updateSubmit();
    updateBubbles();
  }
  function updateBubbles() {
    const total = threads.reduce((n, t) => n + t.comments.length, 0);
    toggle.querySelector('[data-comment-total]').textContent = total;
    for (const [id, el] of blocks) {
      const thread = threads.find((t) => t.blockId === id),
        bubble = el.querySelector(':scope > .share-comments-bubble');
      el.classList.toggle('share-comments-selected', opened && selectedBlock === id);
      bubble.classList.toggle('share-comments-has-thread', !!thread);
      bubble.classList.toggle('share-comments-resolved', !!thread?.resolved);
      bubble.replaceChildren(icon(thread?.resolved ? 'check' : 'comment'));
      if (thread) bubble.append(node('span', '', String(thread.comments.length)));
      bubble.setAttribute(
        'aria-label',
        thread
          ? `${thread.resolved ? '해결된 ' : ''}댓글 ${thread.comments.length}개가 있는 블록 보기`
          : '블록에 댓글 달기',
      );
    }
  }
  for (const [id, el] of blocks) {
    el.classList.add('share-comments-block');
    const bubble = button(
      '',
      'comment',
      (event) => {
        event.stopPropagation();
        const thread = threads.find((t) => t.blockId === id);
        openPanel(thread?.id || null, id, event.currentTarget);
      },
      'share-comments-bubble',
    );
    bubble.setAttribute('aria-label', '블록에 댓글 달기');
    el.append(bubble);
  }
  async function load() {
    const version = ++generation;
    loadController?.abort();
    loadController = new AbortController();
    loading = true;
    error = '';
    render();
    try {
      const response = await fetch(endpoint, {
        signal: loadController.signal,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const value = await response.json();
      if (!response.ok || !Array.isArray(value.items)) throw new Error('load');
      if (version !== generation) return;
      threads = value.items;
      if (selectedId && !threadForSelection()) select(null, selectedBlock);
      if (!selectedId && selectedBlock) {
        const threadId = threads.find((t) => t.blockId === selectedBlock)?.id;
        if (threadId) {
          // Conflict recovery also loads while a submission is still in flight.
          saveDraft();
          selectedId = threadId;
          restoreDraft();
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError' && version === generation)
        error = '댓글을 불러오지 못했어요. 다시 확인해 주세요.';
    } finally {
      if (version === generation) {
        loading = false;
        render();
      }
    }
  }
  async function submitComment(event) {
    event.preventDefault();
    if (sending || !name.value.trim() || !text.value.trim() || !targetKey()) return;
    const thread = threadForSelection();
    if (!pending)
      pending = {
        requestId: crypto.randomUUID(),
        action: thread ? 'reply' : 'create',
        ...(thread
          ? { threadId: thread.id, expectedVersion: thread.version }
          : { blockId: selectedBlock }),
        name: name.value.trim(),
        text: text.value.trim(),
      };
    saveDraft();
    sending = true;
    error = '';
    render();
    const oldKey = targetKey(),
      snapshot = pending,
      previousId = selectedId;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(snapshot),
      });
      const value = await response.json();
      if (!response.ok || !Array.isArray(value.items)) {
        if (response.status === 409) {
          pending = null;
          saveDraft();
          await load();
          throw new Error('이 대화가 변경됐어요. 최신 댓글을 확인하고 다시 등록해 주세요.');
        }
        throw new Error(
          response.status === 404
            ? '이 공유 링크에서 댓글을 남길 수 없어요.'
            : response.status === 429
              ? '잠시 뒤에 다시 등록해 주세요.'
              : '댓글을 등록하지 못했어요. 작성한 내용은 남아 있어요.',
        );
      }
      ++generation;
      loadController?.abort();
      loading = false;
      threads = value.items;
      draftCache.delete(oldKey);
      storage.remove(prefix + oldKey);
      pending = null;
      draft = '';
      text.value = '';
      const updated = threads.find((t) => t.id === previousId || t.blockId === selectedBlock);
      selectedId = updated?.id || null;
      render();
      requestAnimationFrame(() => {
        body.scrollTop = body.scrollHeight;
      });
    } catch (e) {
      error =
        e.message === 'Failed to fetch' || e instanceof SyntaxError
          ? '댓글을 등록하지 못했어요. 작성한 내용은 남아 있어요.'
          : e.message;
      saveDraft();
    } finally {
      sending = false;
      render();
    }
  }
  render();
  load();
})();
