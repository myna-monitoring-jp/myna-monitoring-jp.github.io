/**
 * 設定の読み込み。
 *
 * 判断できない値をコードへ埋めず config/ に置く、という方針の入口。
 * YAML は渡された設定がその形式なので、自前パーサは持たず `yaml` を使う。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const CONFIG_DIR = process.env.CONFIG_DIR ?? 'config';

function readYaml(name) {
  const path = join(CONFIG_DIR, name);
  if (!existsSync(path)) throw new Error(`設定が見つかりません: ${path}`);
  return parseYaml(readFileSync(path, 'utf8'));
}

export function loadAppConfig() {
  return readYaml('app.yml');
}

export function loadQueryCatalog() {
  return readYaml('query_catalog.yml');
}

export function loadSourceRegistry() {
  return readYaml('source_registry.yml');
}

export function loadEventSchema() {
  return JSON.parse(readFileSync(join(CONFIG_DIR, 'event_schema.json'), 'utf8'));
}

/* --------------------------------------------------- 情報源レジストリの照会 */

/**
 * ドメインを情報源レジストリの Tier へ引き当てる。
 *
 * Tier 0（一次情報）だけがワイルドカード（`*.lg.jp`, `city.*.jp`）を持つので、
 * 単純な集合の照合では足りない。
 */
export function classifySource(registry, url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { tier: null, type: 'unknown', official: false };
  }

  const tiers = registry?.source_tiers ?? {};

  // Tier 0：完全一致のドメインとワイルドカード
  for (const entry of Object.values(tiers.tier_0_primary?.domains ?? {})) {
    if (entry.domain && (host === entry.domain || host.endsWith(`.${entry.domain}`))) {
      return { tier: 0, type: 'primary', official: true, categories: entry.categories ?? [] };
    }
    const patterns = [entry.domain_pattern, ...(entry.domain_patterns ?? [])].filter(Boolean);
    for (const pattern of patterns) {
      if (matchesDomainPattern(host, pattern)) {
        return { tier: 0, type: 'primary', official: true, categories: entry.categories ?? [] };
      }
    }
  }

  const check = (list, tier, type) => {
    for (const domain of list ?? []) {
      const d = String(domain).toLowerCase();
      if (host === d || host.endsWith(`.${d}`)) return { tier, type, official: false };
    }
    return null;
  };

  return (
    check(tiers.tier_1_major_media?.domains, 1, 'major_media') ??
    check(tiers.tier_2_specialist?.domains, 2, 'specialist_media') ??
    check(tiers.tier_3_reaction?.domains, 3, 'social') ??
    // 未登録のドメイン。報道扱いにはせず、専門媒体より下の扱いにする
    { tier: null, type: 'unknown', official: false }
  );
}

/**
 * `*.lg.jp` `city.*.jp` のような指定を照合する。
 * `*` は1ラベル以上に一致させる（`city.osaka-izumi.lg.jp` を `city.*.jp` が拾えるように）。
 */
export function matchesDomainPattern(host, pattern) {
  const escaped = String(pattern)
    .toLowerCase()
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^.]+(?:\\.[^.]+)*');
  return new RegExp(`^${escaped}$`).test(host);
}

/**
 * 独立した取材・編集と数えてよい媒体かどうか。
 *
 * 系列転載・配信転載・プレスリリース転載を独立媒体として水増ししないための判定。
 * 仕様§7.2 と source_registry.yml の `press_release_reprints` / `syndicated_articles` に対応。
 */
export function isIndependentOutlet(registry, url) {
  const info = classifySource(registry, url);
  if (info.tier === 3 || info.type === 'social') return false;
  if (info.official) return false; // 公式発表は「媒体数」ではなく一次情報として数える

  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  // 転載プラットフォームと配信元。ここに載るものは独立媒体に数えない
  const SYNDICATION_HOSTS = [
    'news.yahoo.co.jp',
    'news.google.com',
    'prtimes.jp',
    'kyodonews.jp',
    'jiji.com',
    'nordot.app',
    'msn.com',
    'newspicks.com',
    'livedoor.com',
    'excite.co.jp',
    'infoseek.co.jp',
  ];
  if (SYNDICATION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;

  return info.tier === 1 || info.tier === 2;
}

/** 同一系列をひとまとめにする識別子。系列内の重複計上を防ぐ。 */
export function syndicationGroupOf(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  /*
   * 系列の定義。同じ原稿が系列内の複数サイトに載るため、
   * これらは1媒体として数える。
   */
  const GROUPS = [
    { group: 'fnn', hosts: ['fnn.jp', 'ktv.jp', 'ohk.jp', 'sakuranbo.co.jp'] },
    { group: 'ntv', hosts: ['news.ntv.co.jp', 'ytv.co.jp', 'stv.jp'] },
    { group: 'tbs', hosts: ['newsdig.tbs.co.jp', 'mbs.jp', 'rkb.jp'] },
    { group: 'tv-asahi', hosts: ['news.tv-asahi.co.jp', 'abc.co.jp', 'nagoyatv.com'] },
    { group: 'kyodo', hosts: ['kyodonews.jp', 'nordot.app'] },
    { group: 'jiji', hosts: ['jiji.com'] },
    { group: 'yahoo', hosts: ['news.yahoo.co.jp'] },
    { group: 'prtimes', hosts: ['prtimes.jp'] },
  ];

  for (const entry of GROUPS) {
    if (entry.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return entry.group;
  }
  return null;
}
