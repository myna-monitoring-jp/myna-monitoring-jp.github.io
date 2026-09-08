/**
 * discover：発見検索
 *
 * `config/query_catalog.yml` を読み、仕様§4 の5パスを組み立てて実行する。
 * ここで作るのは「URL候補」だけ。本文は fetch 工程が取る。
 * スニペットだけで事実を確定しないため、この工程は判断をしない。
 *
 * 全クエリを検索ログへ残す（仕様§18）。何を探して何が出なかったかが
 * 分からないと、取りこぼしが選定の問題か収集の問題か切り分けられない。
 */

import { classifySource } from './config.mjs';
import { extractIndexLinks } from './feed.mjs';

const GOOGLE_NEWS = 'https://news.google.com/rss/search';

/** 5つのパス。仕様§4 の A〜E に対応する。 */
export const PASSES = {
  A: 'broad_discovery',
  B: 'primary_source_lookup',
  C: 'event_deep_dive',
  D: 'reaction_check',
  E: 'follow_up_close',
};

/* ---------------------------------------------------------------- 小道具 */

export const googleNewsUrl = (query, hours) => {
  const url = new URL(GOOGLE_NEWS);
  // Google News の when: 演算子で時間窓を絞る。h=時間、d=日
  const scoped = hours && hours <= 48 ? `${query} when:${hours}h` : hours ? `${query} when:${Math.ceil(hours / 24)}d` : query;
  url.searchParams.set('q', scoped);
  url.searchParams.set('hl', 'ja');
  url.searchParams.set('gl', 'JP');
  url.searchParams.set('ceid', 'JP:ja');
  return url.toString();
};

/** テンプレートの `{name}` を埋める。値が無いプレースホルダが残る組み合わせは捨てる。 */
export function fillTemplate(template, values) {
  let filled = String(template);
  for (const [key, value] of Object.entries(values)) {
    filled = filled.replaceAll(`{${key}}`, String(value));
  }
  return /\{[a-z_]+\}/i.test(filled) ? null : filled;
}

/* ------------------------------------------------------------ クエリ組み立て */

/**
 * 実行するクエリの一覧を組む。
 *
 * @param {any} catalog config/query_catalog.yml
 * @param {{events?: any[]}} [previous] 前日の事象台帳。Pass C/D/E はこれが無いと組めない
 * @returns {{query: string, pass: string, purpose: string, windowHours: number}[]}
 */
