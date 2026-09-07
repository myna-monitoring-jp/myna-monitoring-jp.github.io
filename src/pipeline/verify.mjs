/**
 * verify：一次情報の確認
 *
 * 仕様§3.5 / §5。報道だけで事実を確定しないための工程。
 *
 * ここで決めること：
 *  - その事象に一次情報（Tier 0）が付いているか
 *  - 影響人数を公式値として採れるか、報道値にとどまるか
 *  - 公式と報道で数字が食い違っていないか
 *  - 何が未公表・未確認なのか
 *
 * 数字を推測で埋めない。埋められないものは `unknowns` に残す。
 */

/* ------------------------------------------------------- 一次情報の引き当て */

/**
 * 事象に一次情報が付いているかを判定する。
 *
 * 単に公式ドメインの記事が混ざっているだけでは足りない。
 * 本文が取れていて（`usableForFacts`）、かつ Tier 0 であることを要求する。
 * PDFしか無い場合は「一次情報のURLはあるが本文未確認」として区別する。
 */
export function findPrimarySources(cluster) {
  const official = cluster.records.filter((record) => record.official);
  const confirmed = official.filter((record) => record.usableForFacts);
  const urlOnly = official.filter((record) => !record.usableForFacts);

  return {
    primarySourceConfirmed: confirmed.length > 0,
    primarySourceUrlOnly: confirmed.length === 0 && urlOnly.length > 0,
    primaryRecords: confirmed,
    // 本文が取れていない一次情報。出典としては出すが事実確定には使わない
    unverifiedPrimaryRecords: urlOnly,
  };
}

/* --------------------------------------------------------- 影響人数の確定 */

/**
 * 影響人数を決める。
 *
 * 優先順位（source_registry.yml の `affected_count`）：
 *   公式公表 > 報道（この場合は「報道によると」を付ける）
 *
 * 公式に無く報道にしかない場合、値は採るが `qualifier: 'reported'` を立てる。
 * どちらにも無ければ null。**推測しない。**
 */
export function resolveAffectedCount(cluster, primary) {
  const pickCounts = (records) =>
    records.flatMap((record) =>
      record.counts
        .filter((count) => /人|名|件|世帯/.test(count.unit))
        // 「延べ」「日」は人数ではない
        .filter((count) => !/日/.test(count.unit))
        .map((count) => ({ ...count, fromOfficial: record.official, sourceUrl: record.finalUrl })),
    );

  const officialCounts = pickCounts(primary.primaryRecords);
  const mediaCounts = pickCounts(cluster.records.filter((record) => !record.official && record.usableForFacts));

  const chosen = officialCounts[0] ?? mediaCounts[0] ?? null;

  /*
   * 公式と報道の食い違い。片方に寄せず両方を残す（仕様§3.5）。
   * 「確定扱いしない」ことを示すため conflict を立てる。
   */
  const conflict =
    officialCounts.length > 0 &&
    mediaCounts.length > 0 &&
    officialCounts[0].value !== mediaCounts[0].value
      ? { official: officialCounts[0], media: mediaCounts[0] }
      : null;

  if (!chosen) {
    return { affectedCount: null, affectedCountNote: '影響件数は未公表', conflict: null };
  }

  const qualifier = chosen.fromOfficial ? chosen.qualifier : 'reported';
  return {
    affectedCount: chosen.value,
    affectedCountUnit: chosen.unit,
    affectedCountQualifier: qualifier,
    affectedCountNote: noteForCount(chosen, qualifier),
    affectedCountSourceUrl: chosen.sourceUrl,
    conflict,
  };
}

function noteForCount(count, qualifier) {
  const labels = {
    exact: '',
    about: '約',
    maximum: '最大',
    minimum: '少なくとも',
    possible: '可能性がある範囲',
    reported: '報道によると',
    unknown: '',
  };
  const prefix = labels[qualifier] ?? '';
  /*
   * 対象範囲を必ず併記する（仕様§15.4）。
   * 「対象健保分」と「事案全体」を混同しないため、文脈をそのまま残す。
   */
  return [prefix && `${prefix}の値`, count.context && `根拠箇所: ${count.context.trim()}`]
    .filter(Boolean)
    .join('｜');
}

/* ----------------------------------------------------------- 未確認の記録 */

