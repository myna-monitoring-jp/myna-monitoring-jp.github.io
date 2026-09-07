/**
 * extract：構造化抽出
 *
 * fetch で取った本文から、事実だけを機械的に取り出す。
 *
 * 設計上の約束（仕様§6）：
 *  - 本文にない数字を補完しない。取れなければ null
 *  - 「約」「最大」「可能性」を落とさない（qualifier として保持）
 *  - 「発生」「判明」「公表」「報道」を区別する
 *  - 公式の否定表現を弱めない。「確認されていない」を「ない」にしない
 *  - 日付は occurredAt / publishedAt / updatedAt / detectedAt を分けて持つ
 *
 * LLMは任意。`ANTHROPIC_API_KEY` があれば要約と論点の質が上がるが、
 * 無くても本文を根拠にした抽出は成立する。日付と数値は機械抽出を常に優先する
 * （LLMは数字を作ることがあるため）。
 */

import { parseJapaneseDate } from './fetch.mjs';

/* ------------------------------------------------------- システム層の語彙 */

/**
 * システム層。仕様§4 の「同じ障害として扱わない」一覧に対応する。
 * 上から順に判定し、最初に当たったものを採用する（具体的なものを先に置く）。
 */
export const SYSTEM_LAYERS = [
  { layer: 'マイナポータルAPI（自己情報取得）', pattern: /自己情報取得API|マイナポータルAPI/ },
  { layer: '医療保険情報取得API', pattern: /医療保険情報取得API/ },
  { layer: 'PMH情報連携API', pattern: /PMH/ },
  { layer: 'マイナアプリ', pattern: /マイナアプリ|マイナポータルアプリ/ },
  { layer: 'パスポートオンライン申請', pattern: /旅券|パスポート/ },
  { layer: '顔認証付きカードリーダー', pattern: /顔認証付きカードリーダー|カードリーダー/ },
  { layer: '電子処方箋', pattern: /電子処方箋/ },
  { layer: 'マイナ保険証利用登録', pattern: /利用登録|健康保険証利用の登録/ },
  { layer: 'オンライン資格確認', pattern: /オンライン資格確認|オン資/ },
  { layer: '電子証明書・JPKI', pattern: /電子証明書|JPKI|公的個人認証/ },
  { layer: 'J-LIS・カード交付', pattern: /J-LIS|地方公共団体情報システム機構|カード交付|誤交付/ },
  { layer: '自治体基幹システム', pattern: /基幹システム|標準化|住民記録システム/ },
  { layer: '保険者の資格情報連携', pattern: /資格情報|データ連携|負担割合|限度額/ },
  { layer: '医療機関の院内システム', pattern: /電子カルテ|院内ネットワーク|レセコン|地域医療連携/ },
  { layer: 'マイナポータルWeb', pattern: /マイナポータル/ },
];

export function detectSystemLayer(text) {
  for (const entry of SYSTEM_LAYERS) {
    if (entry.pattern.test(text)) return entry.layer;
  }
  return null;
}

/* --------------------------------------------------------- 事象種別の語彙 */

/**
 * 事象種別。仕様§13。ここを混ぜないことが要件。
 * 判定順に意味がある：計画停止は障害語を含むことが多いので先に見る。
 */
export function detectEventClass(text) {
  // 計画停止。事前告知された停止・制限
  if (/計画(停止|メンテナンス)|定期メンテナンス|メンテナンスのお知らせ|以下の時間.{0,20}(停止|利用できません)/.test(text)) {
    return 'planned_maintenance';
  }
  // セキュリティ事案
  if (/漏えい|漏洩|流出|不正アクセス|ランサム|サイバー攻撃|誤送信|誤アップロード|不適切な取扱い|紛失/.test(text)) {
    return 'security_incident';
  }
  // 広報
  if (/広告|CM|キャンペーン|タイアップ|ポスター|リーフレット|PR動画|特設サイト/.test(text)) {
    return 'public_communication';
  }
  // 運用負荷。窓口混雑はシステム障害ではない（仕様§5.2）
  if (/混雑|待ち時間|行列|予約が取れ|申込みが集中|窓口.{0,10}(混雑|逼迫)/.test(text)) {
    return 'operational_load';
  }
  // 障害
  if (/障害|不具合|エラー|停止しています|利用できな|つながらな|誤表示|資格.{0,3}無効|ログインできな/.test(text)) {
    return 'outage';
  }
  // 制度変更
  if (/改正|施行|制度変更|運用の見直し|取扱いを変更|開始します|廃止/.test(text)) {
    return 'policy_change';
  }
  // 世論調査
  if (/世論調査|意識調査|アンケート結果/.test(text)) return 'survey';
  // 前進・改善
  if (/復旧しました|解消しました|開始しました|拡大|利便性|改善/.test(text)) return 'positive_service_update';
  return 'other';
}

