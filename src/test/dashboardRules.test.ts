import { describe, expect, it } from 'vitest';
import {
  decideDashboardVisibility,
  effectiveStatus,
  isNewlyDetected,
  isOnDashboard,
  selectDashboardItems,
  selectQuietedItems,
} from '@/lib/dashboardRules';
import { NOW, daysAgo, makeIncident, makeNews } from '@/test/fixtures';

const settings = { dashboardQuietDays: 7, newItemHours: 48 };

/** 必須テスト 1: 7日ルール / 必須テスト 2: pinned の表示継続 */
describe('7日ルール（N日ルール）', () => {
  it('最終重要更新から6日目はダッシュボードに残る', () => {
    const item = makeNews({ lastMaterialUpdateAt: daysAgo(6) });
    expect(isOnDashboard(item, settings, NOW)).toBe(true);
  });

  it('最終重要更新からちょうど7日でダッシュボードから外れる', () => {
    const item = makeNews({ lastMaterialUpdateAt: daysAgo(7) });
    const decision = decideDashboardVisibility(item, settings, NOW);
    expect(decision.visible).toBe(false);
    expect(decision.reason).toBe('quiet_period_elapsed');
    expect(decision.daysSinceMaterialUpdate).toBe(7);
  });

  it('8日以上経過した案件も外れる', () => {
    expect(isOnDashboard(makeNews({ lastMaterialUpdateAt: daysAgo(30) }), settings, NOW)).toBe(false);
  });

  it('基準日数は設定値で変更できる', () => {
    const item = makeNews({ lastMaterialUpdateAt: daysAgo(9) });
    expect(isOnDashboard(item, { dashboardQuietDays: 7 }, NOW)).toBe(false);
    expect(isOnDashboard(item, { dashboardQuietDays: 14 }, NOW)).toBe(true);
  });

  it('発生日ではなく lastMaterialUpdateAt を基準にする', () => {
    const item = makeNews({
      occurredAt: daysAgo(60),
      publishedAt: daysAgo(60),
      lastMaterialUpdateAt: daysAgo(1),
    });
    expect(isOnDashboard(item, settings, NOW)).toBe(true);
  });

  it('ダッシュボードから外れても一覧からは消えない（詳細・アーカイブに残る）', () => {
    const fresh = makeNews({ id: 'fresh', lastMaterialUpdateAt: daysAgo(1) });
    const stale = makeNews({ id: 'stale', lastMaterialUpdateAt: daysAgo(12) });
    const items = [fresh, stale];

    expect(selectDashboardItems(items, settings, NOW).map((i) => i.id)).toEqual(['fresh']);
    expect(selectQuietedItems(items, settings, NOW).map((i) => i.id)).toEqual(['stale']);
    expect(items).toHaveLength(2);
  });

  it('lastMaterialUpdateAt が未設定の案件は掲載せず理由を返す', () => {
    const item = makeNews({ lastMaterialUpdateAt: '' });
    const decision = decideDashboardVisibility(item, settings, NOW);
    expect(decision.visible).toBe(false);
    expect(decision.reason).toBe('missing_last_material_update');
  });

  it('編集者が手動で非表示にした案件は外れる', () => {
    const item = makeNews({ dashboardVisible: false, lastMaterialUpdateAt: daysAgo(0) });
    expect(decideDashboardVisibility(item, settings, NOW).reason).toBe('manually_hidden');
  });
});

describe('pinned による表示継続', () => {
  it('30日更新がなくても pinned なら表示を継続する', () => {
    const item = makeNews({ pinned: true, lastMaterialUpdateAt: daysAgo(30) });
    const decision = decideDashboardVisibility(item, settings, NOW);
    expect(decision.visible).toBe(true);
    expect(decision.reason).toBe('pinned');
  });

  it('pinned は dashboardVisible:false より優先される', () => {
    const item = makeNews({ pinned: true, dashboardVisible: false, lastMaterialUpdateAt: daysAgo(40) });
    expect(isOnDashboard(item, settings, NOW)).toBe(true);
  });

  it('pinned な案件は「沈静化」に書き換えられない', () => {
    const item = makeIncident({ pinned: true, status: 'attention', lastMaterialUpdateAt: daysAgo(20) });
    expect(effectiveStatus(item, settings, NOW)).toBe('attention');
  });
});

describe('表示上の状態', () => {
  it('7日経過した未解決案件は「沈静化」として表示する', () => {
    const item = makeNews({ status: 'follow_up', lastMaterialUpdateAt: daysAgo(8) });
    expect(effectiveStatus(item, settings, NOW)).toBe('quiet');
  });

  it('解消済・計画停止は7日経過しても書き換えない', () => {
    expect(
      effectiveStatus(makeNews({ status: 'resolved', lastMaterialUpdateAt: daysAgo(40) }), settings, NOW),
    ).toBe('resolved');
    expect(
      effectiveStatus(
        makeIncident({ status: 'planned_outage', lastMaterialUpdateAt: daysAgo(40) }),
        settings,
        NOW,
      ),
    ).toBe('planned_outage');
  });

  it('48時間以内の検知は「新着」判定になる', () => {
    expect(isNewlyDetected(makeNews({ detectedAt: daysAgo(1) }), settings, NOW)).toBe(true);
    expect(isNewlyDetected(makeNews({ detectedAt: daysAgo(3) }), settings, NOW)).toBe(false);
  });
});
