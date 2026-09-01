import type { Source } from '@/types/monitoring';
import { EXTERNAL_LINK_ATTRS, isLinkableSource, sourceLinkText } from '@/lib/links';
import { hostnameOf } from '@/lib/format';
import { SOURCE_TYPE_META } from '@/lib/statusLabels';

interface ExternalLinkButtonProps {
  source: Source;
}

/**
 * The single component used for every external reference in the app.
 *
 * Guarantees (要件「参照元リンク」/ 受入条件 1-2):
 * - a real <a href> with an absolute http(s) URL
 * - target="_blank" rel="noopener noreferrer"
 * - the whole rectangle is the anchor, so the entire button is clickable
 * - explicit wording («一次情報を開く» etc.), never a bare "詳細"
 * - an unusable URL renders as text, never as an empty/# link
 */
export function ExternalLinkButton({ source }: ExternalLinkButtonProps) {
  const label = sourceLinkText(source);
  const tone = SOURCE_TYPE_META[source.type]?.tone ?? 'source';
  const typeLabel = SOURCE_TYPE_META[source.type]?.label ?? '出典';

  if (!isLinkableSource(source)) {
    return (
      <span className="dead-link" data-testid="dead-link">
        <span aria-hidden="true">⚠</span>
        {source.label}：リンク切れのため参照できません
      </span>
    );
  }

  const host = hostnameOf(source.url);

  return (
    <a
      className={`action ${tone}`}
      href={source.url}
      target={EXTERNAL_LINK_ATTRS.target}
      rel={EXTERNAL_LINK_ATTRS.rel}
      data-testid="external-link"
      data-source-type={source.type}
      // The accessible name states the type, the label and that a new tab opens.
      aria-label={`${typeLabel}：${source.label} — ${label}（新しいタブで開きます）`}
    >
      <span>{source.label}｜{label}</span>
      {host && (
        <span className="action-source-host" aria-hidden="true">
          {host}
        </span>
      )}
      <span className="external-mark" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

interface SourceListProps {
  sources?: readonly Source[];
  /** Shown when the item has no sources at all. */
  emptyText?: string;
}

/** Renders every source of an item, keeping broken ones visible as notices. */
export function SourceList({ sources = [], emptyText = '出典未登録' }: SourceListProps) {
  if (sources.length === 0) {
    return <p className="note">{emptyText}</p>;
  }
  return (
    <div className="actionrow">
      {sources.map((source, index) => (
        <ExternalLinkButton key={`${source.url}-${index}`} source={source} />
      ))}
    </div>
  );
}
