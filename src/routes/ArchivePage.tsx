import { useMemo, useState } from 'react';
import type { Incident, MonitoringDataset, NewsItem, PRItem } from '@/types/monitoring';
import { ArchiveTile } from '@/components/archive/ArchiveTile';
import { EmptyState, SectionTitle } from '@/components/common/Primitives';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { StatusBadge } from '@/components/common/StatusBadge';
import { allCorrections, itemTitleIndex } from '@/data/normalize';
import { effectiveStatus, selectQuietedItems } from '@/lib/dashboardRules';
import { matchesQuery } from '@/lib/filters';
import { formatDate, formatDateTime } from '@/lib/format';

interface ArchivePageProps {
  dataset: MonitoringDataset;
  now: Date;
  query: string;
}

/**
 * アーカイブ.
 *
 * N日ルールでダッシュボードから外れた案件を、タイル形式で一覧する。
 * 各タイルは「タイトル・出典リンク・発覚から沈静化までの流れ」だけを持つ。
 *
 * 日別レポートの生データ（archive/*.json）は日次処理が保持し続けているが、
 * 生JSONへのリンクは閲覧者にとって意味がないため画面には出さない。
 */
export function ArchivePage({ dataset, now, query }: ArchivePageProps) {
  const { settings } = dataset;
  const [localQuery, setLocalQuery] = useState('');
  const effectiveQuery = [query, localQuery].filter(Boolean).join(' ');

  const quieted = useMemo(() => {
    const news = selectQuietedItems<NewsItem>(dataset.news, settings, now);
    const incidents = selectQuietedItems<Incident>(dataset.incidents, settings, now);
    const prItems = selectQuietedItems<PRItem>(dataset.prItems, settings, now);
    return [...news, ...incidents, ...prItems]
      .filter((item) => matchesQuery(item, effectiveQuery))
      .sort((a, b) => b.lastMaterialUpdateAt.localeCompare(a.lastMaterialUpdateAt));
  }, [dataset, settings, now, effectiveQuery]);

  const corrections = useMemo(() => allCorrections(dataset), [dataset]);
  const titles = useMemo(() => itemTitleIndex(dataset), [dataset]);

  return (
    <>
      <SectionTitle
        title="アーカイブ"
        description={`最終重要更新から${settings.dashboardQuietDays}日以上動きがない案件、解消済・アーカイブ状態の案件。削除せず保持します。`}
      />

      <div className="toolbar" role="search">
        <div className="toolbar-field grow">
          <label htmlFor="archive-query">アーカイブ内検索</label>
          <input
            id="archive-query"
            type="search"
            value={localQuery}
            placeholder="案件・自治体・システム・キャンペーンを検索"
            onChange={(event) => setLocalQuery(event.target.value)}
          />
        </div>
        <button type="button" className="toolbar-reset" onClick={() => setLocalQuery('')}>
          絞り込みを解除
        </button>
      </div>
      <p className="note" role="status" aria-live="polite" data-testid="archive-count">
        {quieted.length}件を表示しています。
      </p>

      {quieted.length === 0 ? (
        <EmptyState>
          該当する案件はありません。ダッシュボードから外れた案件が出ると、ここにタイルで並びます。
        </EmptyState>
      ) : (
        <ul className="archive-tiles">
          {quieted.map((item) => (
            <ArchiveTile key={item.id} item={item} settings={settings} now={now} />
          ))}
        </ul>
      )}

      <SectionTitle title="広報炎上タイムライン" />
      {dataset.timeline.length === 0 ? (
        <EmptyState>記録された炎上タイムラインはありません。</EmptyState>
      ) : (
        <ul className="timeline">
          {dataset.timeline.map((entry, index) => (
            <li className="timeline-item" key={`${entry.date}-${index}`}>
              <div className="timeline-date">{formatDate(entry.date)}</div>
              <div className="timeline-body">
                <b>{entry.title}</b>
                {entry.description && <p>{entry.description}</p>}
                {(entry.sources?.length ?? 0) > 0 && (
                  <div className="actionrow">
                    {entry.sources!.map((source, sourceIndex) => (
                      <ExternalLinkButton key={`${source.url}-${sourceIndex}`} source={source} />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle title="訂正履歴" description="公開後に修正した内容を記録として残します。" />
      {corrections.length === 0 ? (
        <EmptyState>記録された訂正はありません。</EmptyState>
      ) : (
        <div className="tablewrap corrections-table" data-testid="corrections-table">
          <table>
            <caption className="visually-hidden">訂正履歴</caption>
            <thead>
              <tr>
                <th scope="col">訂正日時</th>
                <th scope="col">対象</th>
                <th scope="col">項目</th>
                <th scope="col">訂正前</th>
                <th scope="col">訂正後</th>
                <th scope="col">理由</th>
                <th scope="col">担当</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((correction, index) => (
                <tr key={`${correction.correctedAt}-${index}`} data-testid="correction-row">
                  <td>{formatDateTime(correction.correctedAt)}</td>
                  <td>{correction.itemId ? (titles.get(correction.itemId) ?? correction.itemId) : 'サイト全体'}</td>
                  <td>{correction.field ?? '―'}</td>
                  <td>{correction.before ?? '―'}</td>
                  <td>{correction.after ?? '―'}</td>
                  <td>{correction.reason}</td>
                  <td>{correction.editor ?? '―'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle title="状態別の件数" />
      <ul className="legend">
        {(['resolved', 'quiet', 'archived', 'planned_outage'] as const).map((status) => {
          const count = [...dataset.news, ...dataset.incidents, ...dataset.prItems].filter(
            (item) => effectiveStatus(item, settings, now) === status,
          ).length;
          return (
            <li key={status}>
              <StatusBadge status={status} withDescription />
              {count}件
            </li>
          );
        })}
      </ul>
    </>
  );
}
