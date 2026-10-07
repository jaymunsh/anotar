export type DocumentTypography = {
  bodySize: number;
  titleRatio: number;
  h1Ratio: number;
  h2Ratio: number;
  h3Ratio: number;
  h4Ratio: number;
  lineHeight: number;
  spacing: number;
};
export const defaultDocumentTypography: DocumentTypography = Object.freeze({
  bodySize:14,titleRatio:2,h1Ratio:1.5,h2Ratio:1.28,h3Ratio:1.12,h4Ratio:1.08,lineHeight:1.55,spacing:.85,
});
const standardDocumentTypography: DocumentTypography = Object.freeze({
  bodySize: 15, titleRatio: 32 / 15, h1Ratio: 1.6, h2Ratio: 20 / 15,
  h3Ratio: 17 / 15, h4Ratio: 16 / 15, lineHeight: 1.65, spacing: 1,
});
export const documentTypographyPresets = {
  compact: defaultDocumentTypography,
  standard: standardDocumentTypography,
  roomy: {bodySize:16,titleRatio:2.125,h1Ratio:1.625,h2Ratio:1.375,h3Ratio:1.1875,h4Ratio:1.125,lineHeight:1.75,spacing:1.1},
} satisfies Record<string, DocumentTypography>;
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
export function normalizeDocumentTypography(value: unknown): DocumentTypography {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<DocumentTypography> : {};
  const defaults = defaultDocumentTypography;
  const titleRatio = bounded(input.titleRatio, defaults.titleRatio, 1.5, 2.5);
  const h1Ratio = Math.min(titleRatio, bounded(input.h1Ratio, defaults.h1Ratio, 1.2, 1.9));
  const h2Ratio = Math.min(h1Ratio, bounded(input.h2Ratio, defaults.h2Ratio, 1.1, 1.6));
  const h3Ratio = Math.min(h2Ratio, bounded(input.h3Ratio, defaults.h3Ratio, 1.08, 1.35));
  const h4Ratio = Math.min(h3Ratio, bounded(input.h4Ratio, defaults.h4Ratio, 1.04, 1.25));
  return {
    bodySize: bounded(input.bodySize, defaults.bodySize, 13, 18),
    titleRatio, h1Ratio, h2Ratio, h3Ratio, h4Ratio,
    lineHeight: bounded(input.lineHeight, defaults.lineHeight, 1.4, 1.9),
    spacing: bounded(input.spacing, defaults.spacing, .75, 1.25),
  };
}
export function documentTypographyVariables(value: DocumentTypography): Record<string, string> {
  const t = normalizeDocumentTypography(value);
  const px = (size: number) => `${Math.round(size * 100) / 100}px`;
  return {
    '--page-type-body': px(t.bodySize),
    '--page-type-title': px(t.bodySize * t.titleRatio),
    '--page-type-heading-1': px(t.bodySize * t.h1Ratio),
    '--page-type-heading-2': px(t.bodySize * t.h2Ratio),
    '--page-type-heading-3': px(t.bodySize * t.h3Ratio),
    '--page-type-heading-4': px(t.bodySize * t.h4Ratio),
    '--page-type-leading': String(t.lineHeight),
    '--page-type-heading-space': px(20 * t.spacing),
    '--page-type-paragraph-space': px(5 * t.spacing),
  };
}
