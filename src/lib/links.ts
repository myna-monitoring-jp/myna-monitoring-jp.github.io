import type { Source } from '@/types/monitoring';
import { SOURCE_TYPE_META } from '@/lib/statusLabels';

/**
 * Link safety rules (要件 5.D / 受入条件 1-3).
 *
 * - every reference must be a real `<a href>` pointing at an absolute http(s) URL
 * - empty href, `#`, and `javascript:` are rejected
 * - external links always get target="_blank" rel="noopener noreferrer"
 * - a URL that fails validation is rendered as plain text, never as a dead link
 */

const FORBIDDEN_HREFS = new Set(['', '#', 'javascript:void(0)', 'javascript:void(0);', 'about:blank']);

export function isUsableExternalUrl(url: string | undefined | null): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (FORBIDDEN_HREFS.has(trimmed.toLowerCase())) return false;
  if (trimmed.startsWith('#')) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** A source is renderable as a link only when the URL is usable and not marked dead. */
export function isLinkableSource(source: Source): boolean {
  return source.active !== false && isUsableExternalUrl(source.url);
}

/**
 * Button wording. Always explicit ("一次情報を開く" / "報道記事を開く" / "X投稿を開く"),
 * never a bare "詳細" or "リンク".
 */
export function sourceLinkText(source: Source): string {
  if (source.linkText && source.linkText.trim()) return source.linkText.trim();
  if (source.type === 'social' && /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(safeHostname(source.url))) {
    return 'X投稿を開く';
  }
  return SOURCE_TYPE_META[source.type]?.defaultLinkText ?? '出典を開く';
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Attributes every external anchor in the app must carry. */
export const EXTERNAL_LINK_ATTRS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;

/** Sources split into linkable and broken, so broken ones can be reported. */
export function partitionSources(sources: readonly Source[] = []): {
  linkable: Source[];
  broken: Source[];
} {
  const linkable: Source[] = [];
  const broken: Source[] = [];
  for (const source of sources) {
    if (isLinkableSource(source)) linkable.push(source);
    else broken.push(source);
  }
  return { linkable, broken };
}
