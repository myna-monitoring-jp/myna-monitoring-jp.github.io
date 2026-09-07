/**
 * score：影響度と話題度を別に算定する
 *
 * 仕様§9。1つのスコアにまとめないことが要件。
 *
 *  - `impactScore`    社会・業務への影響。医療や行政手続が止まるか、個人情報か
 *  - `attentionScore` 話題・報道の規模。独立媒体数、SNS反応、公式対応
 *
 * 「影響は重大だが話題は小さい事故」と「話題は大きいが実害が限定的な広報炎上」を
 * 同じ扱いにしないため。配点は config/app.yml で変更できる。
 */

const clamp = (value, max) => Math.max(0, Math.min(max, Math.round(value)));

/* --------------------------------------------------------- impactScore */

/**
 * 社会・業務影響（0〜100）。
 *
 * 推測で加点しない。分からない項目は0点のままにする。
 * 「未公表だから大きいかもしれない」で点を足さない。
 */
export function calculateImpactScore(event, { config }) {
  const weights = config?.scoring?.impact_weights ?? {};
  const text = `${event.title ?? ''} ${(event.records ?? []).map((r) => r.excerpt).join(' ')}`;

  /* --- 対象範囲。全国かどうかが最も効く --- */
  const scopeMax = weights.scope ?? 25;
  let scope = 0;
  if (/全国|全ての医療機関|全自治体/.test(text)) scope = scopeMax;
  else if (/都道府県|広域連合|複数の自治体|県内全/.test(text)) scope = scopeMax * 0.6;
  else if (event.entity) scope = scopeMax * 0.3;

  /* --- 医療・行政手続の必須性。受診や救急に直接効くか --- */
  const essentialMax = weights.essentiality ?? 20;
  let essentiality = 0;
  if (/救急|救命|受診できな|診療を停止|10割|窓口負担/.test(text)) essentiality = essentialMax;
  else if (/オンライン資格確認|電子処方箋|資格確認書|保険証/.test(text)) essentiality = essentialMax * 0.7;
  else if (/申請できな|手続きができな/.test(text)) essentiality = essentialMax * 0.4;

  /* --- 個人情報の機微性。要配慮個人情報は最大 --- */
  const dataMax = weights.data_sensitivity ?? 20;
  let dataSensitivity = 0;
  if (/疾患|健診|薬剤|診療情報|特定保健指導|病歴/.test(text)) dataSensitivity = dataMax;
  else if (/個人番号|マイナンバー.{0,4}(漏|流出)|要配慮/.test(text)) dataSensitivity = dataMax * 0.85;
  else if (/氏名|住所|生年月日|個人情報/.test(text) && event.eventClass === 'security_incident') {
    dataSensitivity = dataMax * 0.5;
  }

  /* --- 継続時間。復旧が確認できているものは減点方向 --- */
  const durationMax = weights.duration ?? 15;
  let duration = 0;
  if (/数日|継続しています|復旧時期は未定/.test(text)) duration = durationMax;
  else if (/時間にわたり|終日/.test(text)) duration = durationMax * 0.6;
  else if (/分間|一時的/.test(text)) duration = durationMax * 0.25;
  if (event.recoveryStatus === 'recovered_confirmed') duration = Math.min(duration, durationMax * 0.3);

  /* --- 対象人数。公式値のみ満点。報道値は割り引く --- */
  const countMax = weights.affected_count ?? 10;
  let affected = 0;
  if (typeof event.affectedCount === 'number') {
    const value = event.affectedCount;
    if (value >= 100000) affected = countMax;
    else if (value >= 10000) affected = countMax * 0.8;
    else if (value >= 1000) affected = countMax * 0.6;
    else if (value >= 100) affected = countMax * 0.4;
    else affected = countMax * 0.2;
    // 報道値・可能性の値は確定していないので割り引く
    if (event.affectedCountQualifier === 'reported') affected *= 0.7;
    if (event.affectedCountQualifier === 'possible') affected *= 0.5;
  }

  /* --- 公式のエスカレーション。謝罪・中止・回収は重い --- */
  const escalationMax = weights.official_escalation ?? 10;
  let escalation = 0;
  if (/謝罪|お詫び|中止|回収|停止しました/.test(text)) escalation = escalationMax;
  else if (/調査|報告|注意喚起/.test(text)) escalation = escalationMax * 0.4;

  const total = scope + essentiality + dataSensitivity + duration + affected + escalation;

  return {
    impactScore: clamp(total, 100),
    impactBreakdown: {
      scope: clamp(scope, scopeMax),
      essentiality: clamp(essentiality, essentialMax),
      dataSensitivity: clamp(dataSensitivity, dataMax),
      duration: clamp(duration, durationMax),
      affectedCount: clamp(affected, countMax),
      officialEscalation: clamp(escalation, escalationMax),
    },
  };
}

/* ------------------------------------------------------- attentionScore */

