import { describe, expect, it } from 'vitest';
import { allCorrections, emptyDataset, normalizeDataset } from '@/data/normalize';

/** Data hardening: bad pipeline output must degrade, not crash. */
describe('データ正規化', () => {
  it('ルートが不正でも空データセットと失敗状態を返す', () => {
    const { dataset } = normalizeDataset('not an object');
    expect(dataset.news).toEqual([]);
    expect(dataset.dataUpdate.state).toBe('failed');
  });

  it('id や title を欠く案件は落として理由を報告する', () => {
    const { dataset, issues } = normalizeDataset({
      dataset: 'live',
      generatedAt: '2026-09-01T00:00:00+09:00',
      news: [{ title: 'idがない' }, { id: 'ok', title: '正常', lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00', sources: [] }],
    });
    expect(dataset.news.map((n) => n.id)).toEqual(['ok']);
    expect(issues.some((issue) => issue.message.includes('id または title'))).toBe(true);
  });

  it('無効なURLの出典は active:false にして注意を返す', () => {
    const { dataset, issues } = normalizeDataset({
      dataset: 'live',
      news: [
        {
          id: 'n',
          title: 't',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
          sources: [{ type: 'primary', label: '壊れたリンク', url: 'javascript:void(0)' }],
        },
      ],
    });
    expect(dataset.news[0].sources[0].active).toBe(false);
    expect(issues.some((issue) => issue.message.includes('壊れたリンク'))).toBe(true);
  });

  it('未知の status は「続報待ち」にフォールバックする', () => {
    const { dataset } = normalizeDataset({
      dataset: 'live',
      news: [{ id: 'n', title: 't', status: 'WATCH', lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00' }],
    });
    expect(dataset.news[0].status).toBe('follow_up');
  });

  it('active_stable に stableSubtype が無ければ quiet として扱い注意を出す', () => {
    const { dataset, issues } = normalizeDataset({
      dataset: 'live',
      prItems: [
        {
          id: 'p',
          title: 't',
          ministry: '省',
          campaignName: 'c',
          prClassification: 'active_stable',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
        },
      ],
    });
    expect(dataset.prItems[0].stableSubtype).toBe('quiet');
    expect(issues.some((issue) => issue.message.includes('反応未検知'))).toBe(true);
  });

  it('active_stable 以外では stableSubtype を落とす', () => {
    const { dataset } = normalizeDataset({
      dataset: 'live',
      prItems: [
        {
          id: 'p',
          title: 't',
          ministry: '省',
          campaignName: 'c',
          prClassification: 'active_watch',
          stableSubtype: 'positive',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
        },
      ],
    });
    expect(dataset.prItems[0].stableSubtype).toBeUndefined();
  });

  it('affectedCount の未指定は null（未公表）になり 0 と区別される', () => {
    const { dataset } = normalizeDataset({
      dataset: 'live',
      incidents: [
        {
          id: 'i1',
          title: 't',
          entityName: 'e',
          incidentCategory: 'common_system',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
        },
        {
          id: 'i2',
          title: 't',
          entityName: 'e',
          incidentCategory: 'common_system',
          affectedCount: 0,
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
        },
      ],
    });
    expect(dataset.incidents[0].affectedCount).toBeNull();
    expect(dataset.incidents[1].affectedCount).toBe(0);
  });

  it('旧サンプルの publicVoices.type を channel として受け付ける', () => {
    const { dataset } = normalizeDataset({
      dataset: 'live',
      news: [
        {
          id: 'n',
          title: 't',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
          publicVoices: [{ type: 'x', summary: '投稿', representative: true }],
        },
      ],
    });
    expect(dataset.news[0].publicVoices?.[0].channel).toBe('x');
  });

  it('不正な incidentCategory は自治体扱いにして注意を出す', () => {
    const { dataset, issues } = normalizeDataset({
      dataset: 'live',
      incidents: [
        {
          id: 'i',
          title: 't',
          entityName: 'e',
          incidentCategory: 'unknown_lane',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
        },
      ],
    });
    expect(dataset.incidents[0].incidentCategory).toBe('local_government_insurer');
    expect(issues.some((issue) => issue.message.includes('incidentCategory'))).toBe(true);
  });

  it('アーカイブ一覧を日付の新しい順に並べる', () => {
    const { dataset } = normalizeDataset({
      dataset: 'live',
      archive: [
        { date: '2026-08-26', title: 'a' },
        { date: '2026-08-31', title: 'b' },
      ],
    });
    expect(dataset.archive.map((a) => a.date)).toEqual(['2026-08-31', '2026-08-26']);
  });
});

describe('訂正履歴の集約', () => {
  it('データセット単位と案件単位を新しい順に統合する', () => {
    const dataset = emptyDataset({
      corrections: [{ correctedAt: '2026-08-29T00:00:00+09:00', reason: '古い訂正' }],
      news: [
        {
          id: 'n',
          title: 't',
          status: 'new',
          severity: 'high',
          lastMaterialUpdateAt: '2026-09-01T00:00:00+09:00',
          summary: '',
          sources: [],
          corrections: [{ correctedAt: '2026-08-31T00:00:00+09:00', reason: '新しい訂正' }],
        },
      ],
    });

    const corrections = allCorrections(dataset);
    expect(corrections.map((c) => c.reason)).toEqual(['新しい訂正', '古い訂正']);
    expect(corrections[0].itemId).toBe('n');
  });
});
