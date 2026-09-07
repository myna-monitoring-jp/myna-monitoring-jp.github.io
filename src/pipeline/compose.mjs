/**
 * compose：レポートJSONの組み立て
 *
 * 事象を `event_schema.json` の形に整え、掲載順（仕様§15.1）で並べ、
 * ネガティブ／ポジティブ／広報／優先ウォッチへ振り分ける。
 *
 * 文章の生成はしない。ここで作る `summary` は、確認できた事実を
 * そのまま並べた定型文。LLMが無い環境でも「無いことを無いと書く」品質は保てる。
 */

import { NO_PRIMARY_SOURCE_TEXT, NO_REACTION_TEXT } from './reaction.mjs';

/** 掲載順の重み。仕様§15.1。小さいほど上。 */
export function displayRank(event) {
  const text = `${event.title ?? ''} ${event.summary ?? ''}`;
  // 1. 生命・医療・受診へ直接影響
  if (/救急|救命|受診できな|診療を停止/.test(text)) return 1;
  // 2. 全国・大規模システム障害
  if (event.eventClass === 'outage' && /全国/.test(text)) return 2;
  // 3. 個人番号・要配慮個人情報・サイバー
  if (event.eventClass === 'security_incident') return 3;
  // 4. 大規模な資格誤表示・負担割合
  if (/資格.{0,3}無効|誤表示|負担割合|限度額/.test(text)) return 4;
  // 5. 重大制度変更
  if (event.eventClass === 'policy_change') return 5;
  // 6. 行政広報炎上
  if (event.eventClass === 'public_communication' && event.backlashRecognized) return 6;
  // 7. 利便性・普及・好事例
  if (event.eventClass === 'positive_service_update') return 7;
  // 8. 参考情報
  return 8;
}

/**
 * ネガティブ／ポジティブの振り分け。
 *
 * トーンではなく社会的影響で分ける（仕様§15.2）。
 * 計画停止は影響が大きければネガティブ側の要注意に置く。
 */
export function polarityOf(event) {
  if (event.eventClass === 'positive_service_update') return 'positive';
  if (event.eventClass === 'outage' || event.eventClass === 'security_incident') return 'negative';
  if (event.eventClass === 'operational_load') return 'negative';
  if (event.eventClass === 'planned_maintenance') {
    return (event.impactScore ?? 0) >= 40 ? 'negative' : 'neutral_watch';
  }
  if (event.eventClass === 'public_communication') {
    return event.backlashRecognized ? 'negative' : 'neutral_watch';
  }
  if (event.recoveryStatus === 'recovered_confirmed') return 'positive';
  return 'neutral_watch';
}

/** 事象IDを canonicalKey から決定論的に作る。日をまたいでも同じIDになる。 */
export function eventIdOf(canonicalKey) {
  let hash = 0;
  for (let i = 0; i < canonicalKey.length; i += 1) {
    hash = (hash * 31 + canonicalKey.charCodeAt(i)) | 0;
  }
  return `evt-${Math.abs(hash).toString(36)}`;
}

/**
 * 出典を `event_schema.json` の `source` 形へ。
 *
 * `news.google.com` のリダイレクトURLは出典にしない。
 * 押しても中間ページに飛ぶだけで一次情報に到達しない。
 */