export function buildQueries(catalog, previous = { events: [] }) {
  const windows = catalog.windows ?? {};
  const primary = windows.primary_hours ?? 24;
  const backfill = windows.backfill_hours ?? 72;
  const trendDays = windows.trend_days ?? 7;
  const groups = catalog.query_groups ?? {};
  const queries = [];

  const add = (query, pass, purpose, hours) => {
    if (!query) return;
    queries.push({ query, pass, purpose, windowHours: hours });
  };

  /* --- Pass A：広域発見。24時間と72時間の2本立てで索引遅延を回収する --- */
  for (const query of groups.broad_discovery?.queries ?? []) {
    add(query, PASSES.A, 'broad_discovery_24h', primary);
    add(query, PASSES.A, 'broad_discovery_72h', backfill);
  }
  for (const key of ['online_eligibility', 'portal_and_app', 'card_and_certificate', 'public_money_account', 'medical_it_cyber', 'public_relations']) {
    for (const query of groups[key]?.queries ?? []) {
      add(query, PASSES.A, key, backfill);
    }
  }

  /* --- Pass B：一次情報探索。前日案件と広域で出た固有語で site: 検索する --- */
  const keywords = primaryLookupKeywords(catalog, previous);
  for (const template of groups.official_sources?.templates ?? []) {
    for (const keyword of keywords) {
      add(fillTemplate(template, { keyword }), PASSES.B, 'primary_source_lookup', trendDays * 24);
    }
  }

  /* --- 自治体。一般ニュース検索では漏れるため別バッチ（仕様§5.4） --- */
  for (const query of groups.local_government_incidents?.queries ?? []) {
    /*
     * 自治体の周知は Google News の索引が10〜85日遅れる（2026-09-03 実測）。
     * 報道と同じ窓では1件も通らないため、ここだけ30日で引く。
     */
    add(query, PASSES.A, 'local_government_incidents', 30 * 24);
  }

  /* --- Pass C：深掘り。重要度が高い、または不明項目が残る事象だけ --- */
  for (const event of eventsNeedingDeepDive(previous)) {
    for (const suffix of ['影響人数', '復旧', '原因', '対象者', 'お詫び', '再発防止']) {
      add(`"${event.title}" ${suffix}`, PASSES.C, `deep_dive:${event.id}`, trendDays * 24);
    }
  }

  /* --- Pass D：反応。上位案件と広報案件だけ（仕様§4 Pass D） --- */
  const reactionLimit = catalog.selection_rules?.reaction_analysis_top_event_count ?? 8;
  for (const event of eventsForReaction(previous, reactionLimit)) {
    for (const template of groups.sentiment_and_reaction?.templates ?? []) {
      add(
        fillTemplate(template, {
          campaign_name: event.title,
          event_name: event.title,
          campaign_copy: event.campaignCopy ?? '',
          official_post_url: event.officialPostUrl ?? '',
        }),
        PASSES.D,
        `reaction:${event.id}`,
        trendDays * 24,
      );
    }
  }

  /* --- Pass E：前日の要注視・続報待ちのクローズ確認。毎日必ず回す --- */
  for (const event of eventsNeedingClose(previous)) {
    for (const template of groups.follow_up?.templates ?? []) {
      add(fillTemplate(template, { event_name: event.title }), PASSES.E, `follow_up:${event.id}`, trendDays * 24);
    }
  }

  // 同じクエリを重複実行しない（テンプレート展開で衝突する）
  const seen = new Set();
  return queries.filter((entry) => {
    const key = `${entry.query}|${entry.windowHours}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pass B で使う固有語。
 *
 * 前日案件の主体名を優先する。site: 検索は組み合わせ数が爆発しやすく
 * （テンプレート12本 × 固有語12語 = 144本）、大半が空振りになる。
 * 実際に追跡すべき固有語だけに絞る。
 */
function primaryLookupKeywords(catalog, previous, limit = 4) {
  const keywords = new Set();
  for (const event of previous.events ?? []) {
    // 追跡する価値があるものだけ。沈静化・アーカイブは除く
    if (event.status === 'quiet' || event.status === 'archived') continue;
    if (event.entity) keywords.add(event.entity);
  }
  // 前日案件が無い初回でも動くよう、中心的な制度名を少数入れる
  for (const term of ['マイナ保険証', 'オンライン資格確認', '資格確認書']) keywords.add(term);
  return [...keywords].slice(0, limit);
}

/** 深掘りが必要な事象：重要度が高い、または不明項目が残っているもの。 */
function eventsNeedingDeepDive(previous) {
  return (previous.events ?? [])
    .filter((event) => (event.impactScore ?? 0) >= 40 || (event.unknowns ?? []).length > 0)
    .filter((event) => event.status !== 'archived')
    .slice(0, 10);
}

/** 反応を見る事象：話題度の高い順。広報案件は優先する。 */
function eventsForReaction(previous, limit) {
  return [...(previous.events ?? [])]
    .filter((event) => event.status !== 'archived' && event.status !== 'quiet')
    .sort((a, b) => {
      const prA = a.eventClass === 'public_communication' ? 1 : 0;
      const prB = b.eventClass === 'public_communication' ? 1 : 0;
      if (prA !== prB) return prB - prA;
      return (b.attentionScore ?? 0) - (a.attentionScore ?? 0);
    })
    .slice(0, limit);
}

/** クローズ確認が必要な事象：要注視・続報待ち・改善中。 */
function eventsNeedingClose(previous) {
  const OPEN = new Set(['attention', 'follow_up', 'improving', 'planned']);
  return (previous.events ?? []).filter((event) => OPEN.has(event.status)).slice(0, 12);
}

/* ------------------------------------------------------------------ 実行 */

/**
 * 官公庁の公式フィードと定点観測URLから候補を作る。
 *
 * こちらは**実URLが得られるので本文を取得できる**。事実確定の材料はここから来る。
 * Google News 経由の候補（下の newsSearch）とは性質が違うので分けている。
 */
export async function discoverFetchable({ registry, catalog, now, fetchText, parseFeed, logSink }) {
  const keyword = buildKeywordFilter(catalog);
  const candidates = [];
  const queryLogs = [];
  const errors = [];

  for (const feed of registry.fetchable_feeds ?? []) {
    const executedAt = new Date(now).toISOString();
    let items = [];
    try {
      items = parseFeed(await fetchText(feed.url));
    } catch (error) {
      errors.push(`${feed.label}（${feed.url}）: ${error.message}`);
    }

    const matched = items.filter((item) => !keyword || keyword.test(`${item.title} ${item.description}`));
    for (const item of matched) {
      candidates.push({
        url: item.link,
        title: item.title,
        publishedAt: item.pubDate,
        publisherUrl: feed.url,
        publisher: feed.publisher ?? feed.label,
        snippet: item.description ?? '',
        tier: feed.tier ?? 0,
        fetchable: true,
        discoveredBy: { pass: PASSES.B, purpose: `official_feed:${feed.id}`, query: feed.url },
        discoveredAt: executedAt,
      });
    }

    const log = {
      query: feed.url,
      purpose: `official_feed:${feed.id}`,
      provider: 'official_rss',
      executedAt,
      resultCount: items.length,
      selectedUrls: matched.map((item) => item.link),
      newMaterialEventCount: 0,
    };
    queryLogs.push(log);
    if (logSink) logSink(log);
  }

  for (const page of registry.watch_urls ?? []) {
    const executedAt = new Date(now).toISOString();
    const selected = [];

    /*
     * link_pattern がある場合は一覧ページとして扱い、子リンクを候補にする。
     *
     * RSSを持たない重要な情報源が多く、ここを見ていなかったために
     * 政府広報のCM・新聞広告と、地方厚生局の災害時受診特例の事務連絡を
     * 丸ごと取りこぼしていた（2026-09-08 に判明）。
     */
    if (page.link_pattern) {
      try {
        const html = await fetchText(page.url);
        const pattern = new RegExp(page.link_pattern);
        /*
         * キーワードでの絞り込みを件数制限より前に渡す。
         * 逆にするとページ先頭のナビゲーションで枠を使い切る。
         */
        const links = extractIndexLinks(
          html,
          page.url,
          pattern,
          page.max_links ?? 40,
          keyword ? (text) => keyword.test(text) : undefined,
        );

        for (const link of links) {
          candidates.push({
            url: link.url,
            // アンカー文字列を仮の表題にする。取得後にページ側の表題で上書きされる
            title: link.text || page.label,
            publishedAt: null,
            publisherUrl: page.url,
            publisher: page.publisher ?? page.label,
            snippet: '',
            tier: page.tier ?? 0,
            fetchable: true,
            systemLayerHint: page.system_layer ?? null,
            // 情報源が種別を決められる場合の指定（政府広報の掲載物など）
            eventClassHint: page.event_class ?? null,
            discoveredBy: { pass: PASSES.B, purpose: `watch_index:${page.id}`, query: page.url },
            discoveredAt: executedAt,
          });
          selected.push(link.url);
        }
      } catch (error) {
        errors.push(`${page.label}（${page.url}）: ${error.message}`);
      }
    }

    // 一覧ページ自体も見る場合（稼働状況ページなど、ページそのものが情報）
    if (page.fetch_self !== false) {
      candidates.push({
        url: page.url,
        title: page.label,
        publishedAt: null,
        publisherUrl: page.url,
        publisher: page.publisher ?? page.label,
        snippet: '',
        tier: page.tier ?? 0,
        fetchable: true,
        systemLayerHint: page.system_layer ?? null,
        eventClassHint: page.event_class ?? null,
        discoveredBy: { pass: PASSES.B, purpose: `watch_url:${page.id}`, query: page.url },
        discoveredAt: executedAt,
      });
      selected.push(page.url);
    }

    const log = {
      query: page.url,
      purpose: page.link_pattern ? `watch_index:${page.id}` : `watch_url:${page.id}`,
      provider: 'watch_url',
      executedAt,
      resultCount: selected.length,
      selectedUrls: selected,
      newMaterialEventCount: 0,
    };
    queryLogs.push(log);
    if (logSink) logSink(log);
  }

  return { candidates, queryLogs, errors };
}

/** キーワード絞り込み。官公庁の新着には無関係な記事が大量に混ざる。 */
function buildKeywordFilter(catalog) {
  const terms = [...(catalog.common_terms?.systems ?? []), 'マイナンバー', '保険証'];
  if (terms.length === 0) return null;
  return new RegExp(terms.map((term) => String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
}

/**
 * クエリを実行して候補を返す。
 *
 * 検索プロバイダーは差し替え可能にしてある（`SEARCH_PROVIDER`）。
 * 既定は Google News RSS で、APIキーを必要としない。
 * キーが無くても動くことは仕様§3.1の要件。
 *
 * **ここで得た候補は本文を取得できない。** news.google.com は robots.txt で
 * 全面拒否されており、記事IDから元URLも復元できない（2026-09-07 実測）。
 * したがって発見と媒体数の把握にのみ使い、`fetchable: false` を立てる。
 * 事実の確定は discoverFetchable の候補で行う。
 *
 * @returns {{candidates: Array, queryLogs: Array, errors: Array}}
 */
export async function discover({
  catalog,
  registry,
  previous = { events: [] },
  now,
  fetchText,
  parseFeed,
  maxResultsPerQuery,
  logSink,
}) {
  const rules = catalog.selection_rules ?? {};
  const perQuery = maxResultsPerQuery ?? rules.max_broad_results_per_query ?? 20;

  const plan = buildQueries(catalog, previous);
  const candidates = [];
  const queryLogs = [];
  const errors = [];
  const seenUrls = new Set();

  for (const entry of plan) {
    const executedAt = new Date(now).toISOString();
    let items = [];
    try {
      items = parseFeed(await fetchText(googleNewsUrl(entry.query, entry.windowHours)));
    } catch (error) {
      errors.push(`検索「${entry.query}」: ${error.message}`);
      queryLogs.push({
        query: entry.query,
        purpose: entry.purpose,
        provider: 'google_news_rss',
        executedAt,
        resultCount: 0,
        selectedUrls: [],
        newMaterialEventCount: 0,
      });
      continue;
    }

    const selected = [];
    for (const item of items.slice(0, perQuery)) {
      const url = item.link;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      selected.push(url);
      candidates.push({
        url,
        title: item.title,
        publishedAt: item.pubDate ?? null,
        // Google News が媒体のトップURLを返すので、Tier判定はこちらで行う
        publisherUrl: item.sourceUrl ?? '',
        publisher: item.publisher ?? '',
        snippet: item.description ?? '',
        tier: classifySource(registry, item.sourceUrl || url).tier,
        // 本文は取得できない。発見と媒体数の把握のみに使う
        fetchable: false,
        discoveredBy: { pass: entry.pass, purpose: entry.purpose, query: entry.query },
        discoveredAt: executedAt,
      });
    }

    const log = {
      query: entry.query,
      purpose: entry.purpose,
      provider: 'google_news_rss',
      executedAt,
      resultCount: items.length,
      selectedUrls: selected,
      // 重要事象数は cluster 後にしか分からないので、ここでは0で置く
      newMaterialEventCount: 0,
    };
    queryLogs.push(log);
    if (logSink) logSink(log);
  }

  return { candidates, queryLogs, errors, plannedQueryCount: plan.length };
}
