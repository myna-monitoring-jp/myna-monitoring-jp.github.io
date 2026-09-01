import { describe, expect, it } from 'vitest';
import { buildTeamsSummary, computeDashboardCounts } from '@/lib/teamsSummary';
import { NOW, daysAgo, makeDataset, makeIncident, makeNews, makePR } from '@/test/fixtures';

const SHARE_URL = 'https://example.internal/portal/#/';

/** 必須テスト 8: Teamsサマリ生成 */
describe('Teams投稿文の生成', () => {
  it('日付・状態・件名・共有URLを含む', () => {
    const dataset = makeDataset({
      dataset: 'live',
      news: [
        makeNews({ id: 'n1', title: '重要な要注視ニュース', status: 'attention' }),
        makeNews({ id: 'n2', title: '新着ニュース', status: 'new' }),
      ],
    });
    const text = buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL });

    expect(text).toContain('2026/09/01');
    expect(text).toContain('■要注視：重要な要注視ニュース');
    expect(text).toContain('■新着：新着ニュース');
    expect(text).toContain(SHARE_URL);
  });

  it('要注視を新着より先に並べる', () => {
    const dataset = makeDataset({
      dataset: 'live',
      news: [
        makeNews({ id: 'n1', title: '新着のほう', status: 'new' }),
        makeNews({ id: 'n2', title: '要注視のほう', status: 'attention' }),
      ],
    });
    const text = buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL });
    expect(text.indexOf('要注視のほう')).toBeLessThan(text.indexOf('新着のほう'));
  });

  it('7日ルールで外れた案件は含めない', () => {
    const dataset = makeDataset({
      dataset: 'live',
      news: [
        makeNews({ id: 'fresh', title: '掲載中の案件', lastMaterialUpdateAt: daysAgo(1) }),
        makeNews({ id: 'stale', title: '沈静化した案件', lastMaterialUpdateAt: daysAgo(20) }),
      ],
    });
    const text = buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL });
    expect(text).toContain('掲載中の案件');
    expect(text).not.toContain('沈静化した案件');
  });

  it('pinned な古い案件は含める', () => {
    const dataset = makeDataset({
      dataset: 'live',
      news: [makeNews({ id: 'p', title: 'ピン留め案件', pinned: true, lastMaterialUpdateAt: daysAgo(40) })],
    });
    expect(buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL })).toContain('ピン留め案件');
  });

  it('要注視の不具合を系統名つきで出す', () => {
    const dataset = makeDataset({
      dataset: 'live',
      incidents: [
        makeIncident({
          id: 'i1',
          incidentCategory: 'common_system',
          entityName: 'デジタル庁',
          title: 'API障害',
          status: 'attention',
        }),
      ],
    });
    const text = buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL });
    expect(text).toContain('■要注視（オン資・マイナポータル等）：デジタル庁｜API障害');
  });

  it('該当がない場合は「確認なし」と明示する', () => {
    const text = buildTeamsSummary({
      dataset: makeDataset({ dataset: 'live' }),
      now: NOW,
      shareUrl: SHARE_URL,
    });
    expect(text).toContain('■要注視の不具合：確認なし');
    expect(text).toContain('■広報・広告：報道化炎上／要注視ともに確認なし');
    expect(text).toContain('■トップニュース：ダッシュボード掲載中の新規案件なし');
  });

  it('サンプルデータの場合は共有しない旨を先頭に入れる', () => {
    const text = buildTeamsSummary({ dataset: makeDataset(), now: NOW, shareUrl: SHARE_URL });
    expect(text).toContain('サンプルデータでの出力です');
  });

  it('データ更新失敗時は最終正常更新時刻を含める', () => {
    const dataset = makeDataset({
      dataset: 'live',
      dataUpdate: { state: 'failed', lastSuccessfulUpdateAt: '2026-08-31T11:20:00+09:00' },
    });
    const text = buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL });
    expect(text).toContain('データ更新失敗');
    expect(text).toContain('2026/08/31 11:20 JST');
  });

  it('広報の炎上・要注視をキャンペーン名で出す', () => {
    const dataset = makeDataset({
      dataset: 'live',
      prItems: [
        makePR({ id: 'f', prClassification: 'reported_backlash', campaignName: '炎上案件' }),
        makePR({ id: 'w', prClassification: 'active_watch', campaignName: '要注視案件' }),
      ],
    });
    const text = buildTeamsSummary({ dataset, now: NOW, shareUrl: SHARE_URL });
    expect(text).toContain('■報道化炎上：炎上案件');
    expect(text).toContain('■掲載中・要注視の広報：要注視案件');
  });
});

describe('ダッシュボードKPI集計', () => {
  it('3カテゴリーそれぞれの掲載中件数を数える', () => {
    const dataset = makeDataset({
      incidents: [
        makeIncident({ id: '1', incidentCategory: 'local_government_insurer' }),
        makeIncident({ id: '2', incidentCategory: 'local_government_insurer' }),
        makeIncident({ id: '3', incidentCategory: 'common_system' }),
        makeIncident({ id: '4', incidentCategory: 'medical_it_cyber' }),
        makeIncident({
          id: '5',
          incidentCategory: 'medical_it_cyber',
          lastMaterialUpdateAt: daysAgo(30),
        }),
      ],
      prItems: [makePR({ id: 'w', prClassification: 'active_watch' })],
    });

    const counts = computeDashboardCounts(dataset, NOW);
    expect(counts.localGovernment).toBe(2);
    expect(counts.commonSystem).toBe(1);
    // 7日ルールで1件が外れる
    expect(counts.medicalItCyber).toBe(1);
    expect(counts.prWatch).toBe(1);
  });
});
