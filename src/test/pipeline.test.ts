// @vitest-environment node
// ファイルI/OとHTTPを扱うため node 環境で実行する。
import { describe, expect, it } from 'vitest';

import { classifySource, isIndependentOutlet, syndicationGroupOf, matchesDomainPattern } from '../pipeline/config.mjs';
import { buildQueries, fillTemplate, googleNewsUrl } from '../pipeline/discover.mjs';
import { extractBody, extractDates, parseJapaneseDate, parseRobots, decodeEntities } from '../pipeline/fetch.mjs';
import {
  detectEventClass,
  detectSystemLayer,
  extractCounts,
  extractOccurredAt,
  extractOfficialDenials,
  detectRecoveryStatus,
  isInScope,
} from '../pipeline/extract.mjs';
import { canonicalKeyOf, clusterEvents, countMedia, similarity } from '../pipeline/cluster.mjs';
import { findPrimarySources, resolveAffectedCount, collectUnknowns, needsReview } from '../pipeline/verify.mjs';
import { calculateImpactScore, calculateAttentionScore, recognizeBacklash, severityFromImpact } from '../pipeline/score.mjs';
import { classifyDelta, classifyStatus, detectMaterialChanges, indexPrevious, applyDiff, DELTA } from '../pipeline/diff.mjs';
import { loadManualVoices, NO_REACTION_TEXT } from '../pipeline/reaction.mjs';
import { polarityOf, displayRank, buildSources, buildOverallSummary } from '../pipeline/compose.mjs';
import { runQa, checkHtml, weekdayOf } from '../pipeline/qa.mjs';
import { renderDailyReport, externalLink, escapeHtml } from '../pipeline/render-report.mjs';

/**
 * 調査パイプラインのテスト。
 *
 * `docs/spec/CLAUDE_CODE_UPGRADE_PROMPT.md` §テスト の15項目に対応させている。
 * 各工程は独立して呼べるので、外部ネットワークには出ない。
 */

const REGISTRY = {
  fetchable_feeds: [{ id: 'da', url: 'https://www.digital.go.jp/rss/news.xml', publisher: 'デジタル庁', tier: 0 }],
  source_tiers: {
    tier_0_primary: {
      domains: {
        digital: { domain: 'digital.go.jp', categories: ['policy'] },
        mhlw: { domain: 'mhlw.go.jp', categories: ['myna_insurance'] },
        lg: { domain_pattern: '*.lg.jp', categories: ['local_incident'] },
        muni: { domain_patterns: ['city.*.jp', 'pref.*.jp'], categories: ['local_incident'] },
      },
    },
    tier_1_major_media: { domains: ['nhk.or.jp', 'asahi.com', 'yomiuri.co.jp', 'fnn.jp', 'kyodonews.jp'] },
    tier_2_specialist: { domains: ['itmedia.co.jp', 'scan.netsecurity.ne.jp'] },
    tier_3_reaction: { domains: ['x.com', 'news.yahoo.co.jp', 'apps.apple.com'] },
  },
};

const CONFIG = {
  dashboard: { quiet_days: 7, new_item_hours: 48 },
  research: { primary_source_required_impact: 60 },
  extract: { primary_window_hours: 24 },
  scoring: {
    impact_weights: { scope: 25, essentiality: 20, data_sensitivity: 20, duration: 15, affected_count: 10, official_escalation: 10 },
    attention_weights: { independent_media: 25, major_media: 20, social_volume: 25, official_response: 15, growth_rate: 15 },
  },
  retention: { archive_days: 400 },
};

const NOW = '2026-09-07T00:00:00.000Z';

const record = (over: Record<string, unknown> = {}) => ({
  url: 'https://www.asahi.com/a',
  finalUrl: 'https://www.asahi.com/a',
  canonicalUrl: 'https://www.asahi.com/a',
  publisherUrl: 'https://www.asahi.com',
  title: 'テスト記事',
  publisher: '朝日新聞',
  tier: 1,
  sourceType: 'major_media',
  official: false,
  occurredAt: null,
  publishedAt: '2026-09-06T23:00:00.000Z',
  updatedAt: null,
  detectedAt: NOW,
  entity: null,
  systemLayer: null,
  eventClass: 'outage',
  domain: 'online_eligibility',
  recoveryStatus: 'unknown',
  counts: [],
  officialDenials: [],
  excerpt: '',
  bodyLength: 0,
  usableForFacts: true,
  unusableReason: null,
  discoveredBy: null,
  ...over,
});

/* ------------------------------------------------------------------ 1 --- */

