const koreanTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const koreanClock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const koreanDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

export function formatKoreanDate(value = Date.now()) {
  const parts = Object.fromEntries(
    koreanDate.formatToParts(value).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} (${parts.weekday})`;
}

export function formatKoreanTime(value: string, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '날짜 없음';
  const parts = Object.fromEntries(
    koreanTime.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  const today = Object.fromEntries(
    koreanTime.formatToParts(new Date(now)).map(({ type, value }) => [type, value]),
  );
  if (parts.year === today.year && parts.month === today.month && parts.day === today.day)
    return `오늘 ${koreanClock.format(date)}`;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function isNewCapture(value: string, now = Date.now()) {
  const age = now - Date.parse(value);
  return age >= 0 && age < 24 * 60 * 60 * 1000;
}
