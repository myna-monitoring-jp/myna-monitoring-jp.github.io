/**
 * fetch：本文取得
 *
 * 現行実装に無かった工程で、品質問題の大半の原因がここだった。
 * 見出しとスニペットだけで項目を作っていたため、
 *   - 1年前の記事を「本日の新規」として扱う
 *   - 概要が表題の焼き直しにしかならない
 *   - 一次情報へ戻れない
 * が起きていた。
 *
 * この工程は判断をしない。取れたものと取れなかったものを区別して返すだけ。
 * 取得に失敗したものは `fetch_failed` とし、スニペットから断定させない（仕様§3.2）。
 *
 * PDFの本文抽出は行わない。日本語PDFはCIDフォントが主で、簡易抽出では
 * 文字化けした本文を後段へ渡してしまう。URLは出典として残し、
 * `bodyUnavailable: 'pdf'` を立てて事実確定には使わせない。
 */

import { createHash } from 'node:crypto';

/* ---------------------------------------------------------------- 小道具 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const urlKey = (url) => createHash('sha1').update(String(url)).digest('hex').slice(0, 16);

/** HTMLの実体参照を戻す。タグを落とす前に行う（順序を逆にすると生タグが本文に残る）。 */
export function decodeEntities(text) {
  let current = String(text ?? '');
  for (let pass = 0; pass < 3; pass += 1) {
    const next = current
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&amp;/g, '&');
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** 本文らしい部分を抜き出す。<main> / <article> があればそこを優先する。 */
export function extractBody(html, maxChars = 20000) {
  const source = String(html ?? '');
  const scoped =
    source.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ??
    source.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ??
    source;

  /*
   * 実体参照を戻すのはタグ落としの「前」。
   * 順序を逆にすると、実体参照で包まれていたタグが復元されて
   * `<a href="x">` が本文に文字列として残る。
   */
  const text = decodeEntities(scoped)
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // ブロック要素の境界を改行にして、文の連結を防ぐ
    .replace(/<\/(p|div|li|tr|h[1-6]|section)[^>]*>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.slice(0, maxChars);
}

export function extractTitle(html) {
  const source = String(html ?? '');
  const og = source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const title = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * ページ自身が主張する公開日時・更新日時を取る。
 *
 * ここが最重要。検索結果の日付は当てにならず、実際に1年前の記事が
 * 上位に来ることがある（2026-09 に東京新聞の2025-07記事で発生）。
 * ページ側の申告を優先し、取れなければ null にして「日付不明」として扱う。
 */
export function extractDates(html) {
  const source = String(html ?? '');
  const pick = (patterns) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        const parsed = parseJapaneseDate(decodeEntities(match[1]));
        if (parsed) return parsed;
      }
    }
    return null;
  };

  const published = pick([
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:pubdate|publishdate|date)["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
    // 官公庁ページは本文に「令和8年9月7日」形式で書くことが多い
    /(?:掲載日|公表日|公開日|更新日)[^0-9令平]{0,6}((?:令和|平成)?\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
  ]);

  const updated = pick([
    /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
    /"dateModified"\s*:\s*"([^"]+)"/i,
    /(?:最終更新|更新日)[^0-9令平]{0,6}((?:令和|平成)?\s*\d{1,2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
  ]);

  return { publishedAt: published, updatedAt: updated };
}

/**
 * 日本の元号表記とISO表記の両方を受ける。
 * 令和は2019年が元年（令和N年 = 2018 + N）。
 */
export function parseJapaneseDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const era = text.match(/(令和|平成)\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (era) {
    const base = era[1] === '令和' ? 2018 : 1988;
    const year = base + Number(era[2]);
    return toIso(year, Number(era[3]), Number(era[4]));
  }

  const western = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (western) return toIso(Number(western[1]), Number(western[2]), Number(western[3]));

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    // 極端な値は誤抽出とみなす（1990年より前、1年より先）
    const time = new Date(parsed);
    const year = time.getUTCFullYear();
    if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
    return time.toISOString();
  }
  return null;
}