describe('1. 時間窓（24h / 72h / 前日クローズ）', () => {
  it('広域発見は24時間と72時間の2本を組む', () => {
    const catalog = {
      windows: { primary_hours: 24, backfill_hours: 72, trend_days: 7 },
      query_groups: { broad_discovery: { queries: ['"マイナ保険証" 最新'] } },
      common_terms: { systems: ['マイナ保険証'] },
    };
    const purposes = buildQueries(catalog, { events: [] }).map((entry) => entry.purpose);
    expect(purposes).toContain('broad_discovery_24h');
    expect(purposes).toContain('broad_discovery_72h');
  });

  it('前日の要注視・続報待ちにはクローズ確認のクエリを必ず立てる', () => {
    const catalog = {
      windows: { primary_hours: 24, backfill_hours: 72, trend_days: 7 },
      query_groups: { follow_up: { templates: ['"{event_name}" 復旧'] } },
      common_terms: { systems: [] },
    };
    const previous = {
      events: [
        { id: 'e1', title: '堺市の資格無効表示', status: 'attention' },
        { id: 'e2', title: '沈静化した案件', status: 'quiet' },
      ],
    };
    const queries = buildQueries(catalog, previous);
    expect(queries.map((q) => q.query)).toContain('"堺市の資格無効表示" 復旧');
    // 沈静化した案件は追跡しない
    expect(queries.map((q) => q.query)).not.toContain('"沈静化した案件" 復旧');
  });

  it('時間窓を検索クエリへ反映する', () => {
    expect(googleNewsUrl('マイナ', 24)).toContain(encodeURIComponent('when:24h'));
    expect(googleNewsUrl('マイナ', 168)).toContain(encodeURIComponent('when:7d'));
  });

  it('埋まらないテンプレートは捨てる（空の検索を投げない）', () => {
    expect(fillTemplate('"{campaign_name}" 批判', { campaign_name: 'マイナ救急' })).toBe('"マイナ救急" 批判');
    expect(fillTemplate('"{campaign_copy}"', { campaign_name: 'x' })).toBeNull();
  });
});

/* ------------------------------------------------------------------ 2,3 - */

describe('2. 事象クラスタリング / 3. 系列転載の除外', () => {
  it('主体・種別・発生日・システム層で同一事象キーを作る', () => {
    const key = canonicalKeyOf(
      record({ entity: '堺市', eventClass: 'outage', occurredAt: '2026-08-01T00:00:00Z', systemLayer: 'オンライン資格確認' }),
    );
    expect(key).toContain('堺市');
    expect(key).toContain('outage');
    expect(key).toContain('2026-08-01');
  });

  it('同じ事象の初報・続報・転載を1事象へまとめる', () => {
    const records = [
      record({ entity: '堺市', occurredAt: '2026-08-01T00:00:00Z', systemLayer: 'オンライン資格確認', url: 'https://www.asahi.com/1', publisherUrl: 'https://www.asahi.com' }),
      record({ entity: '堺市', occurredAt: '2026-08-01T00:00:00Z', systemLayer: 'オンライン資格確認', url: 'https://news.yahoo.co.jp/1', publisherUrl: 'https://news.yahoo.co.jp' }),
      record({ entity: '堺市', occurredAt: '2026-08-01T00:00:00Z', systemLayer: 'オンライン資格確認', url: 'https://www.yomiuri.co.jp/1', publisherUrl: 'https://www.yomiuri.co.jp' }),
    ];
    const clusters = clusterEvents(records, { registry: REGISTRY });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].rawArticleCount).toBe(3);
  });

  it('Yahoo!転載・通信社配信を独立媒体に数えない', () => {
    expect(isIndependentOutlet(REGISTRY, 'https://www.asahi.com/a')).toBe(true);
    expect(isIndependentOutlet(REGISTRY, 'https://news.yahoo.co.jp/a')).toBe(false);
    expect(isIndependentOutlet(REGISTRY, 'https://www.kyodonews.jp/a')).toBe(false);
    expect(isIndependentOutlet(REGISTRY, 'https://prtimes.jp/a')).toBe(false);
    // 公式発表は一次情報として数え、媒体数には入れない
    expect(isIndependentOutlet(REGISTRY, 'https://www.digital.go.jp/a')).toBe(false);
  });

  it('系列内の同一原稿は1媒体として数える', () => {
    expect(syndicationGroupOf('https://www.fnn.jp/a')).toBe('fnn');
    expect(syndicationGroupOf('https://www.ktv.jp/a')).toBe('fnn');
    const counted = countMedia(
      [
        record({ publisherUrl: 'https://www.fnn.jp' }),
        record({ publisherUrl: 'https://www.ktv.jp' }),
        record({ publisherUrl: 'https://www.asahi.com' }),
      ],
      REGISTRY,
    );
    // FNN系列2件は1つに畳まれ、朝日と合わせて2媒体
    expect(counted.independentMediaCount).toBe(2);
    expect(counted.syndicatedCount).toBe(1);
    expect(counted.rawArticleCount).toBe(3);
  });

  it('ニュース規模には生の記事数を使わない（独立媒体数と別に持つ）', () => {
    const counted = countMedia(
      [record({ publisherUrl: 'https://news.yahoo.co.jp' }), record({ publisherUrl: 'https://news.yahoo.co.jp' })],
      REGISTRY,
    );
    expect(counted.rawArticleCount).toBe(2);
    expect(counted.independentMediaCount).toBe(0);
  });

  it('タイトル類似度で発生日不明の記事も統合できる', () => {
    expect(similarity('マイナ保険証で資格無効表示', 'マイナ保険証で資格が無効と表示')).toBeGreaterThan(0.6);
    expect(similarity('マイナ保険証の障害', '電子処方箋の仕様変更')).toBeLessThan(0.3);
  });

  it('自治体ドメインのワイルドカードを引き当てる', () => {
    expect(matchesDomainPattern('city.osaka-izumi.lg.jp', '*.lg.jp')).toBe(true);
    expect(matchesDomainPattern('city.tokorozawa.saitama.jp', 'city.*.jp')).toBe(true);
    expect(classifySource(REGISTRY, 'https://city.tokorozawa.saitama.jp/a').official).toBe(true);
  });
});

