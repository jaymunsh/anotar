export const calloutColors = ['default', 'gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export const calloutIcons = ['lightbulb', 'info', 'warning', 'check', 'none'] as const;
export type CalloutIcon = (typeof calloutIcons)[number];
export const calloutColorLabels: Record<(typeof calloutColors)[number], string> = {
  default: '투명', gray: '회색', brown: '갈색', red: '빨강', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라', pink: '분홍',
};
export const calloutIconLabels: Record<CalloutIcon, string> = {
  lightbulb: '아이디어', info: '안내', warning: '주의', check: '확인', none: '아이콘 없음',
};
// Fixed Lucide geometry only; stored text never becomes SVG markup.
export function calloutIconSvg(value: unknown): string {
  const paths: Record<string, string> = {
    lightbulb: '<path d="M9 18h6M9 22h6M15.09 14a6 6 0 1 0-6.18 0C10 15 10 16 10 16h4s0-1 1.09-2Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  };
  if (value === 'none') return '';
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[String(value)] || paths.lightbulb}</svg>`;
}
