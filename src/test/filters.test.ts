import { describe, expect, it } from 'vitest';
import {
  distinctValues,
  filterIncidents,
  filterItems,
  filterPRItems,
  matchesQuery,
  sortItems,
} from '@/lib/filters';
import { effectiveStatus } from '@/lib/dashboardRules';
import { NOW, daysAgo, makeIncident, makeNews, makePR } from '@/test/fixtures';

const settings = { dashboardQuietDays: 7, newItemHours: 48 };
const resolve = <T extends Parameters<typeof effectiveStatus>[0]>(item: T) =>
  effectiveStatus(item, settings, NOW);

/** 必須テスト 3: 状態フィルター */
describe('状態フィルター', () => {
  const items = [
    makeNews({ id: 'a', status: 'new', lastMaterialUpdateAt: daysAgo(0) }),
    makeNews({ id: 'b', status: 'attention', lastMaterialUpdateAt: daysAgo(1) }),
    makeNews({ id: 'c', status: 'follow_up', lastMaterialUpdateAt: daysAgo(2) }),
    makeNews({ id: 'd', status: 'resolved', lastMaterialUpdateAt: daysAgo(3) }),
    makeNews({ id: 'e', status: 'follow_up', lastMaterialUpdateAt: daysAgo(20) }),
  ];

  it('状態未指定なら全件返す', () => {
    const result = filterItems(items, { query: '', statuses: [], severities: [] }, resolve);
    expect(result).toHaveLength(5);
  });

  it('「要注視」で絞り込める', () => {
    const result = filterItems(items, { query: '', statuses: ['attention'], severities: [] }, resolve);
    expect(result.map((i) => i.id)).toEqual(['b']);
  });

  it('「続報待ち」は7日経過した案件を含まない（画面表示と一致する）', () => {
    const result = filterItems(items, { query: '', statuses: ['follow_up'], severities: [] }, resolve);
    expect(result.map((i) => i.id)).toEqual(['c']);
  });

  it('「沈静化」で7日経過した案件だけを取り出せる', () => {
    const result = filterItems(items, { query: '', statuses: ['quiet'], severities: [] }, resolve);
    expect(result.map((i) => i.id)).toEqual(['e']);
  });

  it('重要度で絞り込める', () => {
    const mixed = [
      makeNews({ id: 'high', severity: 'high' }),
      makeNews({ id: 'low', severity: 'low' }),
    ];
    const result = filterItems(mixed, { query: '', statuses: [], severities: ['low'] }, resolve);
    expect(result.map((i) => i.id)).toEqual(['low']);
  });
});

describe('キーワード検索', () => {
  const incident = makeIncident({
    title: '資格無効表示',
    entityName: '堺市',
    region: '大阪府',
    cause: '資格情報連携データの不備',
    tags: ['資格'],
  });

  it('自治体名で一致する', () => {
    expect(matchesQuery(incident, '堺市')).toBe(true);
  });

  it('原因テキストで一致する', () => {
    expect(matchesQuery(incident, '連携データ')).toBe(true);
  });

  it('複数語はAND条件になる', () => {
    expect(matchesQuery(incident, '堺市 資格')).toBe(true);
    expect(matchesQuery(incident, '堺市 サイバー')).toBe(false);
  });

  it('空文字は全件一致', () => {
    expect(matchesQuery(incident, '   ')).toBe(true);
  });
});

