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

/** Clipboard API calls can hang instead of rejecting; never block the UI on one. */
const CLIPBOARD_TIMEOUT_MS = 1500;

function withTimeout(promise: Promise<unknown>): Promise<'copied' | 'failed'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('failed'), CLIPBOARD_TIMEOUT_MS);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve('copied');
      },
      () => {
        clearTimeout(timer);
        resolve('failed');
      },
    );
  });
}

/**
 * Copies text to the clipboard, returning `'failed'` rather than throwing.
 *
 * A failure is an expected outcome, not an error: managed browsers frequently
 * deny `clipboard-write` by policy, and the legacy `execCommand` path is denied
 * with it. Callers must offer a visible fallback (see `CopyPanel`).
 */
export async function copyToClipboard(text: string): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    let result: CopyResult = 'failed';
    try {
      result = await withTimeout(navigator.clipboard.writeText(text));
    } catch {
      result = 'failed';
    }
    if (result === 'copied') return 'copied';
    // fall through to the legacy path
  }

  if (typeof document === 'undefined') return 'failed';
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    // `opacity: 0` and `display: none` make Chrome refuse to copy the selection,
    // so keep the element rendered but visually insignificant instead.
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.color = 'transparent';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
