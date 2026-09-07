import { useMemo, useState } from 'react';
import type { ItemStatus, MonitoringDataset, NewsItem, Severity } from '@/types/monitoring';
import { NewsCard } from '@/components/news/NewsCard';
import { CommentaryTiles } from '@/components/news/CommentaryTiles';
import { EmptyState, SectionTitle } from '@/components/common/Primitives';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { FilterToolbar } from '@/components/common/FilterToolbar';
import { effectiveStatus, isOnDashboard } from '@/lib/dashboardRules';
import { filterItems, sortItems, type SortKey } from '@/lib/filters';
import { SNS_DISCLAIMER } from '@/config/appConfig';

interface NewsPageProps {
  dataset: MonitoringDataset;
  now: Date;
  /** Global search term from the top bar; seeds the page filter. */
  query: string;
}

/**
 * トップニュース・世論.
 *
 * Unlike the dashboard this page shows *every* item, including ones the N-day
 * rule removed from the dashboard (要件: 詳細・アーカイブには残す).
 */
export function NewsPage({ dataset, now, query }: NewsPageProps) {
  const { settings } = dataset;
  const [localQuery, setLocalQuery] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [sort, setSort] = useState<SortKey>('lastUpdate');

  const effectiveQuery = [query, localQuery].filter(Boolean).join(' ');

  const items = useMemo(() => {
    const filtered = filterItems<NewsItem>(
      dataset.news,
      {
        query: effectiveQuery,
        statuses: status ? [status] : [],
        severities: severity ? [severity] : [],
      },
      (item) => effectiveStatus(item, settings, now),
    );
    return sortItems(filtered, sort);
  }, [dataset.news, effectiveQuery, status, severity, sort, settings, now]);

  // 解説記事・二次情報は本文の一覧に混ぜず、画面下部の小タイル欄へ回す。
  const commentary = useMemo(() => items.filter((item) => item.category === 'commentary'), [items]);
  // 参考情報はダッシュボード下部に集約するので、ここでは扱わない
  const mainItems = useMemo(
    () =>
      items
        .filter((item) => item.category !== 'commentary' && item.category !== 'reference')
        /*
         * 機械収集した見出しは本線の一覧に出さない。全量は「収集一覧」画面へ。
         * 表題以上の情報を持たないカードを書き起こしと同じ一覧に混ぜると、
         * どれが裏を取った案件なのか見分けられなくなる。
         */
        .filter((item) => item.reviewState !== 'unreviewed'),
    [items],
  );

  // 「要注視」は最上段に1段で切り出す。今日確認すべき案件を探させないため。
  const attention = useMemo(
    () => mainItems.filter((item) => effectiveStatus(item, settings, now) === 'attention'),
    [mainItems, settings, now],
  );
  const others = useMemo(
    () => mainItems.filter((item) => effectiveStatus(item, settings, now) !== 'attention'),
    [mainItems, settings, now],
  );

  const reset = () => {
    setLocalQuery('');
    setStatus('');
    setSeverity('');
    setSort('lastUpdate');
  };

  return (
    <>
      <SectionTitle
        title="トップニュース・世論"
        description="ニュース → 国民の声 → 事実関係 → 出典。ダッシュボードから外れた案件もここには残ります。"
      />

      <FilterToolbar
        searchLabel="キーワード検索"
        searchPlaceholder="タイトル・本文・省庁・システム・タグを検索"
        query={localQuery}
        onQueryChange={setLocalQuery}
        status={status}
        onStatusChange={setStatus}
        severity={severity}
        onSeverityChange={setSeverity}
        sort={sort}
        onSortChange={setSort}
        onReset={reset}
        resultCount={items.length}
      />

      {mainItems.length === 0 && commentary.length === 0 ? (
        <EmptyState>条件に一致するニュースはありません。絞り込みを解除してください。</EmptyState>
      ) : (
        <>
          {attention.length > 0 && (
            <section aria-labelledby="attention-heading" data-testid="attention-band">
              <div className="section-title" style={{ margin: '0 0 9px' }}>
                <div>
                  <h2 id="attention-heading" style={{ fontSize: '15px' }}>
                    要注視（{attention.length}件）
                  </h2>
                  <p>今日も能動的に確認する理由がある案件。横に並べて1段で表示しています。</p>
                </div>
              </div>
              <ul className="row-single" data-testid="attention-row">
                {attention.map((item) => (
                  <li key={item.id}>
                    <NewsCard
                      item={item}
                      settings={settings}
                      now={now}
                      showVisibilityNote={!isOnDashboard(item, settings, now)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {others.length > 0 && (
            <>
              {attention.length > 0 && (
                <div className="section-title" style={{ margin: '22px 0 9px' }}>
                  <div>
                    <h2 style={{ fontSize: '15px' }}>その他の案件（{others.length}件）</h2>
                    <p>新着・続報待ち・解消済・計画停止・沈静化</p>
                  </div>
                </div>
              )}
              <div
                className="grid-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))' }}
              >
                {others.map((item) => (
                  <NewsCard
                    key={item.id}
                    item={item}
                    settings={settings}
                    now={now}
                    showVisibilityNote={!isOnDashboard(item, settings, now)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {commentary.length > 0 && (
        <>
          <SectionTitle
            title={`解説記事・二次情報（${commentary.length}件）`}
            description="一次情報でも独自報道でもない、制度の解説・ハウツー・二次転載。監視対象の事象ではないため小さく並べています。"
          />
          <CommentaryTiles items={commentary} />
        </>
      )}

      <SectionTitle title="世論の表示ルール" />
      <div className="grid-2">
        <div className="panel">
          <h3>代表性のある調査</h3>
          <p className="summary">調査主体・標本数・調査方法・設問文を必ず併記し、SNSとは別枠で表示します。</p>
          {dataset.surveys.length === 0 ? (
            <EmptyState>直近で新規の全国調査は確認できていません。</EmptyState>
          ) : (
            <ul className="pulse">
              {dataset.surveys.map((survey) => (
                <li className="pulse-item" key={survey.id}>
                  <b>{survey.title}</b>
                  <p>{survey.summary}</p>
                  <p className="note">
                    {survey.organization}／{survey.method}／有効回答 {survey.sampleSize}／{survey.fieldworkPeriod}
                  </p>
                  <div className="actionrow">
                    {survey.sources.map((source, index) => (
                      <ExternalLinkButton key={`${source.url}-${index}`} source={source} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <h3>X / Yahoo!コメント</h3>
          <p className="summary">{SNS_DISCLAIMER}</p>
          <p className="summary">
            まだ観測されていない「予測される批判」は国民の声に含めず、各カードの
            <b>「広報上のリスク」</b>として分けて表示します。
          </p>
        </div>
      </div>
    </>
  );
}
