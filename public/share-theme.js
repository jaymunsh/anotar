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
  apply();
  system.addEventListener('change', () => {
    if (choice === 'system') apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
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