/** 事象領域。event_schema.json の domain enum に一致させる。 */
export function detectDomain(text) {
  if (/漏えい|漏洩|不正アクセス|ランサム|サイバー/.test(text)) return 'cybersecurity';
  if (/電子カルテ|院内|病院|診療所|医療法人/.test(text)) return 'medical_it';
  if (/広告|CM|キャンペーン|タイアップ|政府広報/.test(text)) return 'public_relations';
  if (/公金受取口座/.test(text)) return 'public_money_account';
  if (/PMH/.test(text)) return 'pmh';
  if (/電子処方箋/.test(text)) return 'e_prescription';
  if (/マイナアプリ/.test(text)) return 'myna_app';
  if (/マイナポータル/.test(text)) return 'myna_portal';
  if (/電子証明書|JPKI/.test(text)) return 'electronic_certificate';
  if (/オンライン資格確認|オン資/.test(text)) return 'online_eligibility';
  if (/マイナ保険証|資格確認書|資格情報のお知らせ/.test(text)) return 'myna_insurance';
  if (/市|町|村|区|県|府|広域連合|国民健康保険|後期高齢/.test(text)) return 'local_government';
  if (/マイナンバーカード/.test(text)) return 'myna_card';
  return 'other';
}

/* ------------------------------------------------------------ 数値の抽出 */

/**
 * 影響人数・件数を、修飾語を保持したまま取り出す。
 *
 * 「約210人」を210に丸めて `exact` にしてはいけない。
 * 「最大3万件の可能性」を実被害3万件にしてはいけない（仕様§22-10）。
 */
