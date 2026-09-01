import type { AppSettings, BaseItem, Incident, PRItem } from '@/types/monitoring';
import { daysSinceMaterialUpdate, effectiveStatus } from '@/lib/dashboardRules';
import { formatShortDate } from '@/lib/format';

/**
 * 「発覚 → 対応 → 沈静化」の流れを1行に要約する。
 *
 * アーカイブのタイルで使う。案件を開かずに経過が分かることだけを狙い、
 * 詳細（原因・影響人数・国民の声）はカード側に任せる。
 */
export function describeLifecycle(
  item: BaseItem,
  settings: Pick<AppSettings, 'dashboardQuietDays'>,
  now: Date,
): string {
  const incident = item as Partial<Incident>;
  const pr = item as Partial<PRItem>;
  const steps: string[] = [];

  const detected = item.occurredAt ?? item.publishedAt ?? item.detectedAt;
  if (detected) steps.push(`${formatShortDate(detected)} 発覚`);

  // 発覚日と公表日が違う場合だけ公表を挟む
  if (item.publishedAt && item.occurredAt && item.publishedAt !== item.occurredAt) {
    steps.push(`${formatShortDate(item.publishedAt)} 公表`);
  }

  if (incident.recoveryAt) {
    steps.push(`${formatShortDate(incident.recoveryAt)} 復旧`);
  }
  if (pr.officialAction) {
    const date = pr.endAt ? formatShortDate(pr.endAt) : '';
    // officialAction 側に既に日付が入っている場合は前置きしない（「8/24 公式対応（8/24中止…）」を避ける）
    const prefix = date && !pr.officialAction.includes(date) ? `${date} ` : '';
    steps.push(`${prefix}公式対応（${pr.officialAction}）`);
  }

  const status = effectiveStatus(item, settings, now);
  const days = daysSinceMaterialUpdate(item, now);

  if (status === 'quiet' && days !== null) {
    steps.push(`${days}日間更新なしで沈静化`);
  } else if (status === 'resolved') {
    steps.push('解消済');
  } else if (status === 'archived') {
    steps.push('アーカイブ');
  } else if (status === 'planned_outage') {
    steps.push('計画停止');
  } else if (days !== null) {
    steps.push(`最終更新から${days}日`);
  }

  return steps.length > 0 ? steps.join(' → ') : '経過情報なし';
}