describe('不具合の追加フィルター', () => {
  const incidents = [
    makeIncident({ id: 'cyber', incidentCategory: 'medical_it_cyber', cyberAttack: true, region: '東京都' }),
    makeIncident({
      id: 'normal',
      incidentCategory: 'medical_it_cyber',
      cyberAttack: false,
      region: '大阪府',
      recoveryAt: daysAgo(1),
    }),
  ];
  const base = {
    category: 'medical_it_cyber' as const,
    query: '',
    statuses: [],
    severities: [],
    region: '',
    cyber: '' as const,
    recovery: '' as const,
  };

  it('サイバー攻撃のみに絞り込める', () => {
    expect(filterIncidents(incidents, { ...base, cyber: 'cyber' }, resolve).map((i) => i.id)).toEqual([
      'cyber',
    ]);
  });

  it('サイバー以外に絞り込める', () => {
    expect(
      filterIncidents(incidents, { ...base, cyber: 'non_cyber' }, resolve).map((i) => i.id),
    ).toEqual(['normal']);
  });

  it('地域で絞り込める', () => {
    expect(filterIncidents(incidents, { ...base, region: '東京都' }, resolve).map((i) => i.id)).toEqual([
      'cyber',
    ]);
  });

  it('復旧有無で絞り込める', () => {
    expect(
      filterIncidents(incidents, { ...base, recovery: 'recovered' }, resolve).map((i) => i.id),
    ).toEqual(['normal']);
  });

  it('カテゴリーが違う案件は返さない', () => {
    const local = makeIncident({ id: 'local', incidentCategory: 'local_government_insurer' });
    expect(filterIncidents([local, ...incidents], base, resolve).map((i) => i.id)).toEqual([
      'cyber',
      'normal',
    ]);
  });
});

describe('広報の追加フィルター', () => {
  const items = [
    makePR({ id: 'quiet', prClassification: 'active_stable', stableSubtype: 'quiet' }),
    makePR({ id: 'positive', prClassification: 'active_stable', stableSubtype: 'positive' }),
    makePR({ id: 'watch', prClassification: 'active_watch' }),
    makePR({
      id: 'fire',
      prClassification: 'reported_backlash',
      officialAction: '中止',
      ministry: '法務省',
    }),
  ];
  const base = {
    classification: '' as const,
    query: '',
    statuses: [],
    severities: [],
    ministry: '',
    stableSubtype: '' as const,
    officialAction: '' as const,
  };

  it('「反応未検知」だけを取り出せる', () => {
    expect(filterPRItems(items, { ...base, stableSubtype: 'quiet' }, resolve).map((i) => i.id)).toEqual([
      'quiet',
    ]);
  });

  it('「ポジティブ」だけを取り出せる', () => {
    expect(
      filterPRItems(items, { ...base, stableSubtype: 'positive' }, resolve).map((i) => i.id),
    ).toEqual(['positive']);
  });

  it('省庁で絞り込める', () => {
    expect(filterPRItems(items, { ...base, ministry: '法務省' }, resolve).map((i) => i.id)).toEqual([
      'fire',
    ]);
  });

  it('公式対応の有無で絞り込める', () => {
    expect(
      filterPRItems(items, { ...base, officialAction: 'acted' }, resolve).map((i) => i.id),
    ).toEqual(['fire']);
  });
});

describe('並び替え', () => {
  it('重要度順で並ぶ', () => {
    const items = [
      makeNews({ id: 'low', severity: 'low' }),
      makeNews({ id: 'high', severity: 'high' }),
      makeNews({ id: 'medium', severity: 'medium' }),
    ];
    expect(sortItems(items, 'severity').map((i) => i.id)).toEqual(['high', 'medium', 'low']);
  });

  it('最新更新順で並ぶ', () => {
    const items = [
      makeNews({ id: 'old', lastMaterialUpdateAt: daysAgo(5) }),
      makeNews({ id: 'new', lastMaterialUpdateAt: daysAgo(1) }),
    ];
    expect(sortItems(items, 'lastUpdate').map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('影響人数順で並び、未公表(null)は末尾になる', () => {
    const items = [
      makeIncident({ id: 'unknown', affectedCount: null }),
      makeIncident({ id: 'big', affectedCount: 5000 }),
      makeIncident({ id: 'small', affectedCount: 10 }),
    ];
    expect(sortItems(items, 'affected').map((i) => i.id)).toEqual(['big', 'small', 'unknown']);
  });

  it('元の配列を変更しない', () => {
    const items = [makeNews({ id: 'a', severity: 'low' }), makeNews({ id: 'b', severity: 'high' })];
    sortItems(items, 'severity');
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('distinctValues', () => {
  it('重複を除いて昇順で返す', () => {
    const incidents = [
      makeIncident({ region: '大阪府' }),
      makeIncident({ region: '東京都' }),
      makeIncident({ region: '大阪府' }),
      makeIncident({ region: undefined }),
    ];
    expect(distinctValues(incidents, (i) => i.region)).toHaveLength(2);
  });
});
