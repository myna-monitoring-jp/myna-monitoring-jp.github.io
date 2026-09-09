/**
 * novelty：新規性の判定
 *
 * この工程が無かったために、2026-09-08 の台帳22件が
 * **全件「既知の更新」** になっていた。内訳は次のとおり。
 *
 *   - 政府広報の常設解説ページ 11件（2024年7月〜2026年3月掲載。毎日同じものが出る）
 *   - デジタル庁の常設ページ・ダッシュボード 4件
 *   - 前日から引き継いだ報道 6件
 *   - アプリストア評価 1件
 *
 * 当日の新規報道（マイナアプリ提供開始・マイナ救急の全国開始・大雨被災者の
 * 受診特例・避難所受付の実証実験・カード画像を要求する不審電話）は
 * 1件も入っていなかった。種別を表題から判定できず `other` になり、
 * `run-research.mjs` が `other` を捨てていたためである。
 *
 * ここでは「載せるかどうか」を日付で決める。判定は次の順。
 *
 *   1. 日単位の日付が取れる  → 窓内なら新規、窓外なら古い
 *   2. 年月しか取れない      → 当月・前月なら新規、それ以前は常設扱い
 *      （政府広報のURLは `/article/202508/` のように掲載年月を含む）
 *   3. どちらも取れない      → 定点観測ページなら常に対象、それ以外は常設扱い
 *
 * 常設扱いにしたものは台帳へ入れないが、理由付きで run ログへ残す。
 * 「選定で落ちた」のか「収集できていない」のかを後から切り分けるため（仕様§18）。
 */

import { parseJapaneseDate } from './fetch.mjs';

export const NOVELTY = {
  /** 当日〜窓内の新しい動き。台帳に載せる */
  FRESH: 'fresh',
  /** 定点観測の対象。日付が無くても毎日載せる */
  OBSERVED: 'observed',
  /** 掲載日が窓より古い。台帳に載せない */
  STALE: 'stale',
  /** 掲載日が無く、内容も変わらない常設ページ。台帳に載せない */
  STANDING: 'standing',
};

/* ---------------------------------------------------------------- 日付の手掛かり */

/**
 * URLから掲載年月を拾う。
 *
 * 政府広報オンラインは `/article/202508/entry-8677.html`、
 * `/media/commercials/202609/video-313937.html` のように
 * パスに掲載年月を持つ。日単位は取れないので月単位で扱う。
 *
 * @returns {{year: number, month: number} | null}
 */
