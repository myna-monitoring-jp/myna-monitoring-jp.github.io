import type {
  Incident,
  MonitoringDataset,
  NewsItem,
  PRItem,
  Source,
} from '@/types/monitoring';
import { DEFAULT_SETTINGS } from '@/config/appConfig';

/**
 * Deterministic fixtures. `NOW` is fixed so the N-day rule is testable without
 * mocking the system clock.
 */

export const NOW = new Date('2026-09-01T11:25:00+09:00');

/** ISO string for `days` whole days before NOW. */
export function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export const PRIMARY_SOURCE: Source = {
  type: 'primary',
  label: 'デジタル庁',
  url: 'https://www.digital.go.jp/news/example',
  linkText: '一次情報を開く',
  active: true,
};

export const MEDIA_SOURCE: Source = {
  type: 'media',
  label: 'ITmedia NEWS',
  url: 'https://www.itmedia.co.jp/news/articles/example.html',
  linkText: '報道記事を開く',
  active: true,
};

export const SOCIAL_SOURCE: Source = {
  type: 'social',
  label: '代表投稿',
  url: 'https://x.com/example/status/1',
  active: true,
};

export function makeNews(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'news-1',
    title: 'テストニュース',
    category: 'policy',
    status: 'new',
    severity: 'high',
    lastMaterialUpdateAt: daysAgo(0),
    summary: 'テスト用の要約。',
    sources: [PRIMARY_SOURCE],
    publicVoices: [],
    factChecks: [],
    ...overrides,
  };
}

export function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'incident-1',
    title: 'テスト不具合',
    incidentCategory: 'local_government_insurer',
    entityName: 'テスト市',
    region: '東京都',
    status: 'attention',
    severity: 'high',
    lastMaterialUpdateAt: daysAgo(0),
    summary: 'テスト用の不具合。',
    affectedCount: 100,
    sources: [PRIMARY_SOURCE],
    cyberAttack: false,
    ...overrides,
  };
}

export function makePR(overrides: Partial<PRItem> = {}): PRItem {
  return {
    id: 'pr-1',
    title: 'テスト広報',
    ministry: '厚生労働省',
    campaignName: 'テストキャンペーン',
    prClassification: 'active_watch',
    status: 'attention',
    severity: 'medium',
    lastMaterialUpdateAt: daysAgo(0),
    summary: 'テスト用の広報案件。',
    sources: [PRIMARY_SOURCE],
    ...overrides,
  };
}

export function makeDataset(overrides: Partial<MonitoringDataset> = {}): MonitoringDataset {
  return {
    dataset: 'sample',
    generatedAt: NOW.toISOString(),
    reportDate: '2026-09-01',
    settings: { ...DEFAULT_SETTINGS },
    dataUpdate: { state: 'ok', lastSuccessfulUpdateAt: NOW.toISOString() },
    news: [],
    incidents: [],
    prItems: [],
    surveys: [],
    pulses: [],
    archive: [],
    timeline: [],
    corrections: [],
    ...overrides,
  };
}

/** A dataset that exercises every lane and both stable subtypes. */
export function makeFullDataset(): MonitoringDataset {
  return makeDataset({
    news: [
      makeNews({
        id: 'news-fresh',
        title: '本日の新着ニュース',
        lastMaterialUpdateAt: daysAgo(0),
        publicVoices: [
          {
            channel: 'x',
            sentiment: 'concern',
            summary: '観測された懸念の声。',
            representative: true,
            url: SOCIAL_SOURCE.url,
            repostCount: 100,
          },
        ],
        factChecks: [
          { claim: '誤解の例', assessment: 'misunderstanding', explanation: '説明文。' },
        ],
        communicationRisks: ['切り抜かれる可能性'],
        sources: [PRIMARY_SOURCE, MEDIA_SOURCE],
      }),
      makeNews({
        id: 'news-quiet',
        title: '沈静化したニュース',
        status: 'follow_up',
        lastMaterialUpdateAt: daysAgo(10),
      }),
      makeNews({
        id: 'news-pinned',
        title: 'ピン留めされた古いニュース',
        status: 'attention',
        pinned: true,
        lastMaterialUpdateAt: daysAgo(30),
      }),
    ],
    incidents: [
      makeIncident({ id: 'incident-local', incidentCategory: 'local_government_insurer' }),
      makeIncident({
        id: 'incident-system',
        incidentCategory: 'common_system',
        entityName: 'デジタル庁',
        systemName: 'マイナポータル',
        status: 'planned_outage',
        title: '計画メンテナンス',
        affectedCount: null,
      }),
      makeIncident({
        id: 'incident-cyber',
        incidentCategory: 'medical_it_cyber',
        entityName: 'テスト病院',
        cyberAttack: true,
        status: 'follow_up',
        title: 'ランサムウェア被害',
        sources: [MEDIA_SOURCE],
      }),
    ],
    prItems: [
      makePR({
        id: 'pr-backlash',
        prClassification: 'reported_backlash',
        status: 'resolved',
        campaignName: '炎上したタイアップ',
        officialAction: '中止',
        mediaPickupCount: 3,
      }),
      makePR({ id: 'pr-watch', prClassification: 'active_watch', campaignName: '掲載中の広告' }),
      makePR({
        id: 'pr-quiet',
        prClassification: 'active_stable',
        stableSubtype: 'quiet',
        status: 'follow_up',
        campaignName: '反応のない広報',
      }),
      makePR({
        id: 'pr-positive',
        prClassification: 'active_stable',
        stableSubtype: 'positive',
        status: 'attention',
        campaignName: '好評な広報',
        effectMetrics: [{ label: '参照数', value: 1000, unit: 'PV' }],
      }),
    ],
    pulses: [
      { id: 'pulse-1', title: '論点1', description: '説明', scaleNote: '1,000RP' },
    ],
    archive: [{ date: '2026-08-31', title: '朝レポート', dataPath: 'archive/2026-08-31.json' }],
    timeline: [{ date: '2026-08-24', title: 'タイアップ中止', description: '公式対応。' }],
    corrections: [
      {
        correctedAt: '2026-08-30T14:00:00+09:00',
        itemId: 'incident-local',
        field: 'affectedCount',
        before: '200人',
        after: '100人',
        reason: '重複計上を訂正。',
        editor: 'テスト担当',
      },
    ],
  });
}
