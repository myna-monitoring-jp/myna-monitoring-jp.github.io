/**
 * cluster：同一事象への統合と転載除去
 *
 * 記事単位ではなく事象単位にまとめる工程（仕様§7）。
 * ここが無いと、同じ障害の初報・続報・系列転載・Yahoo!転載が
 * 別々のニュースとして並び、「媒体数」も水増しされる。
 *
 * 重要：ニュース規模には `independentMediaCount` を使う。
 * 検索結果件数や `rawArticleCount` を規模の指標にしない。
 */

import { isIndependentOutlet, syndicationGroupOf } from './config.mjs';

/* ---------------------------------------------------------- 正規化と類似度 */

/** 主体名の表記ゆれを潰す。 */
export function normalizeEntity(entity) {
  return String(entity ?? '')
    .replace(/\s+/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/^(公立|市立|県立|国立|一般社団法人|医療法人|株式会社)/, '')
    .toLowerCase();
}

/** 比較用のタイトル。媒体名・記号・助詞のゆれを落とす。 */
export function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/\s+/g, '')
    .replace(/[［］\[\]（）()【】「」『』｜|・:：\-—–ー~〜、。,.!?！？"'’”…]/g, '')
    .toLowerCase();
}

/**
 * 2つの文字列の類似度（0〜1）。
 * 2-gram の Jaccard 係数。日本語は語分割が要らないこの方式が安定する。
 */
export function similarity(a, b) {
  const grams = (text) => {
    const value = normalizeTitle(text);
    const set = new Set();
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
    return set;
  };
  const setA = grams(a);
  const setB = grams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/**
 * 事象の同一性キー。仕様§7.1。
 *
 *   正規化主体 + 事象種別 + 発生日 + システム層
 *
 * 発生日が取れない場合は公開日の日付部分で代用する。ただしその場合は
 * キーが弱くなるので、後段でタイトル類似度による統合も併用する。
 */
export function canonicalKeyOf(record) {
  const entity = normalizeEntity(record.entity) || 'unknown';
  const date = (record.occurredAt ?? record.publishedAt ?? '').slice(0, 10) || 'nodate';
  const layer = normalizeTitle(record.systemLayer) || 'nolayer';
  return `${entity}|${record.eventClass}|${date}|${layer}`;
}

/* ------------------------------------------------------------------ 統合 */

const TITLE_MERGE_THRESHOLD = 0.62;

/**
 * 抽出結果を事象へまとめる。
 *
 * @returns 事象の配列。各事象は `records`（構成する記事）を持つ
 */
export function clusterEvents(records, { registry }) {
  const clusters = [];

  for (const record of records) {
    const key = canonicalKeyOf(record);

    // 1. 同じ canonicalKey があればそこへ
    let target = clusters.find((cluster) => cluster.canonicalKey === key);

    // 2. canonical URL が一致するものがあればそこへ（転載元が同じ）
    if (!target && record.canonicalUrl) {
      target = clusters.find((cluster) =>
        cluster.records.some((r) => r.canonicalUrl && r.canonicalUrl === record.canonicalUrl),
      );
    }

    /*
     * 3. タイトルが十分似ていて、事象種別とシステム層が同じならそこへ。
     *    発生日が取れず canonicalKey が弱いケースを救う。
     *    日付が3日以上離れているものは別事象として扱う。
     */
    if (!target) {
      target = clusters.find(
        (cluster) =>
          cluster.eventClass === record.eventClass &&
          (cluster.systemLayer ?? null) === (record.systemLayer ?? null) &&
          withinDays(cluster.publishedAt, record.publishedAt, 3) &&
          cluster.records.some((r) => similarity(r.title, record.title) >= TITLE_MERGE_THRESHOLD),
      );
    }

    if (target) {
      target.records.push(record);
      // 発生日は最も古いものを採る（初報が最も発生に近い）
      if (record.occurredAt && (!target.occurredAt || record.occurredAt < target.occurredAt)) {
        target.occurredAt = record.occurredAt;
      }
      // 公開日は最も新しいものを採る（最新の続報）
      if (record.publishedAt && (!target.publishedAt || record.publishedAt > target.publishedAt)) {
        target.publishedAt = record.publishedAt;
      }
      if (record.updatedAt && (!target.updatedAt || record.updatedAt > target.updatedAt)) {
        target.updatedAt = record.updatedAt;
      }
      // 主体・システム層は、取れているものを優先して埋める
      target.entity ??= record.entity;
      target.systemLayer ??= record.systemLayer;
      continue;
    }

    clusters.push({
      canonicalKey: key,
      entity: record.entity,
      eventClass: record.eventClass,
      domain: record.domain,
      systemLayer: record.systemLayer,
      occurredAt: record.occurredAt,
      publishedAt: record.publishedAt,
      updatedAt: record.updatedAt,
      detectedAt: record.detectedAt,
      records: [record],
    });
  }

  return clusters.map((cluster) => ({ ...cluster, ...countMedia(cluster.records, registry) }));
}

function withinDays(a, b, days) {
  if (!a || !b) return true; // 日付不明なら日付では弾かない
  return Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86400000;
}

/**
 * 媒体数を数える。ここが水増し防止の要。
 *
 *  - `rawArticleCount`        見つかったページ数
 *  - `independentMediaCount`  独立取材・独立編集と判断した媒体数
 *  - `majorMediaCount`        Tier 1（主要全国媒体）の数
 *  - `syndicatedCount`        転載と判断した数
 *
 * 系列（FNN、日テレ、TBS、テレ朝、共同、時事）は1媒体として数える。
 * Yahoo!転載・PR TIMES転載は独立媒体に数えない。
 */
export function countMedia(records, registry) {
  const independentHosts = new Set();
  const majorHosts = new Set();
  const syndicationGroups = new Set();
  let syndicated = 0;

  for (const record of records) {
    /*
     * 媒体の判定には publisherUrl を使う。
     * 記事リンクが news.google.com のリダイレクトの場合、記事URLでは
     * どの媒体か分からず、独立媒体数が常に0になってしまう。
     */
    const url = record.publisherUrl || record.canonicalUrl || record.finalUrl || record.url;
    const group = syndicationGroupOf(url);

    if (group) {
      // 系列は1つとして数える。2件目以降は転載として計上
      if (syndicationGroups.has(group)) {
        syndicated += 1;
        continue;
      }
      syndicationGroups.add(group);
    }

    if (!isIndependentOutlet(registry, url)) {
      if (!record.official) syndicated += 1;
      continue;
    }

    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    independentHosts.add(host);
    if (record.tier === 1) majorHosts.add(host);
  }

  return {
    rawArticleCount: records.length,
    independentMediaCount: independentHosts.size,
    majorMediaCount: majorHosts.size,
    syndicatedCount: syndicated,
  };
}
