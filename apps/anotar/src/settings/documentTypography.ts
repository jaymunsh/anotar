import {
  normalizeDocumentTypography, documentTypographyVariables,
  type DocumentTypography,
} from '../../shared/documentTypography';

const storageKey = 'leneu:document-typography:v1';
export const typographyChangeEvent = 'leneu:document-typography-change';
function readSavedTypography(): DocumentTypography {
  try { return normalizeDocumentTypography(JSON.parse(localStorage.getItem(storageKey) || 'null')); }
  catch { return normalizeDocumentTypography(null); }
}
let current = readSavedTypography();
export function currentDocumentTypography(): DocumentTypography { return {...current}; }
export function applyDocumentTypography(value: DocumentTypography, persist = true): DocumentTypography {
  current = normalizeDocumentTypography(value);
  for (const [name, value] of Object.entries(documentTypographyVariables(current)))
    document.documentElement.style.setProperty(name, value);
  if (persist) {
    try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Current session still applies. */ }
  }
  window.dispatchEvent(new Event(typographyChangeEvent));
  return {...current};
}
applyDocumentTypography(current, false);
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) applyDocumentTypography(readSavedTypography(), false);
});