export function extractCounts(text) {
  const results = [];
  const body = String(text ?? '');

  /*
   * 修飾語つきの数値表現。単位ごとに拾い、単位を捨てない。
   * 「延べ」と「人数」も区別する（仕様§15.4）。
   */
  /*
   * 「人日」は工数であって人数ではない（仕様§15.4）。
   * 単位に「日」が続く場合は別単位として扱い、人数と混同させない。
   */
  const pattern =
    /(約|およそ|最大|最小|少なくとも|延べ)?\s*([0-9,]+(?:\.\d+)?)\s*(万|千)?\s*(人日|人|件|名|団体|自治体|医療機関|世帯|回|日)(分|以上|未満|程度)?/g;

  for (const match of body.matchAll(pattern)) {
    const [, prefix, digits, scale, unit, suffix] = match;
    const base = Number(String(digits).replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const multiplier = scale === '万' ? 10000 : scale === '千' ? 1000 : 1;
    const value = base * multiplier;

    // 年号や日付の一部を人数として拾わないための除外
    const around = body.slice(Math.max(0, match.index - 6), match.index);
    if (/令和|平成|\d{4}年|\d{1,2}月/.test(around) && unit === '日') continue;

    results.push({
      value,
      unit: `${unit}${suffix === '分' ? '分' : ''}`,
      qualifier: qualifierOf(prefix, suffix, body, match.index),
      // 何についての数値かを判断するため、前後の文脈を残す
      context: body.slice(Math.max(0, match.index - 40), Math.min(body.length, match.index + 40)).replace(/\s+/g, ' '),
    });
  }

  return results;
}

function qualifierOf(prefix, suffix, body, index) {
  /*
   * 修飾語は同じ文の中だけを見る。
   * 文をまたいで見ると、次の文の「可能性があります」を拾って
   * 「約210人」が possible になってしまう（実際に起きた）。
   */
  const rest = body.slice(index, Math.min(body.length, index + 80));
  const window = rest.split(/[。\n]/)[0];
  if (/可能性|恐れ|おそれ|見込み/.test(window)) return 'possible';
  if (prefix === '約' || prefix === 'およそ' || suffix === '程度') return 'about';
  if (prefix === '最大' || suffix === '以上') return 'maximum';
  if (prefix === '最小' || prefix === '少なくとも') return 'minimum';
  if (/報道によ|とみられる/.test(window)) return 'reported';
  return 'exact';
}

/* ------------------------------------------------------- 発生日・復旧状態 */

/**
 * 本文中の発生日。「発生」「判明」の周辺の日付を取る。
 * 記事の公開日（publishedAt）とは別に持つ（仕様§1.2）。
 */
export function extractOccurredAt(text, fallbackYear) {
  const body = String(text ?? '');
  const patterns = [
    /((?:令和|平成)?\s*\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)[^。]{0,20}?(?:に|から)?\s*(?:発生|判明|確認)/,
    /(?:発生|判明|確認)(?:日|し(?:た|ました))?[^0-9令平]{0,10}((?:令和|平成)?\s*\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
    /(\d{1,2}\s*月\s*\d{1,2}\s*日)[^。]{0,16}?(?:発生|判明)/,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (!match) continue;
    let raw = match[1];
    // 「8月31日」のように年が無い場合は基準年を補う。年をまたぐ誤りを避けるため未来は前年にする
    if (!/年/.test(raw) && fallbackYear) raw = `${fallbackYear}年${raw}`;
    const iso = parseJapaneseDate(raw);
    if (iso) return iso;
  }
  return null;
}

/**
 * 復旧状態。「公式終了発表がない」だけで継続と断定しない（仕様§3.7 / §22-4）。
 */
export function detectRecoveryStatus(text) {
  const body = String(text ?? '');
  if (/復旧しました|解消しました|正常に稼働|復旧済み|終了しました/.test(body)) return 'recovered_confirmed';
  if (/現在は(?:解消|復旧)/.test(body)) return 'recovered_confirmed';
  if (/調査中|原因を調査|対応中|継続しています/.test(body)) return 'ongoing_stated';
  if (/一部.{0,6}(復旧|解消)|順次復旧/.test(body)) return 'partially_recovered';
  return 'unknown';
}

/**
 * 公式の否定表現を弱めずに保持する。
 * 「外部漏えいは確認されていない」を「漏えいはない」にしない（仕様§6）。
 */
export function extractOfficialDenials(text) {
  const body = String(text ?? '');
  const found = [];
  for (const match of body.matchAll(/([^。\n]{0,60}?(?:確認されていません|確認されておりません|確認できていません|可能性はない(?:と|旨)[^。\n]{0,20})[^。\n]{0,20})/g)) {
    const phrase = match[1].trim();
    if (phrase.length > 6) found.push(phrase);
  }
  return [...new Set(found)].slice(0, 5);
}

/** 主体（自治体・組織）。誤って一般語を主体にしないよう、語尾で絞る。 */
export function extractEntity(text) {
  const body = String(text ?? '');
  const patterns = [
    /([一-龥ぁ-んァ-ヶa-zA-Z0-9]{2,12}(?:市|区|町|村|都|道|府|県))(?![民間内])/,
    /([一-龥ァ-ヶa-zA-Z0-9]{2,20}健康保険組合)/,
    /([一-龥ァ-ヶa-zA-Z0-9]{2,20}(?:病院|医療センター|医療法人|クリニック))/,
    /(デジタル庁|厚生労働省|総務省|消防庁|法務省|外務省|内閣府|個人情報保護委員会|政府広報オンライン|日本年金機構|社会保険診療報酬支払基金|国保中央会|J-LIS)/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/* -------------------------------------------------------------- 関連判定 */

/**
 * この監視の対象かどうか。
 *
 * `query_catalog.yml` の広報クエリは `(厚生労働省 OR デジタル庁 OR 政府広報)
 * (広告 OR CM OR キャンペーン ...)` のように主体で引くため、
 * 献血キャンペーンや腰痛予防キャンペーンのようなマイナ無関係の広報も釣れる。
 * 実際に混入したので、対象語を含むかどうかで門を作る。
 *
 * 医療IT・サイバーは、マイナ語を含まなくても対象（仕様§5.5）。
 * ただし医療機関・健保・医療ベンダーに限る。
 */
export const TOPIC_TERMS =
  /マイナ|マイナンバー|個人番号|保険証|オンライン資格確認|オン資|資格確認書|資格情報のお知らせ|マイナポータル|公金受取口座|電子証明書|JPKI|公的個人認証|PMH|電子処方箋|顔認証付きカードリーダー|医療保険情報/;

export const MEDICAL_CYBER_SUBJECT =
  /病院|診療所|クリニック|医療法人|医療センター|健康保険組合|健保|医師会|薬局|電子カルテ|地域医療連携|特定保健指導|レセプト|診療報酬|大学病院|医科|歯科/;

export function isInScope(record) {
  const text = `${record.title ?? ''} ${record.excerpt ?? ''}`;
  if (TOPIC_TERMS.test(text)) return true;

  // 医療機関・健保のセキュリティ事案は、マイナ語が無くても監視対象
  if (
    (record.eventClass === 'security_incident' || record.domain === 'medical_it' || record.domain === 'cybersecurity') &&
    MEDICAL_CYBER_SUBJECT.test(text)
  ) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ 本体 */

/**
 * 取得済みページ1件から構造化事実を作る。
 *
 * 本文が取れていない場合（fetch_failed / pdf / robots）は、
 * 事実を作らず `usableForFacts: false` を立てる。
 * スニペットから断定しないための境界。
 */
export function extractFromPage(page, { now, registry, sourceInfo }) {
  const usable = page.status === 'ok' && !page.bodyUnavailable && page.body.length > 80;
  const text = usable ? `${page.title}\n${page.body}` : `${page.candidate?.title ?? ''} ${page.candidate?.snippet ?? ''}`;
  const nowIso = new Date(now).toISOString();
  const fallbackYear = new Date(now).getUTCFullYear();

  /*
   * 公開日はページ側の申告を優先する。
   * 検索結果の日付は当てにならず、1年前の記事が上位に来ることがある。
   */
  const publishedAt = page.publishedAt ?? page.candidate?.publishedAt ?? null;

  return {
    url: page.url,
    finalUrl: page.finalUrl,
    canonicalUrl: page.canonicalUrl ?? page.finalUrl,
    /*
     * 媒体の正体を示すURL。Tier判定と独立媒体数の計算はこちらで行う。
     * 記事リンクが news.google.com のリダイレクトになる候補では、
     * 記事URLでは媒体を判定できない。
     */
    publisherUrl: page.candidate?.publisherUrl ?? page.finalUrl,
    title: (page.title || page.candidate?.title || '').trim(),
    publisher: page.candidate?.publisher ?? '',
    tier: sourceInfo?.tier ?? null,
    sourceType: sourceInfo?.type ?? 'unknown',
    official: Boolean(sourceInfo?.official),

    // 日付は混同せず別に持つ（仕様§1.2）
    occurredAt: usable ? extractOccurredAt(text, fallbackYear) : null,
    publishedAt,
    updatedAt: page.updatedAt ?? null,
    detectedAt: nowIso,

    entity: usable ? extractEntity(text) : null,
    systemLayer: detectSystemLayer(text),
    eventClass: detectEventClass(text),
    domain: detectDomain(text),
    recoveryStatus: usable ? detectRecoveryStatus(text) : 'unknown',
    counts: usable ? extractCounts(text) : [],
    officialDenials: usable ? extractOfficialDenials(text) : [],

    // 本文の先頭を要約の材料として持つ。ここを本文として出さず、compose が使う
    excerpt: usable ? firstSentences(page.body, 3) : '',
    bodyLength: usable ? page.body.length : 0,

    usableForFacts: usable,
    unusableReason: usable ? null : (page.bodyUnavailable ?? page.status),
    discoveredBy: page.candidate?.discoveredBy ?? null,
  };
}

/** 本文の先頭からN文までを取る。要約の材料。 */
export function firstSentences(body, count = 3) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=。)/).filter((s) => s.trim().length > 10);
  return sentences.slice(0, count).join('').slice(0, 600);
}