export function buildSources(records, nowIso) {
  const seen = new Set();
  return records
    .map((record) => ({ record, url: record.finalUrl || record.canonicalUrl || record.url }))
    .filter(({ url }) => {
      if (!/^https?:\/\//i.test(url)) return false;
      try {
        new URL(url);
      } catch {
        return false;
      }
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map(({ record, url }, index) => ({
      id: `src-${index + 1}`,
      type: record.sourceType === 'unknown' ? 'specialist_media' : record.sourceType,
      tier: record.tier ?? 3,
      label: record.title || record.publisher || '出典',
      url,
      publisher: record.publisher || hostOf(url),
      publishedAt: record.publishedAt ?? null,
      updatedAt: record.updatedAt ?? null,
      verifiedAt: nowIso,
      httpStatus: null,
      finalUrl: url,
      independentReporting: record.tier === 1 || record.tier === 2,
      syndicationGroup: null,
      contentHash: null,
      note: record.usableForFacts ? null : `本文未確認（${record.unusableReason}）`,
    }))
    .slice(0, 8);
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '出典';
  }
};

/**
 * 事象の要約文。定型で組む。
 *
 * 断定の強さを証拠に合わせる（仕様§20.5）。
 * 一次情報があるかどうかで書き方を変え、無い場合は必ずその旨を書く。
 */
export function buildSummary(event) {
  const parts = [];

  const best = event.records.find((record) => record.usableForFacts && record.official)
    ?? event.records.find((record) => record.usableForFacts);

  if (best?.excerpt) {
    parts.push(best.excerpt);
  } else {
    // 本文が取れていない場合は、取れていないことを書く。スニペットで断定しない
    parts.push('本文を機械確認できていないため、内容は出典のページで確認してください。');
  }

  if (typeof event.affectedCount === 'number') {
    const qualifier = { about: '約', maximum: '最大', minimum: '少なくとも', possible: '可能性がある範囲で', reported: '報道によると', exact: '' }[
      event.affectedCountQualifier
    ] ?? '';
    parts.push(`影響は${qualifier}${event.affectedCount.toLocaleString('ja-JP')}${event.affectedCountUnit ?? ''}。`);
  } else if (event.eventClass !== 'public_communication') {
    parts.push('影響人数・件数は未公表です。');
  }

  if (event.recoveryStatus === 'recovered_confirmed') parts.push('復旧を公式に確認しました。');
  else if (event.recoveryStatus === 'partially_recovered') parts.push('一部復旧が確認できています。');
  else if (event.eventClass === 'outage') parts.push('復旧の公式確認は取れていません。');

  if (!event.primarySourceConfirmed) parts.push(NO_PRIMARY_SOURCE_TEXT);

  return parts.join(' ');
}

/** 事象の「何が新しいか」。前日差分から作る。 */
export function buildWhatIsNew(event) {
  const LABEL = {
    new: '本日新たに検知しました。',
    backfill: '直近24時間より前の事象を新たに検知しました（追補）。',
    expanded: '報道・反応が拡大しています。',
    material_update: '重要な更新がありました。',
    improving: '影響が縮小しています。',
    resolved: '復旧・終了が確認できました。',
    unchanged: '前日から大きな動きはありません。',
    reignited: '沈静化後に反応・報道が再増加しました。',
    correction: '前報の値が訂正されました。',
  };
  const base = LABEL[event.deltaStatus] ?? '';
  const detail = (event.materialChanges ?? [])
    .map((change) => `${change.reason}（${change.field}: ${format(change.before)} → ${format(change.after)}）`)
    .join('、');
  return [base, detail].filter(Boolean).join(' ');
}

const format = (value) => (value === null || value === undefined ? '未公表' : String(value));

/* ------------------------------------------------------------------ 本体 */

/**
 * 事象群からレポートを組む。
 *
 * @returns {{run, events, report}} event_schema.json に適合する形
 */
export function composeReport({ clusters, run, reportDate, nowIso, config }) {
  const events = clusters
    .map((cluster) => {
      const id = eventIdOf(cluster.canonicalKey);
      const summary = buildSummary(cluster);
      return {
        id,
        canonicalKey: cluster.canonicalKey,
        title: cluster.title ?? bestTitle(cluster),
        entity: cluster.entity ?? null,
        eventClass: cluster.eventClass,
        domain: cluster.domain,
        systemLayer: cluster.systemLayer ?? null,
        polarity: polarityOf({ ...cluster, summary }),
        status: cluster.status,
        deltaStatus: cluster.deltaStatus,
        severity: cluster.severity,
        impactScore: cluster.impactScore ?? 0,
        attentionScore: cluster.attentionScore ?? 0,
        occurredAt: cluster.occurredAt ?? null,
        detectedAt: cluster.detectedAt,
        publishedAt: cluster.publishedAt ?? null,
        updatedAt: cluster.updatedAt ?? null,
        lastMaterialUpdateAt: cluster.lastMaterialUpdateAt,
        summary,
        whatIsNew: buildWhatIsNew(cluster) || null,
        affectedWho: cluster.affectedWho ?? [],
        affectedRegions: cluster.entity ? [cluster.entity] : [],
        symptoms: cluster.symptoms ?? [],
        cause: cluster.cause ?? null,
        workaround: cluster.workaround ?? null,
        recoveryAt: cluster.recoveryStatus === 'recovered_confirmed' ? (cluster.publishedAt ?? null) : null,
        officialAction: cluster.officialDenials ?? [],
        medicalImpact: null,
        personalDataTypes: cluster.personalDataTypes ?? [],
        metrics: buildMetrics(cluster, nowIso),
        publicVoices: cluster.publicVoices ?? [],
        surveys: cluster.surveys ?? [],
        factChecks: cluster.factChecks ?? [],
        sources: buildSources(cluster.records, nowIso),
        rawArticleCount: cluster.rawArticleCount ?? 0,
        independentMediaCount: cluster.independentMediaCount ?? 0,
        majorMediaCount: cluster.majorMediaCount ?? 0,
        syndicatedCount: cluster.syndicatedCount ?? 0,
        primarySourceConfirmed: Boolean(cluster.primarySourceConfirmed),
        unknowns: cluster.unknowns ?? [],
        dashboardVisible: cluster.status !== 'quiet' && cluster.status !== 'archived',
        pinned: Boolean(cluster.pinned),
        reviewStatus: cluster.reviewStatus ?? 'unreviewed',
        corrections: cluster.corrections ?? [],
      };
    })
    .sort((a, b) => {
      const rank = displayRank(a) - displayRank(b);
      if (rank !== 0) return rank;
      return (b.impactScore ?? 0) - (a.impactScore ?? 0);
    });

  const visible = events.filter((event) => event.dashboardVisible);

  const report = {
    reportDate,
    generatedAt: nowIso,
    summary: buildOverallSummary(visible, run),
    noMajorChange: visible.every((event) => event.deltaStatus === 'unchanged'),
    negativeEventIds: visible.filter((e) => e.polarity === 'negative').map((e) => e.id),
    positiveEventIds: visible.filter((e) => e.polarity === 'positive').map((e) => e.id),
    prEventIds: visible.filter((e) => e.eventClass === 'public_communication').map((e) => e.id),
    watchEventIds: visible
      .filter((e) => e.status === 'attention' || (e.unknowns ?? []).length > 0)
      .slice(0, 8)
      .map((e) => e.id),
    htmlPath: `reports/myna_news_${reportDate}.html`,
  };

  return { run, events, report };
}

export function bestTitle(cluster) {
  // 一次情報の表題を優先する。報道の見出しより事実に近い
  const official = cluster.records.find((record) => record.official && record.title);
  return (official ?? cluster.records.find((record) => record.title) ?? cluster.records[0])?.title ?? '無題';
}

function buildMetrics(cluster, nowIso) {
  if (typeof cluster.affectedCount !== 'number') return [];
  return [
    {
      key: 'affectedCount',
      label: '影響件数',
      value: cluster.affectedCount,
      unit: cluster.affectedCountUnit ?? null,
      // 対象範囲を必ず持たせる（仕様§15.4）
      scope: cluster.entity ?? null,
      denominator: null,
      observedAt: nowIso,
      sourceId: null,
      qualifier: cluster.affectedCountQualifier ?? 'unknown',
    },
  ];
}

/**
 * 今朝の総括。
 *
 * 「無かったこと」を必ず書く。全国規模の重大障害を確認できなかった日に
 * その旨を書かないと、見落としたのか無かったのか読者に分からない。
 */
export function buildOverallSummary(events, run) {
  const lines = [];
  const nationwide = events.filter(
    (event) => event.eventClass === 'outage' && /全国/.test(`${event.title} ${event.summary}`),
  );

  lines.push(
    nationwide.length === 0
      ? '直近24時間で、マイナ保険証・オンライン資格確認の新たな全国規模の重大障害は確認できませんでした。'
      : `全国規模の障害を${nationwide.length}件確認しました。`,
  );

  const security = events.filter((event) => event.eventClass === 'security_incident');
  if (security.length > 0) lines.push(`個人情報・セキュリティ関連は${security.length}件を確認しています。`);

  const pr = events.filter((event) => event.eventClass === 'public_communication');
  const backlash = pr.filter((event) => event.backlashRecognized);
  lines.push(
    backlash.length === 0
      ? '行政広報について、新たに二次転載・主要報道化まで進んだ大型の炎上は確認できませんでした。'
      : `広報案件で炎上と判定したものが${backlash.length}件あります。`,
  );

  const newOnes = events.filter((event) => event.deltaStatus === 'new');
  if (newOnes.length === 0) lines.push('本日新規に検知した事象はありません。');
  else lines.push(`本日新規に検知した事象は${newOnes.length}件です。`);

  lines.push(
    `この判断は、${run.queries.length}本の検索と取得できた公式情報の範囲によるものです。存在しないことの証明ではありません。`,
  );

  return lines.join('');
}

/** 反応が無い事象の表示文。 */
export function voiceTextFor(event) {
  if ((event.publicVoices ?? []).length === 0) return NO_REACTION_TEXT;
  return event.publicVoices.map((voice) => voice.summary).join(' ');
}