/**
 * 何が分かっていないかを列挙する。
 *
 * 埋められない欄を空欄のまま出すのではなく、「未公表」「未確認」として
 * 明示するために使う（仕様§3.5）。
 */
export function collectUnknowns(cluster, primary, resolved) {
  /** @type {string[]} */
  const unknowns = [];

  if (!primary.primarySourceConfirmed) {
    unknowns.push(
      primary.primarySourceUrlOnly
        ? '一次情報のページは特定できたが、本文を機械確認できていない'
        : '一次情報は確認できず、現時点では報道ベース',
    );
  }
  if (resolved.affectedCount === null && cluster.eventClass !== 'public_communication') {
    unknowns.push('影響人数・件数は未公表');
  }
  if (!cluster.occurredAt) unknowns.push('発生日は特定できていない');

  const hasCause = cluster.records.some((record) => record.usableForFacts && /原因|起因|によるもの/.test(record.excerpt));
  if (!hasCause && cluster.eventClass === 'outage') unknowns.push('原因は未公表');

  const recovery = cluster.records.map((record) => record.recoveryStatus);
  if (cluster.eventClass === 'outage' && !recovery.includes('recovered_confirmed')) {
    /*
     * 「公式終了発表がない」だけを理由に障害継続と断定しない（仕様§22-4）。
     * 分かっているのは「復旧を確認できていない」ことだけ。
     */
    unknowns.push('復旧の公式確認は取れていない');
  }

  if (resolved.conflict) {
    unknowns.push(
      `公式値と報道値が一致しない（公式 ${resolved.conflict.official.value}${resolved.conflict.official.unit} / 報道 ${resolved.conflict.media.value}${resolved.conflict.media.unit}）`,
    );
  }

  return unknowns;
}

/* ------------------------------------------------------------------ 本体 */

/**
 * 事象へ一次情報の確認結果を付ける。
 *
 * `primary_source_required_impact` 以上で一次情報が無い場合は
 * `reviewStatus: 'review_required'` にして自動公開を止める（仕様§17）。
 */
export function verifyCluster(cluster, { config }) {
  const primary = findPrimarySources(cluster);
  const resolved = resolveAffectedCount(cluster, primary);
  const unknowns = collectUnknowns(cluster, primary, resolved);

  const recoveryStatus = pickRecoveryStatus(cluster.records);

  return {
    ...cluster,
    primarySourceConfirmed: primary.primarySourceConfirmed,
    primarySourceUrlOnly: primary.primarySourceUrlOnly,
    recoveryStatus,
    ...resolved,
    unknowns,
    /*
     * 表示に使う確度ラベル。断定の強さを証拠に合わせる（仕様§5.3）。
     */
    evidenceLevel: primary.primarySourceConfirmed
      ? 'primary_confirmed'
      : primary.primarySourceUrlOnly
        ? 'primary_url_only'
        : cluster.records.some((record) => record.usableForFacts)
          ? 'media_only'
          : 'snippet_only',
  };
}

/** 復旧状態は、最も強い確認を採る。 */
function pickRecoveryStatus(records) {
  const order = ['recovered_confirmed', 'partially_recovered', 'ongoing_stated', 'unknown'];
  for (const status of order) {
    if (records.some((record) => record.usableForFacts && record.recoveryStatus === status)) return status;
  }
  return 'unknown';
}

/**
 * レビュー必須かどうか。config/app.yml の `review.require_review_when` に対応。
 */
export function needsReview(event, { config }) {
  const threshold = config?.research?.primary_source_required_impact ?? 60;
  /** @type {string[]} */
  const reasons = [];

  if ((event.impactScore ?? 0) >= threshold) reasons.push(`影響度が${threshold}点以上`);
  if (event.eventClass === 'security_incident') reasons.push('個人情報・セキュリティ事案');
  if (event.backlashRecognized) reasons.push('炎上認定');
  if (event.conflict) reasons.push('公式値と報道値が不一致');
  if ((event.impactScore ?? 0) >= threshold && !event.primarySourceConfirmed) {
    reasons.push('重要度が高いのに一次情報が未確認');
  }
  if ((event.publicVoices ?? []).some((voice) => voice.representative)) reasons.push('代表投稿を掲載');

  return reasons;
}
