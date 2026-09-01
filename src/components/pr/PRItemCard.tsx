import type { AppSettings, PRItem } from '@/types/monitoring';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Tag } from '@/components/common/Primitives';
import { SourceList } from '@/components/common/ExternalLinkButton';
import { PublicVoiceList } from '@/components/news/PublicVoiceList';
import { effectiveStatus } from '@/lib/dashboardRules';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { PR_CLASSIFICATION_META, STABLE_SUBTYPE_META } from '@/lib/statusLabels';

interface PRItemCardProps {
  item: PRItem;
  settings: AppSettings;
  now: Date;
  /** Dashboard uses the short form; the PR page shows everything. */
  detailed?: boolean;
}

/**
 * A PR / advertising record.
 *
 * For `active_stable`, the `stableSubtype` badge is mandatory so
 * 「炎上していないだけ」(反応未検知) is never read as 「ポジティブ」 (受入条件 9).
 */
export function PRItemCard({ item, settings, now, detailed = false }: PRItemCardProps) {
  const tone = PR_CLASSIFICATION_META[item.prClassification].tone;
  const status = effectiveStatus(item, settings, now);
  const stable = item.prClassification === 'active_stable' ? item.stableSubtype ?? 'quiet' : null;
  const period = [item.startAt ? formatDate(item.startAt) : null, item.endAt ? formatDate(item.endAt) : '掲載中']
    .filter(Boolean)
    .join(' 〜 ');

  return (
    <article
      className={`pr-item ${tone}`}
      data-testid="pr-item"
      data-classification={item.prClassification}
      data-stable-subtype={stable ?? ''}
      data-item-id={item.id}
    >
      <h4>
        {item.ministry}｜{item.campaignName}
      </h4>

      <ul className="tagrow">
        <li>
          <StatusBadge status={status} withDescription />
        </li>
        {stable && (
          <li>
            <Tag tone={STABLE_SUBTYPE_META[stable].tone === 'green' ? 'green' : 'gray'}>
              {STABLE_SUBTYPE_META[stable].label}
            </Tag>
          </li>
        )}
        {(item.riskFactors ?? []).map((risk) => (
          <li key={risk}>
            <Tag tone="red">{risk}</Tag>
          </li>
        ))}
      </ul>

      <p className="note">{period || '掲載期間未記載'}</p>
      <p>{item.summary}</p>

      {item.message && (
        <p>
          <b>訴求メッセージ：</b>「{item.message}」
        </p>
      )}
      {item.officialAction && (
        <p>
          <b>公式対応：</b>
          {item.officialAction}
        </p>
      )}
      {item.mediaPickupCount !== undefined && (
        <p>
          <b>報道化：</b>独立媒体 {formatNumber(item.mediaPickupCount)}件（同一系列の転載は重複計上しません）
        </p>
      )}

      {detailed && (
        <>
          {(item.effectMetrics?.length ?? 0) > 0 && (
            <>
              <p>
                <b>効果指標：</b>
              </p>
              <ul className="metric-list">
                {item.effectMetrics!.map((metric, index) => (
                  <li className="metric" key={`${metric.label}-${index}`}>
                    {metric.label}：<b>{metric.value}{metric.unit ?? ''}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="card-block">
            <h4>国民の声・現場の声</h4>
            <PublicVoiceList voices={item.publicVoices} communicationRisks={item.communicationRisks} />
          </div>
        </>
      )}

      <SourceList sources={item.sources} />

      <p className="note">
        前日差分：{item.dailyDiff ?? '前日から変化なし'} ／ 最終重要更新：
        {formatDateTime(item.lastMaterialUpdateAt, '未設定')}
      </p>
    </article>
  );
}