/* ------------------------------------------------------------------ 4 --- */

describe('4. 一次情報必須ルール', () => {
  it('本文を確認できた公式ソースがあるときだけ一次情報ありとする', () => {
    const withBody = findPrimarySources({
      records: [record({ official: true, usableForFacts: true })],
    });
    expect(withBody.primarySourceConfirmed).toBe(true);

    const urlOnly = findPrimarySources({
      records: [record({ official: true, usableForFacts: false, unusableReason: 'pdf' })],
    });
    expect(urlOnly.primarySourceConfirmed).toBe(false);
    expect(urlOnly.primarySourceUrlOnly).toBe(true);
  });

  it('影響人数は公式値を優先し、報道のみなら報道値として印を付ける', () => {
    const cluster = {
      records: [
        record({ official: false, counts: [{ value: 5000, unit: '人', qualifier: 'exact', context: '報道' }] }),
        record({ official: true, counts: [{ value: 210, unit: '人', qualifier: 'exact', context: '公式' }] }),
      ],
    };
    const primary = findPrimarySources(cluster);
    const resolved = resolveAffectedCount(cluster, primary);
    expect(resolved.affectedCount).toBe(210);
    expect(resolved.affectedCountQualifier).toBe('exact');
    // 公式と報道が食い違うので確定扱いにしない
    expect(resolved.conflict).not.toBeNull();
  });

  it('公式に値が無く報道のみなら「報道によると」を立てる', () => {
    const cluster = { records: [record({ official: false, counts: [{ value: 300, unit: '件', qualifier: 'exact', context: '' }] })] };
    const resolved = resolveAffectedCount(cluster, findPrimarySources(cluster));
    expect(resolved.affectedCountQualifier).toBe('reported');
  });

  it('どこにも値が無ければ推測せず未公表にする', () => {
    const cluster = { records: [record({ counts: [] })] };
    const resolved = resolveAffectedCount(cluster, findPrimarySources(cluster));
    expect(resolved.affectedCount).toBeNull();
    expect(resolved.affectedCountNote).toContain('未公表');
  });

  it('一次情報が無い高影響案件はレビュー必須にする', () => {
    const reasons = needsReview({ impactScore: 75, primarySourceConfirmed: false, eventClass: 'outage' }, { config: CONFIG });
    expect(reasons.some((reason) => reason.includes('一次情報'))).toBe(true);
  });

  it('「公式終了発表がない」だけで障害継続と断定しない', () => {
    const unknowns = collectUnknowns(
      { eventClass: 'outage', occurredAt: NOW, records: [record({ recoveryStatus: 'unknown' })] },
      { primarySourceConfirmed: true, primarySourceUrlOnly: false, primaryRecords: [] },
      { affectedCount: null, conflict: null },
    );
    // 「継続中」ではなく「確認できていない」と記録する
    expect(unknowns.some((note) => note.includes('復旧の公式確認は取れていない'))).toBe(true);
    expect(unknowns.join('')).not.toContain('継続中');
  });
});

/* ------------------------------------------------------------------ 5 --- */

describe('5. 既存批判とキャンペーン反応の分離', () => {
  it('広報起点の反応が無ければ、既存批判だけでは炎上認定しない', () => {
    const events = [
      {
        id: 'e1',
        eventClass: 'public_communication',
        backlashRecognized: true,
        existingCriticismCount: 12,
        campaignReactionCount: 0,
        title: '公金受取口座の新聞広告',
        summary: '',
        sources: [{ url: 'https://www.gov-online.go.jp/a' }],
        publicVoices: [],
        detectedAt: NOW,
        lastMaterialUpdateAt: NOW,
      },
    ];
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events,
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('既存批判のみで炎上認定'))).toBe(true);
  });
});

