import type { NewsItem } from '@/types/monitoring';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { EmptyState } from '@/components/common/Primitives';
import { formatShortDate } from '@/lib/format';
import { partitionSources } from '@/lib/links';

interface ReferenceTilesProps {
  items: readonly NewsItem[];
}

/**
 * 参考情報の小タイル欄。
 *
 * 官公庁・自治体の一次情報だが、不具合・障害・炎上といった監視対象の事象では
 * ないもの（省庁の周年発表、イベント開催報告など）。押さえておくと役に立つので
 * 捨てずに残すが、監視の本線ではないためダッシュボード下部に小さく並べる。
 */
export function ReferenceTiles({ items }: ReferenceTilesProps) {
  if (items.length === 0) {
    return <EmptyState>参考情報はありません。</EmptyState>;
  }

  return (
    <>
      <ul className="commentary-tiles" data-testid="reference-tiles">
        {items.map((item) => {
          const { linkable } = partitionSources(item.sources);
          const source = linkable[0];
          const publisher = source?.publisher ?? source?.label ?? '発信元不明';

          return (
            <li
              className="commentary-tile reference-tile"
              key={item.id}
              data-testid="reference-tile"
              data-item-id={item.id}
            >
              <div className="commentary-tile-head">
                <span className="commentary-meta">
                  {publisher}｜{formatShortDate(item.publishedAt ?? item.detectedAt, '日付不明')}
                </span>
                <span className="commentary-tone commentary-tone-blue" data-testid="reference-badge">
                  <span aria-hidden="true">i</span>
                  参考
                </span>
              </div>

              <h4>{item.title}</h4>

              {source ? (
                <div className="actionrow">
                  <ExternalLinkButton source={source} />
                </div>
              ) : (
                <p className="note">参照できる出典がありません。</p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="note">
        官公庁・自治体の一次情報のうち、不具合・障害・炎上には該当しないものです。監視対象ではありませんが、把握しておくと役に立つため残しています。
      </p>
    </>
  );
}
