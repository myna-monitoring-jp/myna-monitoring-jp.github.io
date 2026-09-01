import type { AppSettings, BaseItem, QuantitativeMetric } from '@/types/monitoring';
import { StatusBadge } from '@/components/common/StatusBadge';
import { CardBlock, Tag } from '@/components/common/Primitives';
import { SourceList } from '@/components/common/ExternalLinkButton';
import { PublicVoiceList } from '@/components/news/PublicVoiceList';
import { FactCheckList } from '@/components/news/FactCheckList';
import { effectiveStatus, decideDashboardVisibility, explainDecision } from '@/lib/dashboardRules';
import { formatDateTime, formatShortDate } from '@/lib/format';
import { POLARITY_LABEL, SEVERITY_LABEL } from '@/lib/statusLabels';

interface NewsCardProps {
  item: BaseItem;
  settings: AppSettings;
  now: Date;
  /** Compact variant used on the dashboard grid. */
  compact?: boolean;
  /** Shows why the item is not on the dashboard (archive / detail views). */
  showVisibilityNote?: boolean;
  /** Extra rows injected by Incident / PR cards. */
  extraDetails?: { label: string; value: string }[];
  /** Slot rendered above 出典, used by PR cards for classification-specific info. */
  children?: React.ReactNode;
}

function MetricList({ metrics }: { metrics?: readonly QuantitativeMetric[] }) {
  if (!metrics || metrics.length === 0) {
    return <p className="note">定量情報は未取得です。</p>;
  }
  return (
    <ul className="metric-list">
      {metrics.map((metric, index) => (
        <li className="metric" key={`${metric.label}-${index}`}>
          <span>{metric.label}：</span>
          <b>
            {metric.value}
            {metric.unit ?? ''}
          </b>
          {metric.note && <span className="note"> {metric.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The mandatory news card structure (要件「各ニュースカードの必須項目」):
 *   1. ニュース自体 / 2. 国民の声・現場の声 / 3. 事実関係・誤解の切り分け /
 *   4. 出典・リンク / 5. 定量情報 / 6. 前日差分 / 7. 最終重要更新日時
 *
 * There is no overlay link: the card itself is never clickable. Only the
 * explicit reference buttons inside it navigate anywhere.
 */
export function NewsCard({
  item,
  settings,
  now,
  compact = false,
  showVisibilityNote = false,
  extraDetails = [],
  children,
}: NewsCardProps) {
  const status = effectiveStatus(item, settings, now);
  const decision = decideDashboardVisibility(item, settings, now);

  const accent =
    item.polarity === 'positive'
      ? 'good'
      : status === 'attention' || item.polarity === 'negative'
        ? 'critical'
        : status === 'planned_outage'
          ? 'planned'
          : '';

  const dateLine = [
    item.publishedAt ? `公表 ${formatShortDate(item.publishedAt)}` : null,
    item.occurredAt ? `発生 ${formatShortDate(item.occurredAt)}` : null,
    item.detectedAt ? `検知 ${formatShortDate(item.detectedAt)}` : null,
  ]
    .filter(Boolean)
    .join('｜');

  return (
    <article className={`card news-card ${accent}`} data-testid="news-card" data-item-id={item.id}>
      <div className="card-head">
        <h3>{item.title}</h3>
        <StatusBadge status={status} withDescription />
      </div>

      <p className="meta">
        {dateLine || '日時未記載'}
        {' ／ '}重要度 {SEVERITY_LABEL[item.severity]}
        {item.pinned && ' ／ ピン留め'}
      </p>

      <p className="summary">{item.summary}</p>

      {item.whatIsNew && (
        <p className="summary">
          <b>何が新しいか：</b>
          {item.whatIsNew}
        </p>
      )}
      {item.audience && (
        <p className="summary">
          <b>影響対象：</b>
          {item.audience}
        </p>
      )}

      {extraDetails.length > 0 && (
        <dl className="summary" style={{ display: 'grid', gap: 2, margin: '9px 0 0' }}>
          {extraDetails.map((detail) => (
            <div key={detail.label}>
              <dt style={{ display: 'inline', fontWeight: 700 }}>{detail.label}：</dt>
              <dd style={{ display: 'inline', margin: 0 }}>{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(item.tags?.length || item.polarity) && (
        <ul className="tagrow">
          {item.polarity && (
            <li>
              <Tag tone={item.polarity === 'positive' ? 'green' : item.polarity === 'negative' ? 'red' : 'gray'}>
                {POLARITY_LABEL[item.polarity]}
              </Tag>
            </li>
          )}
          {(item.tags ?? []).map((tag) => (
            <li key={tag}>
              <Tag>{tag}</Tag>
            </li>
          ))}
        </ul>
      )}

      {children}

      {!compact && (
        <>
          <CardBlock heading="国民の声・現場の声">
            <PublicVoiceList voices={item.publicVoices} communicationRisks={item.communicationRisks} />
          </CardBlock>

          <CardBlock heading="事実関係・誤解の切り分け">
            <FactCheckList factChecks={item.factChecks} />
          </CardBlock>

          <CardBlock heading="定量情報">
            <MetricList metrics={item.quantitativeMetrics} />
          </CardBlock>
        </>
      )}

      <CardBlock heading="出典・リンク">
        <SourceList sources={item.sources} />
      </CardBlock>

      <CardBlock heading="更新状況">
        <p className="note" data-testid="daily-diff">
          <b>前日差分：</b>
          {item.dailyDiff ?? '前日から変化なし'}
        </p>
        <p className="note" data-testid="last-material-update">
          <b>最終重要更新：</b>
          {formatDateTime(item.lastMaterialUpdateAt, '未設定')}
        </p>
        {showVisibilityNote && (
          <p className="note" data-testid="visibility-note">
            {explainDecision(decision, settings.dashboardQuietDays)}
          </p>
        )}
      </CardBlock>

      {(item.corrections?.length ?? 0) > 0 && (
        <CardBlock heading="訂正履歴">
          <ul>
            {item.corrections!.map((correction, index) => (
              <li className="note" key={`${correction.correctedAt}-${index}`}>
                {formatDateTime(correction.correctedAt)}：{correction.reason}
                {correction.before && correction.after && (
                  <>
                    （「{correction.before}」→「{correction.after}」）
                  </>
                )}
              </li>
            ))}
          </ul>
        </CardBlock>
      )}
    </article>
  );
}