/* ---------------------------------------------------------------- 6,7 --- */

describe('6. 7日沈静化ルール / 7. pinned例外', () => {
  it('最終重要更新から7日で沈静化にする', () => {
    const old = '2026-08-25T00:00:00.000Z';
    expect(
      classifyStatus({ lastMaterialUpdateAt: old, detectedAt: old, eventClass: 'outage', recoveryStatus: 'unknown' }, null, {
        nowIso: NOW,
        config: CONFIG,
      }),
    ).toBe('quiet');
  });

  it('重要更新が7日以内なら沈静化させない', () => {
    const recent = '2026-09-05T00:00:00.000Z';
    expect(
      classifyStatus({ lastMaterialUpdateAt: recent, detectedAt: recent, eventClass: 'outage', recoveryStatus: 'unknown', impactScore: 10 }, { status: 'follow_up' }, {
        nowIso: NOW,
        config: CONFIG,
      }),
    ).toBe('follow_up');
  });

  it('pinned=true は検索に出なくても沈静化させない', () => {
    const old = '2026-08-01T00:00:00.000Z';
    const index = indexPrevious({
      events: [{ canonicalKey: 'k1', id: 'e1', status: 'attention', pinned: true, lastMaterialUpdateAt: old, detectedAt: old }],
    });
    const carried = require('../pipeline/diff.mjs').carryForward(index, new Set(), { nowIso: NOW, config: CONFIG });
    expect(carried[0].status).toBe('attention');
  });

  it('重要更新が無い日は lastMaterialUpdateAt を進めない（起算点を壊さない）', () => {
    const before = { canonicalKey: 'k1', id: 'e1', lastMaterialUpdateAt: '2026-09-01T00:00:00.000Z', independentMediaCount: 2, impactScore: 30, recoveryStatus: 'unknown', affectedCount: null, status: 'follow_up', detectedAt: '2026-09-01T00:00:00.000Z' };
    const index = indexPrevious({ events: [before] });
    const applied = applyDiff(
      { canonicalKey: 'k1', independentMediaCount: 2, impactScore: 30, recoveryStatus: 'unknown', affectedCount: null, detectedAt: NOW, eventClass: 'outage' },
      index,
      { nowIso: NOW, config: CONFIG },
    );
    expect(applied.deltaStatus).toBe(DELTA.UNCHANGED);
    expect(applied.lastMaterialUpdateAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('独立媒体が増えた日は重要更新として起算点を進める', () => {
    const before = { canonicalKey: 'k1', id: 'e1', lastMaterialUpdateAt: '2026-09-01T00:00:00.000Z', independentMediaCount: 1, impactScore: 30, recoveryStatus: 'unknown', affectedCount: null, status: 'follow_up', detectedAt: '2026-09-01T00:00:00.000Z' };
    const changes = detectMaterialChanges({ independentMediaCount: 3, impactScore: 30, recoveryStatus: 'unknown', affectedCount: null }, before);
    expect(changes.some((change) => change.field === 'independentMediaCount')).toBe(true);
  });

  it('24時間より古い初検知は「追補」にする（本日発生と混同しない）', () => {
    const delta = classifyDelta({ publishedAt: '2026-08-20T00:00:00.000Z', detectedAt: NOW }, null, { nowIso: NOW, primaryWindowHours: 24 });
    expect(delta).toBe(DELTA.BACKFILL);
  });
});

/* ------------------------------------------------------------------ 8 --- */

describe('8. 影響度と話題度の別計算', () => {
  it('影響は重大だが話題が小さい事案を区別できる', () => {
    const event = {
      title: '全国の医療機関でオンライン資格確認が停止。受診できない事例',
      records: [record({ excerpt: '全国の医療機関で受診できない事象が数日にわたり継続しています。' })],
      affectedCount: 200000,
      affectedCountQualifier: 'exact',
      recoveryStatus: 'ongoing_stated',
      independentMediaCount: 0,
      majorMediaCount: 0,
      publicVoices: [],
    };
    const impact = calculateImpactScore(event, { config: CONFIG });
    const attention = calculateAttentionScore({ ...event, ...impact }, { config: CONFIG, previous: { byKey: new Map() } });
    expect(impact.impactScore).toBeGreaterThan(60);
    expect(attention.attentionScore).toBeLessThan(20);
  });

  it('話題は大きいが実害が限定的な広報炎上を区別できる', () => {
    const event = {
      title: '政府広報の動画に批判、公式が謝罪して削除しました',
      records: [record({ excerpt: '政府広報の動画に批判が集まり、公式が謝罪しました。削除しました。' })],
      affectedCount: null,
      eventClass: 'public_communication',
      independentMediaCount: 6,
      majorMediaCount: 4,
      publicVoices: [{ repostCount: 9000, replyCount: 2000, observedAt: NOW, representativeOfPopulation: false }],
    };
    const impact = calculateImpactScore(event, { config: CONFIG });
    const attention = calculateAttentionScore({ ...event, ...impact }, { config: CONFIG, previous: { byKey: new Map() } });
    expect(attention.attentionScore).toBeGreaterThan(60);
    expect(impact.impactScore).toBeLessThan(40);
  });

  it('取得できていない反応数で加点しない', () => {
    const attention = calculateAttentionScore(
      { independentMediaCount: 0, majorMediaCount: 0, publicVoices: [], records: [], title: '' },
      { config: CONFIG, previous: { byKey: new Map() } },
    );
    expect(attention.attentionBreakdown.socialVolume).toBe(0);
  });

  it('報道値・可能性の人数は割り引いて加点する', () => {
    const base = { title: '', records: [record({ excerpt: '' })], recoveryStatus: 'unknown' };
    const exact = calculateImpactScore({ ...base, affectedCount: 100000, affectedCountQualifier: 'exact' }, { config: CONFIG });
    const possible = calculateImpactScore({ ...base, affectedCount: 100000, affectedCountQualifier: 'possible' }, { config: CONFIG });
    expect(possible.impactBreakdown.affectedCount).toBeLessThan(exact.impactBreakdown.affectedCount);
  });

  it('影響度から重要度ラベルへ変換する', () => {
    expect(severityFromImpact(85)).toBe('critical');
    expect(severityFromImpact(65)).toBe('high');
    expect(severityFromImpact(45)).toBe('medium');
    expect(severityFromImpact(10)).toBe('reference');
  });

  it('批判の存在だけでは炎上認定しない', () => {
    const weak = recognizeBacklash({ title: '批判の声', records: [record({ excerpt: '批判があります' })], majorMediaCount: 0, independentMediaCount: 1, socialVolumeObserved: 0, syndicatedCount: 0 });
    expect(weak.backlashRecognized).toBe(false);

    const strong = recognizeBacklash({
      title: '公式が謝罪',
      records: [record({ excerpt: '公式が謝罪しました。削除しました。' })],
      majorMediaCount: 2,
      independentMediaCount: 4,
      socialVolumeObserved: 5000,
      syndicatedCount: 4,
    });
    expect(strong.backlashRecognized).toBe(true);
    expect(strong.backlashSignals.length).toBeGreaterThanOrEqual(2);
  });
});

/* ---------------------------------------------------------------- 9,10 -- */

describe('9. 計画停止と障害の分離 / 10. システム層の分離', () => {
  it('計画メンテナンスを障害と判定しない', () => {
    expect(detectEventClass('計画メンテナンスのお知らせ。以下の時間は利用できません。')).toBe('planned_maintenance');
    expect(detectEventClass('システム障害が発生し、利用できない状態です')).toBe('outage');
  });

  it('窓口混雑をシステム障害と判定しない', () => {
    expect(detectEventClass('電子証明書の更新窓口が混雑しています。待ち時間が発生しています。')).toBe('operational_load');
  });

  it('セキュリティ事案を障害と混同しない', () => {
    expect(detectEventClass('不正アクセスにより個人情報が漏えいした可能性があります')).toBe('security_incident');
  });

  it('マイナアプリとオンライン資格確認を別レイヤーとして判定する', () => {
    expect(detectSystemLayer('マイナアプリでログインできない')).toBe('マイナアプリ');
    expect(detectSystemLayer('オンライン資格確認が停止')).toBe('オンライン資格確認');
    expect(detectSystemLayer('自己情報取得APIが利用できない')).toBe('マイナポータルAPI（自己情報取得）');
    expect(detectSystemLayer('医療保険情報取得APIの制限')).toBe('医療保険情報取得API');
    expect(detectSystemLayer('PMH情報連携の障害')).toBe('PMH情報連携API');
    expect(detectSystemLayer('旅券オンライン申請の停止')).toBe('パスポートオンライン申請');
  });

  it('マイナ無関係の広報を対象外にする', () => {
    expect(isInScope({ title: '「はたちの献血」キャンペーンのキャッチフレーズ', excerpt: '', eventClass: 'public_communication', domain: 'public_relations' })).toBe(false);
    expect(isInScope({ title: 'マイナ救急の新聞広告を開始', excerpt: '', eventClass: 'public_communication', domain: 'public_relations' })).toBe(true);
  });

  it('医療機関のセキュリティ事案はマイナ語が無くても対象にする', () => {
    expect(isInScope({ title: '市立病院がランサムウェア被害', excerpt: '電子カルテが停止', eventClass: 'security_incident', domain: 'cybersecurity' })).toBe(true);
    expect(isInScope({ title: '一般企業がランサムウェア被害', excerpt: '', eventClass: 'security_incident', domain: 'cybersecurity' })).toBe(false);
  });
});

/* ------------------------------------------------------------- 抽出の質 -- */

describe('抽出：日付・数値・否定表現', () => {
  it('元号表記の日付を解釈する', () => {
    expect(parseJapaneseDate('令和8年9月7日')?.slice(0, 10)).toBe('2026-09-06'); // JST 0時 = UTC 前日15時
    expect(parseJapaneseDate('2026年9月7日')?.slice(0, 10)).toBe('2026-09-06');
  });

  it('1990年より前・来年より先の日付は誤抽出として捨てる', () => {
    expect(parseJapaneseDate('1985-01-01')).toBeNull();
    expect(parseJapaneseDate('2099-01-01')).toBeNull();
  });

  it('ページ側の公開日・更新日を取る（検索結果の日付を信用しない）', () => {
    const html = `<html><head>
      <meta property="article:published_time" content="2026-09-06T10:00:00+09:00" />
      <meta property="article:modified_time" content="2026-09-07T08:00:00+09:00" /></head><body>本文</body></html>`;
    const dates = extractDates(html);
    expect(dates.publishedAt).toContain('2026-09-06');
    expect(dates.updatedAt).toContain('2026-09-06T23'); // +09:00 を UTC へ
  });

  it('官公庁ページの「掲載日 令和8年9月7日」形式も取る', () => {
    const dates = extractDates('<html><body><p>掲載日：令和8年9月7日</p></body></html>');
    expect(dates.publishedAt).not.toBeNull();
  });

  it('修飾語を保持して数値を取る（約・最大・可能性）', () => {
    const counts = extractCounts('対象は約210人です。最大3万件に影響する可能性があります。');
    const about = counts.find((count) => count.value === 210);
    const possible = counts.find((count) => count.value === 30000);
    expect(about?.qualifier).toBe('about');
    expect(possible?.qualifier).toBe('possible');
  });

  it('「延べ人日」と「人数」を区別する', () => {
    const counts = extractCounts('延べ1000人日の作業');
    expect(counts.some((count) => count.unit === '人' && count.qualifier === 'exact')).toBe(false);
  });

  it('公式の否定表現を弱めずに保持する', () => {
    const denials = extractOfficialDenials('現時点で外部への漏えいは確認されていません。');
    expect(denials.join('')).toContain('確認されていません');
  });

  it('発生日と公開日を別に取る', () => {
    const occurred = extractOccurredAt('8月31日に発生し、9月5日に公表しました。', 2026);
    expect(occurred?.slice(0, 7)).toBe('2026-08');
  });

  it('復旧状態を証拠の強さで区別する', () => {
    expect(detectRecoveryStatus('現在は解消しております')).toBe('recovered_confirmed');
    expect(detectRecoveryStatus('原因を調査中です')).toBe('ongoing_stated');
    expect(detectRecoveryStatus('特に記載なし')).toBe('unknown');
  });

  it('実体参照を戻してからタグを落とす（生タグを本文に残さない）', () => {
    const body = extractBody('<main><p>&lt;a href="x"&gt;見出し&lt;/a&gt;&amp;nbsp;本文</p></main>');
    expect(body).not.toContain('<');
    expect(body).not.toContain('href');
    expect(body).toContain('見出し');
  });

  it('二重エスケープを戻す', () => {
    expect(decodeEntities('&amp;nbsp;')).toBe(' ');
  });

  it('robots.txt の Disallow を読む', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nDisallow: /admin', 'mybot');
    expect(rules.disallow).toContain('/private');
  });
});

/* ----------------------------------------------------------------- 11 --- */

describe('11. SNSの非代表注記と反応の扱い', () => {
  it('手動投入ファイルが無ければ空で返し、生成しない', () => {
    const result = loadManualVoices('data/manual/does-not-exist.json');
    expect(result.voices).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('反応が無い場合の文言は「確認できませんでした」', () => {
    expect(NO_REACTION_TEXT).toContain('確認できませんでした');
  });

  it('取得日時が無い反応はQAで止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [
        {
          id: 'e1',
          title: 'テスト',
          summary: '',
          sources: [{ url: 'https://www.digital.go.jp/a' }],
          publicVoices: [{ summary: '不満', representativeOfPopulation: false }],
          detectedAt: NOW,
          lastMaterialUpdateAt: NOW,
        },
      ],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('取得日時'))).toBe(true);
  });

  it('代表性のある調査が無いのに世論と表現したら止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [
        {
          id: 'e1',
          title: '国民の多くが反対',
          summary: '世論は否定的',
          sources: [{ url: 'https://www.digital.go.jp/a' }],
          surveys: [],
          publicVoices: [{ summary: 'x', observedAt: NOW, representativeOfPopulation: false }],
          detectedAt: NOW,
          lastMaterialUpdateAt: NOW,
        },
      ],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('世論として表現'))).toBe(true);
  });
});