function toIso(year, month, day) {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  // JST の 0時として扱う
  const date = new Date(Date.UTC(year, month - 1, day, -9, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** canonical URL。転載判定に使う。 */
export function extractCanonicalUrl(html, finalUrl) {
  const source = String(html ?? '');
  const link = source.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const og = source.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  const value = link?.[1] ?? og?.[1] ?? '';
  try {
    return new URL(decodeEntities(value), finalUrl).toString();
  } catch {
    return finalUrl;
  }
}

/* ------------------------------------------------------------ robots.txt */

/**
 * robots.txt の Disallow を素朴に見る。
 *
 * 完全な実装ではないが、明示的に拒否されているパスを取りに行かないための最低限。
 * 取得できない場合は「許可」として扱う（robots が無いサイトを止めないため）。
 */
export function createRobotsChecker({ fetchText, userAgent }) {
  const cache = new Map();

  const load = async (origin) => {
    if (cache.has(origin)) return cache.get(origin);
    let rules = { disallow: [] };
    try {
      const text = await fetchText(`${origin}/robots.txt`);
      rules = parseRobots(text, userAgent);
    } catch {
      // robots.txt が無い・取れないサイトは制限なしとして扱う
    }
    cache.set(origin, rules);
    return rules;
  };

  return async function isAllowed(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const rules = await load(parsed.origin);
    const path = `${parsed.pathname}${parsed.search}`;
    return !rules.disallow.some((rule) => rule && path.startsWith(rule));
  };
}

export function parseRobots(text, userAgent = '*') {
  const lines = String(text ?? '').split(/\r?\n/);
  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && key === 'disallow') {
      current.hasRules = true;
      if (value) current.disallow.push(value);
    } else if (current && key === 'allow') {
      current.hasRules = true;
    }
  }

  const agent = String(userAgent).toLowerCase();
  // 自分向けの指定を優先し、無ければ * を使う
  const specific = groups.find((group) => group.agents.some((a) => a !== '*' && agent.includes(a)));
  const wildcard = groups.find((group) => group.agents.includes('*'));
  return { disallow: (specific ?? wildcard)?.disallow ?? [] };
}

/* ------------------------------------------------------------------ 本体 */

/**
 * 候補URLの本文を取得する。
 *
 * @returns 候補ごとに1件。成功でも失敗でも必ず1件返す（欠落を隠さない）。
 */
export async function fetchPages({
  candidates,
  config,
  now,
  cache = new Map(),
  fetchImpl = fetch,
  onProgress,
}) {
  const settings = config?.fetch ?? {};
  const concurrency = Math.max(1, settings.concurrency ?? 4);
  const timeoutMs = (settings.timeout_seconds ?? 20) * 1000;
  const retries = settings.retries ?? 2;
  const retryDelay = settings.retry_delay_ms ?? 1500;
  const maxBody = settings.max_body_chars ?? 20000;
  const userAgent = settings.user_agent ?? 'myna-monitoring-portal/2.0';
  const cacheMs = (settings.cache_hours ?? 72) * 3600 * 1000;

  const rawFetch = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { 'user-agent': userAgent, 'accept-language': 'ja' },
        redirect: 'follow',
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchTextOnly = async (url) => {
    const response = await rawFetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  };

  const isAllowed = settings.respect_robots
    ? createRobotsChecker({ fetchText: fetchTextOnly, userAgent })
    : async () => true;

  const nowMs = new Date(now).getTime();

  async function fetchOne(candidate) {
    const key = urlKey(candidate.url);
    const cached = cache.get(key);
    if (cached && nowMs - new Date(cached.fetchedAt).getTime() < cacheMs) {
      return { ...cached, fromCache: true, candidate };
    }

    if (!(await isAllowed(candidate.url))) {
      return {
        candidate,
        url: candidate.url,
        finalUrl: candidate.url,
        status: 'blocked_by_robots',
        httpStatus: null,
        fetchedAt: new Date(nowMs).toISOString(),
        body: '',
        bodyUnavailable: 'robots',
      };
    }

    let lastError = '';
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await rawFetch(candidate.url);
        const contentType = response.headers.get('content-type') ?? '';
        const finalUrl = response.url || candidate.url;

        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          // 4xx は再試行しても変わらない
          if (response.status >= 400 && response.status < 500) break;
          throw new Error(lastError);
        }

        /*
         * PDFは本文を抽出しない。日本語PDFはCIDフォントが主で、
         * 簡易抽出では文字化けした本文を後段へ渡してしまう。
         */
        if (/application\/pdf/i.test(contentType) || /\.pdf($|\?)/i.test(finalUrl)) {
          return {
            candidate,
            url: candidate.url,
            finalUrl,
            status: 'ok',
            httpStatus: response.status,
            contentType,
            fetchedAt: new Date(nowMs).toISOString(),
            title: '',
            body: '',
            bodyUnavailable: 'pdf',
            publishedAt: null,
            updatedAt: null,
            canonicalUrl: finalUrl,
          };
        }

        const html = await response.text();
        const dates = extractDates(html);
        const record = {
          candidate,
          url: candidate.url,
          finalUrl,
          status: 'ok',
          httpStatus: response.status,
          contentType,
          fetchedAt: new Date(nowMs).toISOString(),
          title: extractTitle(html),
          body: extractBody(html, maxBody),
          canonicalUrl: extractCanonicalUrl(html, finalUrl),
          publishedAt: dates.publishedAt,
          updatedAt: dates.updatedAt,
        };
        cache.set(key, record);
        return record;
      } catch (error) {
        lastError = error.message;
        if (attempt < retries) await sleep(retryDelay * (attempt + 1));
      }
    }

    /*
     * 取得できなかったことを記録する。スニペットで埋めない。
     * 後段はこの状態の候補から事実を確定してはならない。
     */
    return {
      candidate,
      url: candidate.url,
      finalUrl: candidate.url,
      status: 'fetch_failed',
      httpStatus: null,
      fetchedAt: new Date(nowMs).toISOString(),
      body: '',
      bodyUnavailable: 'fetch_failed',
      error: lastError,
    };
  }

  /* --- 同時実行数を抑えて回す。相手先へ負荷をかけないため --- */
  const results = [];
  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) break;
      results.push(await fetchOne(candidate));
      if (onProgress) onProgress(results.length, candidates.length);
    }
  });
  await Promise.all(workers);

  return results;
}
