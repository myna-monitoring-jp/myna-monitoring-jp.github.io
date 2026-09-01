import type { ViewKey } from '@/lib/teamsSummary';

/**
 * Share URL helpers.
 *
 * Routing is hash-based (`#/incidents?category=common_system`) so a deep link
 * survives any static host without server rewrite rules.
 */

export function buildShareUrl(view: ViewKey, params?: Record<string, string | undefined>): string {
  const origin = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  const path = view === 'dashboard' ? '/' : `/${view}`;
  return `${origin}#${path}${query ? `?${query}` : ''}`;
}

/** Current URL, used by the 「共有URLをコピー」 button. */
export function currentShareUrl(): string {
  return typeof window !== 'undefined' ? window.location.href : '';
}

export type CopyResult = 'copied' | 'failed';

/**
 * Copies text to the clipboard.
 * Falls back to `document.execCommand` because the Clipboard API is blocked on
 * non-secure origins, which is common for internal file shares.
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      // fall through to the legacy path
    }
  }
  if (typeof document === 'undefined') return 'failed';
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