/* -------------------------------------------------------------- 12,13 --- */

describe('12. 外部リンク属性 / 13. 空リンク禁止', () => {
  it('外部リンクに target と rel を必ず付ける', () => {
    const html = externalLink('https://www.digital.go.jp/a', '一次情報を開く');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('一次情報を開く');
  });

  it('使えないURLはリンクにせず注記にする', () => {
    for (const bad of ['', '#', 'javascript:void(0)', '/relative']) {
      const html = externalLink(bad, '出典');
      expect(html).not.toContain('<a ');
      expect(html).toContain('注記として表示');
    }
  });

  it('本文をHTMLエスケープする', () => {
    expect(escapeHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('生成HTMLの全リンクを検査して違反を検出する', () => {
    expect(checkHtml('<meta charset="utf-8"><a href="https://a.example.com/x">外部</a>')).toContain(
      '外部リンクに target="_blank" がありません: https://a.example.com/x',
    );
    expect(checkHtml('<meta charset="utf-8"><a href="#">だめ</a>').some((e) => e.includes('#'))).toBe(true);
    expect(checkHtml('<meta charset="utf-8"><a>href無し</a>').some((e) => e.includes('href を持たない'))).toBe(true);
  });

  it('カード全体を覆うオーバーレイと pointer-events:none を検出する', () => {
    expect(checkHtml('<meta charset="utf-8"><style>.x{position:absolute;inset:0}</style>').some((e) => e.includes('オーバーレイ'))).toBe(true);
    expect(checkHtml('<meta charset="utf-8"><style>.y{pointer-events:none}</style>').some((e) => e.includes('pointer-events'))).toBe(true);
  });

  it('生成した日別HTMLがリンク検査を通る', () => {
    const html = renderDailyReport({
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      events: [
        {
          id: 'e1',
          title: 'テスト事象',
          severity: 'high',
          status: 'attention',
          deltaStatus: 'new',
          systemLayer: 'オンライン資格確認',
          primarySourceConfirmed: true,
          reviewStatus: 'unreviewed',
          summary: '要約',
          whatIsNew: '本日新たに検知しました。',
          impactScore: 70,
          attentionScore: 20,
          independentMediaCount: 2,
          eventClass: 'outage',
          occurredAt: '2026-09-06T00:00:00.000Z',
          publishedAt: '2026-09-06T12:00:00.000Z',
          unknowns: ['原因は未公表'],
          officialAction: ['漏えいは確認されていません'],
          publicVoices: [],
          sources: [{ url: 'https://www.digital.go.jp/a', type: 'primary', publisher: 'デジタル庁', label: '公式発表' }],
          dashboardVisible: true,
        },
      ],
      report: {
        reportDate: '2026-09-07',
        summary: '総括',
        negativeEventIds: ['e1'],
        positiveEventIds: [],
        prEventIds: [],
        watchEventIds: ['e1'],
      },
      siteUrl: 'https://myna-monitoring-jp.github.io/',
    });

    expect(checkHtml(html)).toEqual([]);
    // A/B/C/D の4ブロックが同じカード内にある
    for (const block of ['A. ニュース自体', 'B. 国民の声・現場の声', 'C. 事実関係・補足', 'D. 出典・リンク']) {
      expect(html).toContain(block);
    }
    // 反応が無い場合の文言
    expect(html).toContain('確認できませんでした');
    // 非代表の注記
    expect(html).toContain('全国世論へ一般化しません');
  });
});

/* ----------------------------------------------------------------- 14 --- */

describe('14. 日付・曜日検証', () => {
  it('日付から曜日を出す', () => {
    expect(weekdayOf('2026-09-07')).toBe('月');
  });

  it('主対象期間が24時間でなければ止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-01T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('24時間ではありません'))).toBe(true);
  });

  it('未来日付を止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [
        {
          id: 'e1',
          title: 'x',
          summary: '',
          sources: [{ url: 'https://www.digital.go.jp/a' }],
          detectedAt: '2027-01-01T00:00:00.000Z',
          lastMaterialUpdateAt: NOW,
        },
      ],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('未来の日付'))).toBe(true);
  });

  it('計画停止を障害と書いていたら止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [
        {
          id: 'e1',
          title: 'マイナポータルの障害のお知らせ',
          eventClass: 'planned_maintenance',
          summary: '',
          sources: [{ url: 'https://www.digital.go.jp/a' }],
          detectedAt: NOW,
          lastMaterialUpdateAt: NOW,
        },
      ],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('計画停止を障害'))).toBe(true);
  });

  it('公式の否定表現を断定に強めていたら止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [
        {
          id: 'e1',
          title: 'テスト',
          summary: '漏えいはないと発表',
          sources: [{ url: 'https://www.digital.go.jp/a' }],
          detectedAt: NOW,
          lastMaterialUpdateAt: NOW,
        },
      ],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [{ purpose: 'broad_discovery_24h' }] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('断定に強めています'))).toBe(true);
  });

  it('検索ログが無ければ止める', () => {
    const qa = runQa({
      report: { reportDate: '2026-09-07' },
      events: [],
      run: { startedAt: NOW, primaryWindowStart: '2026-09-06T00:00:00.000Z', primaryWindowEnd: NOW, queries: [] },
      config: CONFIG,
    });
    expect(qa.blockingErrors.some((error) => error.includes('検索ログが空'))).toBe(true);
  });
});