/**
 * 話題・報道規模（0〜100）。
 *
 * 独立媒体数を使う。検索結果件数や `rawArticleCount` は使わない（水増しになる）。
 * SNS反応は取得できた実数のみ。取れない日は0点で、推測で埋めない。
 */
export function calculateAttentionScore(event, { config, previous }) {
  const weights = config?.scoring?.attention_weights ?? {};

  /* --- 独立媒体数 --- */
  const indieMax = weights.independent_media ?? 25;
  const indie = Math.min(indieMax, (event.independentMediaCount ?? 0) * (indieMax / 5));

  /* --- 主要媒体数 --- */
  const majorMax = weights.major_media ?? 20;
  const major = Math.min(majorMax, (event.majorMediaCount ?? 0) * (majorMax / 3));

  /* --- SNS反応量。実際に取得できた数値のみ --- */
  const socialMax = weights.social_volume ?? 25;
  const volume = (event.publicVoices ?? []).reduce(
    (sum, voice) =>
      sum + (voice.repostCount ?? 0) + (voice.replyCount ?? 0) + (voice.quoteCount ?? 0) + (voice.commentCount ?? 0),
    0,
  );
  let social = 0;
  if (volume >= 10000) social = socialMax;
  else if (volume >= 3000) social = socialMax * 0.8;
  else if (volume >= 500) social = socialMax * 0.5;
  else if (volume > 0) social = socialMax * 0.25;

  /* --- 公式対応。謝罪・削除・中止は話題が大きい証拠 --- */
  const responseMax = weights.official_response ?? 15;
  const text = `${event.title ?? ''} ${(event.records ?? []).map((r) => r.excerpt).join(' ')}`;
  let response = 0;
  if (/謝罪|削除しました|撤回|中止|回収/.test(text)) response = responseMax;
  else if (/補足|訂正|お知らせを更新/.test(text)) response = responseMax * 0.5;

  /* --- 伸び率。前日と比べて反応・媒体が増えたか --- */
  const growthMax = weights.growth_rate ?? 15;
  let growth = 0;
  const before = previous?.byKey?.get(event.canonicalKey);
  if (before) {
    const mediaGrowth = (event.independentMediaCount ?? 0) - (before.independentMediaCount ?? 0);
    if (mediaGrowth >= 3) growth = growthMax;
    else if (mediaGrowth >= 1) growth = growthMax * 0.5;
  } else if ((event.independentMediaCount ?? 0) >= 2) {
    // 初日で複数媒体が付いているものは立ち上がりが速い
    growth = growthMax * 0.5;
  }

  const total = indie + major + social + response + growth;

  return {
    attentionScore: clamp(total, 100),
    attentionBreakdown: {
      independentMedia: clamp(indie, indieMax),
      majorMedia: clamp(major, majorMax),
      socialVolume: clamp(social, socialMax),
      officialResponse: clamp(response, responseMax),
      growthRate: clamp(growth, growthMax),
    },
    socialVolumeObserved: volume,
  };
}

/** 影響度から severity ラベルへ。仕様§9.1の目安に合わせる。 */
export function severityFromImpact(impactScore) {
  if (impactScore >= 80) return 'critical';
  if (impactScore >= 60) return 'high';
  if (impactScore >= 40) return 'medium';
  if (impactScore >= 20) return 'low';
  return 'reference';
}

/**
 * 炎上認定。仕様§12.2。
 *
 * 批判の存在だけでは認定しない。複数のシグナルを満たす場合のみ。
 * 認定は公開前レビューの対象になる。
 */
export function recognizeBacklash(event) {
  const text = `${event.title ?? ''} ${(event.records ?? []).map((r) => r.excerpt).join(' ')}`;
  /** @type {string[]} */
  const signals = [];

  if ((event.majorMediaCount ?? 0) >= 1) signals.push('主要媒体で記事化');
  if ((event.independentMediaCount ?? 0) >= 3) signals.push('複数の独立媒体が扱った');
  if ((event.socialVolumeObserved ?? 0) >= 3000) signals.push('SNS反応量が大きい');
  if (/謝罪|削除しました|撤回|中止|回収/.test(text)) signals.push('公式が謝罪・削除・中止');
  if ((event.syndicatedCount ?? 0) >= 3) signals.push('二次転載が複数');
  if (/議員|著名|団体が|抗議/.test(text)) signals.push('著名人・議員・団体へ波及');

  return {
    // 複数条件を満たす場合のみ炎上とする
    backlashRecognized: signals.length >= 2,
    backlashSignals: signals,
    backlashLevel: backlashLevelOf(signals.length, event),
  };
}

function backlashLevelOf(signalCount, event) {
  if (signalCount === 0) return 'none';
  if (signalCount >= 3 && (event.majorMediaCount ?? 0) >= 2) return 'high';
  if (signalCount >= 2) return 'medium';
  return 'low';
}
