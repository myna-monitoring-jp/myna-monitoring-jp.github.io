import { describe, expect, it } from 'vitest';
import { describeLifecycle } from '@/lib/lifecycle';
import { NOW, daysAgo, makeIncident, makeNews, makePR } from '@/test/fixtures';

const settings = { dashboardQuietDays: 7 };

/** アーカイブのタイルに出す「発覚 → 対応 → 沈静化」の1行要約 */
describe('ライフサイクル要約', () => {
  it('発覚・復旧・沈静化の流れを1行にまとめる', () => {
    const item = makeIncident({
      occurredAt: '2026-08-01T00:00:00+09:00',
      recoveryAt: '2026-08-07T00:00:00+09:00',
      status: 'follow_up',
      lastMaterialUpdateAt: daysAgo(9),
    });

    const text = describeLifecycle(item, settings, NOW);
    expect(text).toContain('8/1 発覚');
    expect(text).toContain('8/7 復旧');
    expect(text).toContain('9日間更新なしで沈静化');
    expect(text.split(' → ')).toHaveLength(3);
  });

  it('発覚日と公表日が違う場合は公表を挟む', () => {
    const item = makeIncident({
      occurredAt: '2026-08-12T00:00:00+09:00',
      publishedAt: '2026-08-14T00:00:00+09:00',
      status: 'follow_up',
      lastMaterialUpdateAt: daysAgo(10),
    });
    const text = describeLifecycle(item, settings, NOW);
    expect(text).toContain('8/12 発覚');
    expect(text).toContain('8/14 公表');
  });

  it('発覚日と公表日が同じ場合は公表を重複表示しない', () => {
    const item = makeIncident({
      occurredAt: '2026-08-12T00:00:00+09:00',
      publishedAt: '2026-08-12T00:00:00+09:00',
      lastMaterialUpdateAt: daysAgo(10),
    });
    expect(describeLifecycle(item, settings, NOW)).not.toContain('公表');
  });

  it('広報案件は公式対応を載せる', () => {
    const item = makePR({
      startAt: '2026-08-01',
      endAt: '2026-08-24',
      publishedAt: '2026-08-01T00:00:00+09:00',
      officialAction: '中止、ポスター回収',
      status: 'resolved',
      lastMaterialUpdateAt: daysAgo(8),
    });
    const text = describeLifecycle(item, settings, NOW);
    expect(text).toContain('8/24 公式対応（中止、ポスター回収）');
    expect(text).toContain('解消済');
  });

  it('公式対応の文面に日付が入っている場合は日付を前置きしない', () => {
    const item = makePR({
      endAt: '2026-08-24',
      officialAction: '8/24中止、ポスター回収',
      status: 'resolved',
      lastMaterialUpdateAt: daysAgo(8),
    });
    const text = describeLifecycle(item, settings, NOW);
    expect(text).toContain('公式対応（8/24中止、ポスター回収）');
    expect(text).not.toContain('8/24 公式対応');
  });

  it('解消済は日数ではなく「解消済」と出す', () => {
    const item = makeIncident({ status: 'resolved', lastMaterialUpdateAt: daysAgo(30) });
    const text = describeLifecycle(item, settings, NOW);
    expect(text).toContain('解消済');
    expect(text).not.toContain('沈静化');
  });

  it('計画停止はそのまま表示する', () => {
    const item = makeIncident({ status: 'planned_outage', lastMaterialUpdateAt: daysAgo(30) });
    expect(describeLifecycle(item, settings, NOW)).toContain('計画停止');
  });

  it('日付が無い案件でも壊れない', () => {
    const item = makeNews({
      occurredAt: undefined,
      publishedAt: undefined,
      detectedAt: undefined,
      status: 'follow_up',
      lastMaterialUpdateAt: daysAgo(12),
    });
    const text = describeLifecycle(item, settings, NOW);
    expect(text).toContain('12日間更新なしで沈静化');
  });

  it('最終重要更新が未設定でも例外を投げない', () => {
    const item = makeNews({
      occurredAt: undefined,
      publishedAt: undefined,
      detectedAt: undefined,
      lastMaterialUpdateAt: '',
    });
    expect(() => describeLifecycle(item, settings, NOW)).not.toThrow();
    expect(describeLifecycle(item, settings, NOW)).toBe('経過情報なし');
  });
});