/* ----------------------------------------------------------------- 15 --- */

describe('15. 訂正履歴', () => {
  it('前報の値が変わったら訂正履歴に残す', () => {
    const before = {
      canonicalKey: 'k1',
      id: 'e1',
      lastMaterialUpdateAt: '2026-09-01T00:00:00.000Z',
      detectedAt: '2026-09-01T00:00:00.000Z',
      affectedCount: 210,
      independentMediaCount: 1,
      impactScore: 30,
      recoveryStatus: 'unknown',
      status: 'follow_up',
      corrections: [],
    };
    const applied = applyDiff(
      { canonicalKey: 'k1', affectedCount: 3400, independentMediaCount: 1, impactScore: 30, recoveryStatus: 'unknown', detectedAt: NOW, eventClass: 'security_incident' },
      indexPrevious({ events: [before] }),
      { nowIso: NOW, config: CONFIG },
    );
    expect(applied.deltaStatus).toBe(DELTA.CORRECTION);
    expect(applied.corrections).toHaveLength(1);
    expect(applied.corrections[0]).toMatchObject({ field: 'affectedCount', before: 210, after: 3400 });
  });

  it('新規に判明した値は訂正ではない', () => {
    const before = {
      canonicalKey: 'k1',
      id: 'e1',
      lastMaterialUpdateAt: '2026-09-01T00:00:00.000Z',
      detectedAt: '2026-09-01T00:00:00.000Z',
      affectedCount: null,
      independentMediaCount: 1,
      impactScore: 30,
      recoveryStatus: 'unknown',
      status: 'follow_up',
      corrections: [],
    };
    const applied = applyDiff(
      { canonicalKey: 'k1', affectedCount: 210, independentMediaCount: 1, impactScore: 30, recoveryStatus: 'unknown', detectedAt: NOW, eventClass: 'outage' },
      indexPrevious({ events: [before] }),
      { nowIso: NOW, config: CONFIG },
    );
    expect(applied.corrections).toHaveLength(0);
    const changes: { reason: string }[] = applied.materialChanges;
    expect(changes.some((change) => change.reason === '影響人数が判明')).toBe(true);
  });
});

