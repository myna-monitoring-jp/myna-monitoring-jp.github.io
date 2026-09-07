import { useMemo, useState } from 'react';
import type { MonitoringDataset, NewsItem } from '@/types/monitoring';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { EmptyState, SectionTitle } from '@/components/common/Primitives';
import { formatShortDate } from '@/lib/format';
import { partitionSources } from '@/lib/links';
import { matchesQuery } from '@/lib/filters';

interface CollectedPageProps {
  dataset: MonitoringDataset;
  query: string;
}

/**
 * 収集一覧。
 *
 * 機械収集した見出しの全量を置く画面。ここは**材料置き場**であって
 * 報告ではない。朝の状況判断がこの一覧を読んで、載せる価値のあるものを
 * 選んで書き起こしている。
 *
 * 分ける理由：見出しをそのまま並べたカードは、表題以上の情報を持たない。
 * 以前はこれをダッシュボードとトップニュースに混ぜていたため、
 * 書き起こされた案件と情報量ゼロのカードが同じ見た目で並んでいた。
 *
 * それでも捨てないのは、取りこぼしの検証に使えるため。
 * 「あの件が報告に出ていない」と気づいたとき、材料に入っていたのか
 * （＝選定の問題）、入っていなかったのか（＝収集の問題）が分かる。
 */
export function CollectedPage({ dataset, query }: CollectedPageProps) {
  const [localQuery, setLocalQuery] = useState('');
  const effectiveQuery = [query, localQuery].filter(Boolean).join(' ');

  const items = useMemo(
    () =>
      dataset.news
        .filter((item) => item.reviewState === 'unreviewed')
        .filter((item) => matchesQuery(item, effectiveQuery))
        // 新しいものから
        .sort((a, b) =>
          String(b.publishedAt ?? b.detectedAt ?? '').localeCompare(String(a.publishedAt ?? a.detectedAt ?? '')),
        ),
    [dataset.news, effectiveQuery],
  );

  return (
    <>
      <SectionTitle
        title={`収集一覧（${items.length}件）`}
        description="機械収集した見出しの全量です。報告ではなく、朝の状況判断がここから選んで書き起こしています。"
      />

      <div className="collected-note">
        <p>
          この画面のカードは<strong>見出しそのまま</strong>で、判断も裏取りも入っていません。読むべきものはダッシュボードの朝の動向レポートに書き起こされています。
        </p>
        <p className="note">
          ここを見る用途は取りこぼしの確認です。報告に出ていない案件がこの一覧にあれば選定の問題、無ければ収集の問題です。後者の場合は改修要望からお知らせください。
        </p>
      </div>

      <label className="collected-search">
        <span>この一覧を絞り込む</span>
        <input
          type="search"
          value={localQuery}
          onChange={(event) => setLocalQuery(event.target.value)}
          placeholder="媒体名・キーワード"
        />
      </label>

      {items.length === 0 ? (
        <EmptyState>該当する収集項目はありません。</EmptyState>
      ) : (
        <ul className="collected-list" data-testid="collected-list">
          {items.map((item) => (
            <CollectedRow item={item} key={item.id} />
          ))}
        </ul>
      )}
    </>
  );
}

function CollectedRow({ item }: { item: NewsItem }) {
  const { linkable } = partitionSources(item.sources);
  const source = linkable[0];
  const publisher = source?.publisher ?? source?.label ?? '発信元不明';

  return (
    <li className="collected-row" data-testid="collected-row" data-item-id={item.id}>
      <div className="collected-row-main">
        <p className="collected-meta">
          {publisher}｜{formatShortDate(item.publishedAt ?? item.detectedAt, '日付不明')}
        </p>
        <p className="collected-title">{item.title}</p>
        {item.tags && item.tags.length > 0 ? (
          <ul className="collected-tags">
            {item.tags
              // 「自動収集」は画面全体が自動収集なので個別に出さない
              .filter((tag) => tag !== '自動収集')
              .map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
          </ul>
        ) : null}
      </div>
      {source ? (
        <div className="collected-row-action">
          <ExternalLinkButton source={source} />
        </div>
      ) : (
        <p className="note">参照できる出典がありません。</p>
      )}
    </li>
  );
}