export function urlMonthHint(url) {
  const path = String(url ?? '');
  // /202609/ 形式
  const compact = path.match(/\/((?:19|20)\d{2})(0[1-9]|1[0-2])\//);
  if (compact) return { year: Number(compact[1]), month: Number(compact[2]) };
  // /2026/09/ 形式
  const split = path.match(/\/((?:19|20)\d{2})\/(0[1-9]|1[0-2])\//);
  if (split) return { year: Number(split[1]), month: Number(split[2]) };
  return null;
}

/**
 * 表題から日付を拾う。
 *
 * 厚生局の事務連絡はPDFで本文を取れないが、表題に
 * 「令和8年6月24日事務連絡」のように日付が入っている。
 * `parseJapaneseDate` は素の文字列に `Date.parse` を掛けるため、
 * 日付部分だけを切り出してから渡す。
 */
export function titleDateHint(title) {
  const text = String(title ?? '');
  const matched = text.match(/(?:令和|平成)\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/) ?? text.match(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/);
  return matched ? parseJapaneseDate(matched[0]) : null;
}

/**
 * 抽出した公開日とURLの掲載年月を突き合わせて、確からしい方を返す。
 *
 * 政府広報オンラインは**全ページが `publishedAt: 2024-01-01` を申告する**
 * （2026-09-08 実測。サイト全体で同じ定数が入っている）。そのままだと
 * `/media/commercials/202609/` の2026年9月公開のCMまで982日前の古い物として
 * 扱われ、まさに見たい項目が落ちる。
 *
 * 自分のURLパスに入っている年月より前に公開されることはあり得ないので、
 * **URLの年月が申告日より新しい場合はURLを信じる**（その月の1日として扱う）。
 * 逆にURLの方が古い場合は申告日を信じる（記事の更新で日付が進むのは自然）。
 */
export function reconcilePublishedAt(publishedAt, url) {
  const hint = urlMonthHint(url);
  if (!hint) return isoOrNull(publishedAt) ?? null;
  const monthStart = `${hint.year}-${String(hint.month).padStart(2, '0')}-01T00:00:00.000Z`;
  const declared = isoOrNull(publishedAt);
  if (!declared) return monthStart;
  return declared >= monthStart ? declared : monthStart;
}

/** 有効な ISO 日時だけを返す。 */
function isoOrNull(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** 月差。同月なら0、前月なら1。 */
function monthsAgo(hint, nowIso) {
  const now = new Date(nowIso);
  return (now.getUTCFullYear() - hint.year) * 12 + (now.getUTCMonth() + 1 - hint.month);
}

/* ------------------------------------------------------------------ 本体 */

/**
 * 新規性を判定する。
 *
 * @param {{canonicalKey?: string, title?: string, publishedAt?: string|null,
 *          updatedAt?: string|null, occurredAt?: string|null, urls?: string[],
 *          dailyObservation?: boolean}} subject
 * @param {{nowIso: string, windowDays?: number, dailyObservationUrls?: Set<string>}} options
 * @returns {{verdict: string, reason: string, dateBasis: string|null, observedDate: string|null}}
 */
export function judgeNovelty(subject, { nowIso, windowDays = 7, dailyObservationUrls } = {}) {
  const urls = (subject.urls ?? []).filter(Boolean);

  /*
   * 定点観測ページ（稼働状況・普及ダッシュボード）は掲載日を持たない。
   * 日付が無いことを理由に落とすと「マイナポータルAPIは正常稼働」
   * 「カード保有率84.3%」のような押さえておくべき動きが消える。
   */
  const observed =
    subject.dailyObservation === true ||
    (dailyObservationUrls && urls.some((url) => dailyObservationUrls.has(url)));

  const stale = (reason, dateBasis, observedDate = null) =>
    observed
      ? { verdict: NOVELTY.OBSERVED, reason: '定点観測の対象', dateBasis, observedDate }
      : { verdict: NOVELTY.STALE, reason, dateBasis, observedDate };

  /* --- 日単位の日付 --- */
  const dayCandidates = [
    { basis: 'updatedAt', value: isoOrNull(subject.updatedAt) },
    { basis: 'publishedAt', value: isoOrNull(subject.publishedAt) },
    { basis: 'occurredAt', value: isoOrNull(subject.occurredAt) },
    { basis: 'title', value: titleDateHint(subject.title) },
  ].filter((entry) => entry.value);
  const newestDay = dayCandidates.length > 0 ? dayCandidates.reduce((best, entry) => (entry.value > best.value ? entry : best)) : null;

  /* --- 年月だけの手掛かり（政府広報のURLは `/article/202508/` 形式） --- */
  const monthHints = urls.map((url) => urlMonthHint(url)).filter(Boolean);
  const closestMonth =
    monthHints.length > 0 ? monthHints.reduce((best, hint) => (monthsAgo(hint, nowIso) < monthsAgo(best, nowIso) ? hint : best)) : null;

  /*
   * どちらを信じるか。
   *
   * 政府広報オンラインは**全ページが `publishedAt: 2024-01-01` を申告する**
   * （2026-09-08 実測。サイト全体で同じ定数が入っている）。自分のURLパスに
   * ある年月より前に公開されることはあり得ないので、URLの年月が申告日より
   * 新しければURLを採る。
   *
   * そのうえで**URLを採ったときは月単位で判定する**。`/202609/` からは
   * 「2026年9月のどこか」しか分からず、日単位の窓に当てると当月の掲載物が
   * 月末に向かって順に古い物へ変わってしまう。実際に9月9日時点で
   * 9月公開のマイナアプリCMが「8日前」として落ちた。
   */
  const monthStart = closestMonth
    ? `${closestMonth.year}-${String(closestMonth.month).padStart(2, '0')}-01T00:00:00.000Z`
    : null;
  const useMonth = Boolean(monthStart) && (!newestDay || newestDay.value < monthStart);

  if (useMonth) {
    const gap = monthsAgo(closestMonth, nowIso);
    const label = `${closestMonth.year}年${closestMonth.month}月`;
    // 当月・前月の掲載物を新規として扱う
    if (gap <= 1) {
      return { verdict: NOVELTY.FRESH, reason: `URLの掲載年月が${label}（当月・前月）`, dateBasis: 'urlMonth', observedDate: monthStart };
    }
    return stale(`URLの掲載年月が${label}で${gap}か月前`, 'urlMonth', monthStart);
  }

  if (newestDay) {
    const ageDays = (Date.parse(nowIso) - Date.parse(newestDay.value)) / 86400000;
    if (ageDays <= windowDays) {
      return { verdict: NOVELTY.FRESH, reason: `${newestDay.basis} が${windowDays}日以内`, dateBasis: newestDay.basis, observedDate: newestDay.value };
    }
    return stale(`${newestDay.basis} が${Math.floor(ageDays)}日前で窓（${windowDays}日）より古い`, newestDay.basis, newestDay.value);
  }

  /* --- 日付の手掛かりが無い --- */
  if (observed) return { verdict: NOVELTY.OBSERVED, reason: '定点観測の対象', dateBasis: null, observedDate: null };
  return { verdict: NOVELTY.STANDING, reason: '掲載日を特定できない常設ページ', dateBasis: null, observedDate: null };
}

/** 台帳に載せてよい判定か。 */
export const isLedgerWorthy = (verdict) => verdict === NOVELTY.FRESH || verdict === NOVELTY.OBSERVED;

/** クラスタを judgeNovelty が読める形に直す。 */
export function noveltySubjectOfCluster(cluster) {
  return {
    canonicalKey: cluster.canonicalKey,
    title: cluster.title ?? cluster.records?.[0]?.title ?? '',
    publishedAt: cluster.publishedAt ?? newestOf(cluster.records, 'publishedAt'),
    updatedAt: cluster.updatedAt ?? newestOf(cluster.records, 'updatedAt'),
    occurredAt: cluster.occurredAt ?? null,
    urls: (cluster.records ?? []).map((record) => record.finalUrl || record.canonicalUrl || record.url),
    dailyObservation: cluster.dailyObservation === true,
  };
}

/** 引き継ぎ事象を judgeNovelty が読める形に直す。 */
export function noveltySubjectOfEvent(event) {
  return {
    canonicalKey: event.canonicalKey,
    title: event.title ?? '',
    publishedAt: event.publishedAt ?? null,
    updatedAt: event.updatedAt ?? null,
    occurredAt: event.occurredAt ?? null,
    urls: (event.sources ?? []).map((source) => source.finalUrl || source.url),
    dailyObservation: event.dailyObservation === true,
  };
}

function newestOf(records, field) {
  const values = (records ?? []).map((record) => isoOrNull(record?.[field])).filter(Boolean);
  return values.length > 0 ? values.sort().at(-1) : null;
}
