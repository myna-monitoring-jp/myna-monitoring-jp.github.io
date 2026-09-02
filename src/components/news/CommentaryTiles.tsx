import type { NewsItem } from '@/types/monitoring';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { EmptyState } from '@/components/common/Primitives';
import { COMMENTARY_TONE_META, commentaryTone } from '@/lib/statusLabels';
import { formatShortDate } from '@/lib/format';
import { partitionSources } from '@/lib/links';

interface CommentaryTilesProps {
  items: readonly NewsItem[];
}

/**
 * 解説記事・二次情報の小タイル欄。
 *
 * 一次情報でも独自報道でもない記事（制度の解説、ハウツー、まとめ、二次転載）を
 * 本文の一覧に混ぜず、画面下部に小さく並べる。監視対象の事象ではないため
 * 面積を割かない。論調（ポジティブ／中立／ネガティブ）だけを添える。
 */
export function CommentaryTiles({ items }: CommentaryTilesProps) {
  if (items.length === 0) {
    return <EmptyState>該当する解説記事はありません。</EmptyState>;
  }

  return (
    <>
      <ul className="commentary-tiles" data-testid="commentary-tiles">
        {items.map((item) => {
          const tone = commentaryTone(item.polarity);
          const meta = COMMENTARY_TONE_META[tone];
          const { linkable } = partitionSources(item.sources);
          const source = linkable[0];
          const publisher = source?.publisher ?? source?.label ?? '媒体不明';

          return (
            <li
              className="commentary-tile"
              key={item.id}
              data-testid="commentary-tile"
              data-item-id={item.id}
              data-tone={tone}
            >
              <div className="commentary-tile-head">
                <span className="commentary-meta">
                  {publisher}｜{formatShortDate(item.publishedAt ?? item.detectedAt, '日付不明')}
                </span>
                <span
                  className={`commentary-tone commentary-tone-${meta.tone}`}
                  title={meta.description}
                  data-testid="commentary-tone"
                >
                  <span aria-hidden="true">{meta.symbol}</span>
                  <span className="visually-hidden">論調：</span>
                  {meta.label}
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
        論調の判定は自動です。ポジティブ＝制度に肯定的で使い方などを解説、ネガティブ＝批判的な論調、中立＝方法や制度を中立的に説明しているだけ。
        いずれも監視対象の事象ではなく、参考情報として並べています。
      </p>
    </>
  );
}
