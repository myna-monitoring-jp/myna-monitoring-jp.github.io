/** Date / number formatting. All output is JST-oriented and locale-stable. */

const JST = 'Asia/Tokyo';

function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 2026/09/01 */
export function formatDate(value: string | undefined | null, fallback = '―'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 9/1 */
export function formatShortDate(value: string | undefined | null, fallback = '―'): string {
  const date = toDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

/** 2026/09/01 11:25 JST */
export function formatDateTime(value: string | undefined | null, fallback = '―'): string {
  const date = toDate(value);
  if (!date) return fallback;
  const formatted = new Intl.DateTimeFormat('ja-JP', {
    timeZone: JST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatted} JST`;
}

/** 1,500 */
export function formatNumber(value: number | null | undefined, fallback = '―'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat('ja-JP').format(value);
}

/**
 * Affected headcount. `null` means 未公表 and must not be shown as 0.
 */
export function formatAffectedCount(
  value: number | null | undefined,
  note?: string,
): string {
  if (value === null || value === undefined) return note ?? '影響人数未公表';
  return note ? `${formatNumber(value)}人（${note}）` : `約${formatNumber(value)}人`;
}

/** Hostname of a URL, used as a visual cue for external destinations. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Hours elapsed since an ISO datetime. `Infinity` when unparsable. */
export function hoursSince(value: string | undefined | null, now: Date): number {
  const date = toDate(value);
  if (!date) return Number.POSITIVE_INFINITY;
  return (now.getTime() - date.getTime()) / (60 * 60 * 1000);
}
