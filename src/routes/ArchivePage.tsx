import { useMemo, useState } from 'react';
import type { Incident, MonitoringDataset, NewsItem, PRItem } from '@/types/monitoring';
import { NewsCard } from '@/components/news/NewsCard';
import { EmptyState, SectionTitle } from '@/components/common/Primitives';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { StatusBadge } from '@/components/common/StatusBadge';
import { dataUrl } from '@/data/loadMonitoringData';
import { allCorrections, itemTitleIndex } from '@/data/normalize';
import { effectiveStatus, selectQuietedItems } from '@/lib/dashboardRules';
import { matchesQuery } from '@/lib/filters';
import { formatDate, formatDateTime } from '@/lib/format';
import { INCIDENT_CATEGORY_META } from '@/lib/statusLabels';

interface ArchivePageProps {
  dataset: MonitoringDataset;
  now: Date;
  query: string;
}

/**
 * アーカイブ.
 *
 * Everything the N-day rule removed from the dashboard is still searchable here,
 * together with the daily reports, the backlash timeline and the correction log.
 */
export function ArchivePage({ dataset, now, query }: ArchivePageProps) {
  const { settings } = dataset;
  const [localQuery, setLocalQuery] = useState('');
  const effectiveQuery = [query, localQuery].filter(Boolean).join(' ');

  const quieted = useMemo(() => {
    const news = selectQuietedItems<NewsItem>(dataset.news, settings, now);
    const incidents = selectQuietedItems<Incident>(dataset.incidents, settings, now);
    const prItems = selectQuietedItems<PRItem>(dataset.prItems, settings, now);
    return [...news, ...incidents, ...prItems].filter((item) => matchesQuery(item, effectiveQuery));
  }, [dataset, settings, now, effectiveQuery]);

  const corrections = useMemo(() => allCorrections(dataset), [dataset]);
  const titles = useMemo(() => itemTitleIndex(dataset), [dataset]);

  const archives = dataset.archive.filter(
    (entry) =>
      !effectiveQuery ||
      `${entry.title} ${entry.description ?? ''} ${entry.date}`
        .toLowerCase()
        .includes(effectiveQuery.toLowerCase()),
  );

  return (
    <>
      <SectionTitle
        title="アーカイブ"
        description="ダッシュボードから外れた案件も削除せず保持します。"
      />

      <div className="toolbar" role="search">
        <div className="toolbar-field grow">
          <label htmlFor="archive-query">アーカイブ内検索</label>
          <input
            id="archive-query"
            type="search"
            value={localQuery}
            placeholder="日付・案件・自治体・キャンペーンを検索"
            onChange={(event) => setLocalQuery(event.target.value)}
          />
        </div>
        <button type="button" className="toolbar-reset" onClick={() => setLocalQuery('')}>
          絞り込みを解除
        </button>
      </div>

      <SectionTitle title="日別レポート" />
      {archives.length === 0 ? (
        <EmptyState>該当する日別レポートはありません。</EmptyState>
      ) : (
        <ul className="archive-grid">
          {archives.map((entry) => (
            <li className="archive-card" key={entry.date}>
              <b>{formatDate(entry.date)} レポート</b>
              <small>{entry.title}</small>
              {entry.description && <small>{entry.description}</small>}
              <div className="actionrow">
                {entry.dataPath && (
                  <ExternalLinkButton
                    source={{
                      type: 'primary',
                      label: 'JSON',
                      url: new URL(dataUrl(entry.dataPath), window.location.href).toString(),
                      linkText: '日次データを開く',
                    }}
                  />
                )}
                {entry.htmlUrl && (
                  <ExternalLinkButton
                    source={{
                      type: 'primary',
                      label: 'HTML',
                      url: new URL(entry.htmlUrl, window.location.href).toString(),
                      linkText: '日次レポートを開く',
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle
        title="ダッシュボード非表示の案件"
        description={`最終重要更新から${settings.dashboardQuietDays}日以上動きがない案件、アーカイブ状態の案件`}
      />
      {quieted.length === 0 ? (
        <EmptyState>非表示になっている案件はありません。</EmptyState>
      ) : (
        <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))' }}>
          {quieted.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              settings={settings}
              now={now}
              showVisibilityNote
              extraDetails={
                'incidentCategory' in item
                  ? [
                      { label: '主体', value: (item as Incident).entityName },
                      {
                        label: '系統',
                        value: INCIDENT_CATEGORY_META[(item as Incident).incidentCategory].short,
                      },
                    ]
                  : []
              }
            />
          ))}
        </div>
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

      <SectionTitle title="解消済み・沈静化の状態内訳" />
      <ul className="legend">
        {(['resolved', 'quiet', 'archived'] as const).map((status) => {
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