/* ------------------------------------------------------------ compose --- */

describe('掲載順とネガティブ／ポジティブの振り分け', () => {
  it('トーンではなく社会的影響で分ける', () => {
    expect(polarityOf({ eventClass: 'outage' })).toBe('negative');
    expect(polarityOf({ eventClass: 'security_incident' })).toBe('negative');
    expect(polarityOf({ eventClass: 'operational_load' })).toBe('negative');
    expect(polarityOf({ eventClass: 'positive_service_update' })).toBe('positive');
    // 計画停止は影響が大きければネガティブ側の要注意へ
    expect(polarityOf({ eventClass: 'planned_maintenance', impactScore: 50 })).toBe('negative');
    expect(polarityOf({ eventClass: 'planned_maintenance', impactScore: 10 })).toBe('neutral_watch');
    // 炎上していない広報はポジティブではない
    expect(polarityOf({ eventClass: 'public_communication', backlashRecognized: false })).toBe('neutral_watch');
  });

  it('生命・医療への影響を最上位に並べる', () => {
    expect(displayRank({ title: '救急搬送に影響', eventClass: 'outage' })).toBe(1);
    expect(displayRank({ title: '個人情報が漏えい', eventClass: 'security_incident' })).toBe(3);
    expect(displayRank({ title: '参考', eventClass: 'survey' })).toBe(8);
  });

  it('本文未確認の出典には注記を付ける', () => {
    const sources = buildSources([record({ usableForFacts: false, unusableReason: 'discovery_only' })], NOW);
    expect(sources[0].note).toContain('本文未確認');
  });

  it('総括に「確認できなかったこと」を必ず書く', () => {
    const summary = buildOverallSummary([], { queries: [{ purpose: 'broad_discovery_24h' }] });
    expect(summary).toContain('確認できませんでした');
    expect(summary).toContain('存在しないことの証明ではありません');
  });
});
