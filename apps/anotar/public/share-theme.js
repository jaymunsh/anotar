(() => {
  'use strict';
  const root = document.documentElement;
  const key = 'leneu:share-theme:v1';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let choice = 'light';
  try {
    const saved = localStorage.getItem(key);
    if (['light', 'dark', 'system'].includes(saved)) choice = saved;
  } catch {
    // The selector still works when browser storage is unavailable.
  }
  function apply() {
    root.dataset.theme = choice === 'system' ? (system.matches ? 'dark' : 'light') : choice;
  }
  let font = 'default';
  try { const saved = localStorage.getItem('leneu:document-font'); if (['pretendard','ridibatang'].includes(saved)) font = saved; } catch {}
  root.dataset.documentFont = font;
  let size = 'compact';
  try {
    const saved = localStorage.getItem('leneu:share-document-size:v1');
    if (['compact', 'standard', 'roomy'].includes(saved)) size = saved;
  } catch {}
  root.dataset.documentSize = size;
  apply();
  system.addEventListener('change', () => {
    if (choice === 'system') apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const sizeSelect = document.querySelector('[data-document-size-select]');
    if (sizeSelect) {
      sizeSelect.value = size; sizeSelect.hidden = false;
      sizeSelect.addEventListener('change', () => {
        size = sizeSelect.value; root.dataset.documentSize = size;
        try { localStorage.setItem('leneu:share-document-size:v1', size); } catch {}
      });
    }
    const fontSelect = document.querySelector('[data-document-font-select]');
    if (fontSelect) {
      fontSelect.value = font; fontSelect.hidden = false;
      fontSelect.addEventListener('change', () => {
        font = fontSelect.value; root.dataset.documentFont = font;
        try { localStorage.setItem('leneu:document-font', font); } catch {}
      });
    }
    const select = document.querySelector('[data-share-theme]');
    if (!select) return;
    select.value = choice;
    select.hidden = false;
    select.addEventListener('change', () => {
      choice = select.value;
      apply();
      try {
        localStorage.setItem(key, choice);
      } catch {
        // The current page retains its selected mode.
      }
    });
  });
})();
