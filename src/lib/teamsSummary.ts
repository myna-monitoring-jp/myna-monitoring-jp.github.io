import type { Incident, MonitoringDataset, NewsItem, PRItem } from '@/types/monitoring';
import { effectiveStatus, selectDashboardItems } from '@/lib/dashboardRules';
import { formatDate, formatDateTime } from '@/lib/format';
import { INCIDENT_CATEGORY_META, statusLabel } from '@/lib/statusLabels';

/**
 * Builds the short Teams post text (要件 7).
 *
 * Kept as a pure function so it can be reused unchanged by a future
 * server-side workflow — see `src/integrations/notifier.ts`.
 */

export type ViewKey = 'dashboard' | 'news' | 'incidents' | 'pr' | 'archive';

const VIEW_TITLE: Record<ViewKey, string> = {
  dashboard: 'ダッシュボード',
  news: 'トップニュース・世論',
  incidents: '不具合・エラー詳細',
  pr: '広報・広告ウォッチ',
  archive: 'アーカイブ',
};

export interface TeamsSummaryOptions {
  dataset: MonitoringDataset;
  now: Date;
  /** Absolute URL that is put at the bottom of the post. */
  shareUrl: string;
  view?: ViewKey;
  /** Max number of bullets per section. Keeps the post short. */
  maxItemsPerSection?: number;
}

function bullet(status: string, title: string): string {
  return `■${status}：${title}`;
}

export function buildTeamsSummary(options: TeamsSummaryOptions): string {
  const { dataset, now, shareUrl, view = 'dashboard' } = options;
  const limit = options.maxItemsPerSection ?? 3;
  const { settings } = dataset;

  const lines: string[] = [];
  lines.push(
    `【${settings.organizationLabel ?? '行政・マイナ関連モニタリング'}｜${formatDate(dataset.reportDate)}】`,
  );

  if (dataset.dataset === 'sample') {
    lines.push('※サンプルデータでの出力です。本番共有には使用しないでください。');
  }
  if (dataset.dataUpdate.state !== 'ok') {
    lines.push(
      `※データ更新${dataset.dataUpdate.state === 'failed' ? '失敗' : '未完了'}。最終正常更新：${formatDateTime(
        dataset.dataUpdate.lastSuccessfulUpdateAt,
        '記録なし',
      )}`,
    );
  }

  // 解説記事・二次情報は監視対象の事象ではないためサマリに含めない
  const visibleNews = selectDashboardItems<NewsItem>(dataset.news, settings, now).filter(
    (item) => item.category !== 'commentary',
  );
  const visibleIncidents = selectDashboardItems<Incident>(dataset.incidents, settings, now);
  const visiblePr = selectDashboardItems<PRItem>(dataset.prItems, settings, now);

  const priority = (item: NewsItem | Incident | PRItem): number => {
    const status = effectiveStatus(item, settings, now);
    if (status === 'attention') return 0;
    if (status === 'new') return 1;
    if (status === 'follow_up') return 2;
    return 3;
  };

  const newsLines = [...visibleNews]
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, limit)
    .map((item) => bullet(statusLabel(effectiveStatus(item, settings, now)), item.title));

  if (newsLines.length > 0) {
    lines.push(...newsLines);
  } else {
    lines.push('■トップニュース：ダッシュボード掲載中の新規案件なし');
  }

  const attentionIncidents = visibleIncidents.filter(
    (incident) => effectiveStatus(incident, settings, now) === 'attention',
  );
  if (attentionIncidents.length > 0) {
    for (const incident of attentionIncidents.slice(0, limit)) {
      lines.push(
        `■要注視（${INCIDENT_CATEGORY_META[incident.incidentCategory].short}）：${incident.entityName}｜${incident.title}`,
      );
    }
  } else {
    lines.push('■要注視の不具合：確認なし');
  }

  const backlash = visiblePr.filter((item) => item.prClassification === 'reported_backlash');
  const prWatch = visiblePr.filter((item) => item.prClassification === 'active_watch');
  if (backlash.length > 0) {
    lines.push(`■報道化炎上：${backlash.map((item) => item.campaignName).join('、')}`);
  }
  if (prWatch.length > 0) {
    lines.push(`■掲載中・要注視の広報：${prWatch.map((item) => item.campaignName).join('、')}`);
  }
  if (backlash.length === 0 && prWatch.length === 0) {
    lines.push('■広報・広告：報道化炎上／要注視ともに確認なし');
  }

  lines.push(`■データ基準時刻：${formatDateTime(dataset.generatedAt)}`);
  lines.push(`詳細（${VIEW_TITLE[view]}）：${shareUrl}`);

  return lines.join('\n');
}

/** Counts rendered in the dashboard KPI strip. */
export interface DashboardCounts {
  news: number;
  localGovernment: number;
  commonSystem: number;
  medicalItCyber: number;
  prWatch: number;
}

export function computeDashboardCounts(dataset: MonitoringDataset, now: Date): DashboardCounts {
  const { settings } = dataset;
  const incidents = selectDashboardItems<Incident>(dataset.incidents, settings, now);
  const prItems = selectDashboardItems<PRItem>(dataset.prItems, settings, now);
  return {
    news: selectDashboardItems<NewsItem>(dataset.news, settings, now).filter(
      (item) => item.category !== 'commentary',
    ).length,
    localGovernment: incidents.filter((i) => i.incidentCategory === 'local_government_insurer').length,
    commonSystem: incidents.filter((i) => i.incidentCategory === 'common_system').length,
    medicalItCyber: incidents.filter((i) => i.incidentCategory === 'medical_it_cyber').length,
    prWatch: prItems.filter((i) => i.prClassification === 'active_watch').length,
  };
}
