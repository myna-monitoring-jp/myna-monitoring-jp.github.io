#!/usr/bin/env node
/**
 * 日次自動更新パイプライン（GitHub Actions から毎朝 7:00 JST に実行）
 *
 *   public/data/curated.json   ← 人が判断して書く（自動処理は読むだけ）
 *          +
 *   myna-news-jp の news_latest.json（収集済みニュース）
 *          ↓  このスクリプト
 *   public/data/current.json   ← 生成物。サイトが表示する
 *   public/data/archive/YYYY-MM-DD.json ← 前日分の退避
 *
 * 設計上の約束：
 * - curated.json の内容は一切書き換えない。人の判断が毎日の自動実行で消えることはない。
 * - 自動収集した項目は reviewState="unreviewed"、status="new" で載せる。
 *   「要注視」「炎上認定」「事実関係の切り分け」は判断が必要なので自動では付けない。
 * - curated 項目に matchKeywords があれば、一致する新着記事を出典として追記し、
 *   独立媒体が増えた場合のみ lastMaterialUpdateAt を更新する（= 要件の「重要更新」）。
 * - 収集は myna-news-jp に任せる。ここで新たなスクレイパは作らない。
 *
 * 依存パッケージなし（Node 20+ の fetch を使用）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectOfficialSources, toPlainText } from './collect-official.mjs';
import { collectBriefing } from './collect-briefing.mjs';

/* ------------------------------------------------------------------ 設定 */

const DATA_DIR = process.env.DATA_DIR ?? 'public/data';
const CURATED_PATH = join(DATA_DIR, 'curated.json');
const CURRENT_PATH = join(DATA_DIR, 'current.json');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');

/** 収集元。myna-news-jp が Google News RSS から収集した結果を公開している。 */
const NEWS_FEED_URL =
  process.env.NEWS_FEED_URL ?? 'https://myna-news-jp.github.io/news_latest.json';

/** 自動追加する記事の上限。ダッシュボードが未レビュー項目で埋まるのを防ぐ。 */
const MAX_AUTO_ITEMS = Number(process.env.MAX_AUTO_ITEMS ?? 20);

/** これより古い記事は新規追加しない（日数）。 */
const MAX_ARTICLE_AGE_DAYS = Number(process.env.MAX_ARTICLE_AGE_DAYS ?? 3);

/** アーカイブの保持日数。0 で無制限。 */
const ARCHIVE_RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS ?? 400);

/**
 * 未レビューの自動収集項目を画面に残す日数。
 * これを過ぎたものは current.json から落とす（その日のアーカイブには残る）。
 * 放置された「未レビュー」が無限に積み上がるのを防ぐため。
 */
const AUTO_ITEM_RETENTION_DAYS = Number(process.env.AUTO_ITEM_RETENTION_DAYS ?? 14);

/**
 * 官公庁の公式情報源の定義。空文字を渡すと直接収集をスキップする（テスト用）。
 * 既定では有効で、GitHub Actions から毎朝実行される。
 */
const OFFICIAL_SOURCES =
  process.env.OFFICIAL_SOURCES === undefined ? 'scripts/sources.json' : process.env.OFFICIAL_SOURCES;

/**
 * 朝の状況判断を生成するか。
 * OPENAI_API_KEY が無い環境（ローカル・テスト）では自動的に無効になるが、
 * 明示的に切りたい場合は ENABLE_BRIEFING=0 を渡す。
 */
const ENABLE_BRIEFING = process.env.ENABLE_BRIEFING !== '0' && Boolean(process.env.OPENAI_API_KEY);

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/* ---------------------------------------------------------------- 小道具 */

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn('[警告]', ...args);

/** JSTでの YYYY-MM-DD */
function jstDate(date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO文字列（+09:00表記） */
function jstIso(date) {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return shifted.toISOString().replace('Z', '+09:00');
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    warn(`${path} を読み込めません: ${error.message}`);
    return fallback;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}


/** 表記ゆれを潰したタイトル。重複判定に使う。 */
function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/\s+/g, '')
    .replace(/[［］\[\]（）()【】「」『』｜|・:：\-—–ー~〜、。,.!?！？"'’”]/g, '')
    .replace(/-[^-]*$/, '') // Google News が付ける「 - 媒体名」を落とす
    .toLowerCase();
}

/**
 * Google News のタイトル末尾「 - 媒体名」を除いた本文。
 * 媒体名らしい短い末尾のときだけ落とす（本文中のハイフンを誤って切らないため）。
 */
function cleanTitle(title) {
  const text = String(title ?? '').trim();
  const cut = text.lastIndexOf(' - ');
  if (cut < 0) return text;
  const head = text.slice(0, cut).trim();
  const tail = text.slice(cut + 3).trim();
  if (head.length >= 6 && tail.length > 0 && tail.length <= 40) return head;
  return text;
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ 分類ルール */

/**
 * 自動収集した記事は「不具合」「広報」レーンには入れない。
 *
 * 理由：公開サイトで「○○市で不具合が発生」と誤って掲載する損害が大きく、
 * キーワード判定では解説記事と実際の障害報道を確実に区別できない（例：
 * 「資格確認書の交付ルールはどう違う?」という解説記事が不具合に見える）。
 * 要件 9 でも重要度大・炎上認定・個人情報/サイバーは公開前レビューを求めている。
 *
 * そのため自動項目はすべて「トップニュース」に置き、該当しそうなレーンを
 * *候補タグ* として付けるだけにする。編集者が curated.json に書き起こした
 * 時点で正式に不具合・広報レーンへ入る。
 */
const CANDIDATE_RULES = [
  {
    tag: '不具合候補（医療IT・サイバー）',
    subject: /病院|医療機関|クリニック|医療センター|電子カルテ|診療所|医師会|薬局|医療法人/,
    event: /ランサム|不正アクセス|サイバー攻撃|情報漏|漏えい|漏洩|改ざん|流出|脆弱性/,
  },
  {
    tag: '不具合候補（共通システム）',
    subject: /オンライン資格確認|オン資|マイナポータル|マイナアプリ|J-LIS|電子処方箋|PMH|利用登録/,
    event: /障害|不具合|停止|メンテナンス|エラー|つながらな|ログインできな/,
  },
  {
    tag: '不具合候補（自治体・保険者）',
    subject: /市|町|村|区|県|府|国保|国民健康保険|後期高齢|保険者|自治体|広域連合/,
    // 実際の事故を示す語に限定する。「資格確認書」等の一般語だけでは拾わない。
    event: /誤(表示|記載|交付|送付|入力|登録)|不具合|システム障害|資格(が)?無効|資格なし表示|漏えい|漏洩|流出|紛失/,
  },
  {
    tag: '広報候補',
    subject: /広報|広告|タイアップ|キャンペーン|ポスター|PR動画|特設サイト|コラボ/,
    event: null,
  },
];

/** 解説・ハウツー記事。事故報道と混同しやすいので候補タグを付けない。 */
const EXPLAINER = /[?？]|とは|解説|まとめ|方法|やり方|注意点|ガイド|徹底|おすすめ|ランキング|比較|節税|確定申告|どう(する|なる|使う|受診|思い)|べき|した方がいい/;

const HIGH_SEVERITY = /全国|ランサム|漏えい|漏洩|流出|中止|謝罪|回収|万人|重大|炎上|提訴|逮捕/;

/**
 * 候補タグを返す。自動項目は必ず news レーン。
 * 解説記事と判定した場合は候補タグを付けない（誤って不具合に見せないため）。
 */
function candidateTags(article) {
  /*
   * 媒体名も判定に含める。
   * 政府広報の掲載物は表題が「マイナ救急（2026年9月掲載）」のように事業名だけで、
   * 「広報」「広告」の語が入らない。媒体名（政府広報オンライン）を見ないと
   * 広報候補として拾えず、官公庁ドメインのため参考情報に埋もれていた。
   */
  const text = `${article.title ?? ''} ${article.description ?? ''} ${article.source ?? ''}`;
  if (EXPLAINER.test(article.title ?? '')) return [];

  const tags = [];
  for (const rule of CANDIDATE_RULES) {
    if (!rule.subject.test(text)) continue;
    if (rule.event && !rule.event.test(text)) continue;
    tags.push(rule.tag);
  }
  return tags;
}

/* ------------------------------------------------ 解説記事・二次情報の判定 */

/** 官公庁・自治体の公式ドメイン。 */
const OFFICIAL_DOMAIN = /(^|\.)(go\.jp|lg\.jp)$/i;

/** 媒体名が官公庁・自治体らしいか。Google News 経由でURLが公式でない場合の補助。 */
const OFFICIAL_PUBLISHER =
  /デジタル庁|厚生労働省|総務省|法務省|内閣府|政府広報|こども家庭庁|支払基金|国保中央会|J-LIS|(市|町|村|区|都|道|府|県)$/;

/**
 * 自治体サイトの慣行的なホスト名。
 * `lg.jp` を持たない自治体は多い（例：所沢市は city.tokorozawa.saitama.jp）ため、
 * ドメイン末尾だけでは公式と判定できない。
 */
const MUNICIPAL_HOST = /^(www\.)?(city|town|vill|pref|metro)\./i;

const looksOfficialHost = (host) => OFFICIAL_DOMAIN.test(host) || MUNICIPAL_HOST.test(host);

function isOfficialSource(article) {
  /*
   * Google News が <source url> で媒体のトップURLを教えてくれる場合はそれを使う。
   * 記事リンクは news.google.com のリダイレクトなのでホスト名では判定できず、
   * 媒体名の当て推量に頼っていた。
   */
  if (article._publisher_url) {
    try {
      if (looksOfficialHost(new URL(article._publisher_url).hostname)) return true;
    } catch {
      // 壊れたURLは無視して以降の判定に任せる
    }
  }

  let host = '';
  try {
    host = new URL(articleUrl(article)).hostname;
  } catch {
    host = '';
  }
  if (looksOfficialHost(host)) return true;

  /*
   * Google News 経由の記事はリンクが news.google.com のリダイレクトになるため、
   * ホスト名では判定できない。この場合 Google News は媒体名の位置に元のドメインを
   * 入れてくることがあるので、媒体名もホスト名として見る。
   */
  const source = String(article.source ?? '').trim();
  return looksOfficialHost(source) || OFFICIAL_PUBLISHER.test(source);
}

/**
 * 論調の自動判定。
 * 「廃止」のような制度上の事実語は否定語に含めない（誤判定するため）。
 */
const TONE_NEGATIVE =
  /批判|反対|やめた方|やめたほうが|使うな|危険|強制|懸念|デメリット|トラブル|使えない|不便|反発|怒り|不満|落とし穴|問題点|失敗|後悔|要注意/;
const TONE_POSITIVE =
  /便利|メリット|おすすめ|お得|安心|活用|使いこなす|向上|できるように|楽に|簡単に|快適|よかった|良かった|助かる/;

function toneOf(article) {
  const text = `${article.title ?? ''} ${article.description ?? ''}`;
  if (TONE_NEGATIVE.test(text)) return 'negative';
  if (TONE_POSITIVE.test(text)) return 'positive';
  return 'neutral';
}

/**
 * 自動収集した記事をどの枠に置くか決める。
 *
 * - `other`      … 不具合・広報の候補タグが付いた記事。本文の一覧に残して人が確認する
 * - `reference`  … 官公庁・自治体の一次情報だが監視対象の事象ではないもの。
 *                  ダッシュボード下部の「参考情報」へ（例：省庁の周年発表、イベント報告）
 * - `commentary` … 一次情報でも独自報道でもない解説・ハウツー・二次転載。
 *                  トップニュース画面下部の「解説記事・二次情報」へ
 */
function laneFor(article, tags) {
  if (tags.length > 0) return 'other';
  return isOfficialSource(article) ? 'reference' : 'commentary';
}

function severityOf(article) {
  const text = `${article.title ?? ''} ${article.description ?? ''}`;
  // 未レビュー項目に「大」を自動で付けると誤警報になるため、上限は「中」。
  return HIGH_SEVERITY.test(text) ? 'medium' : 'low';
}

/**
 * 引き継いだ未レビュー項目を、現在の分類ルールで再判定する。
 *
 * 分類は新規追加時だけでなく毎回かけ直す。そうしないとルールを直しても
 * 既に取り込み済みの項目が古い分類のまま画面に残り続ける。
 * curated（レビュー済）項目には触れない。
 */
/**
 * 概要にHTMLが混ざっていたら本文だけにする。
 *
 * 実体参照の復元順の誤りで、生の `<a href=...>` が概要に入って画面に出た。
 * 収集側は直したが、既に取り込み済みの項目は引き継ぎで残る。
 * current.json は生成物なので、引き継ぐ際に直してよい。
 */
function repairSummary(summary) {
  const text = String(summary ?? '');
  if (!/<[a-z/!][^>]*>|&lt;|&amp;/i.test(text)) return text;
  return toPlainText(text);
}

function reclassifyCarriedItem(item) {
  if (item.reviewState !== 'unreviewed') return item;

  const source = (item.sources ?? [])[0] ?? {};
  const pseudoArticle = {
    title: item.title,
    description: item.summary,
    source: source.publisher ?? source.label,
    _resolved_url: source.url,
    link: source.url,
  };

  const tags = candidateTags(pseudoArticle);
  const lane = laneFor(pseudoArticle, tags);
  // 論調は解説記事欄でしか使わない。他の枠へ移る場合は落とす。
  return {
    ...item,
    summary: repairSummary(item.summary),
    category: lane,
    polarity: lane === 'commentary' ? toneOf(pseudoArticle) : undefined,
  };
}

/* -------------------------------------------------------------- 記事取得 */

async function fetchArticles() {
  log(`収集元を取得: ${NEWS_FEED_URL}`);
  const response = await fetch(NEWS_FEED_URL, { headers: { 'user-agent': 'myna-monitoring-portal' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const payload = await response.json();

  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  log(`  取得: ${articles.length}件 / 収集元の更新時刻: ${payload?.updated ?? '不明'}`);

  return {
    updated: payload?.updated ?? null,
    articles: articles.filter((a) => a && a.title && isHttpUrl(a._resolved_url ?? a.link)),
  };
}

/** 記事のURL。解決済みURLがあればそれを使う。 */
const articleUrl = (article) => article._resolved_url ?? article.link;

/* ------------------------------------------------------------ 出典の追記 */

/**
 * curated 項目に matchKeywords がある場合、一致する新着記事を出典に追記する。
 *
 * 「独立した追加報道」= 既存の出典に無い媒体からの記事。これが増えたときだけ
 * lastMaterialUpdateAt を進める。表記ゆれ修正などでは進めない（N日ルールの
 * 起算点がずれるため）。
 */
function attachCoverage(item, articles, now) {
  const keywords = Array.isArray(item.matchKeywords) ? item.matchKeywords : [];
  if (keywords.length === 0) return { item, added: 0, bumped: false };

  const knownUrls = new Set((item.sources ?? []).map((s) => s.url));
  const knownPublishers = new Set(
    (item.sources ?? []).map((s) => s.publisher ?? s.label).filter(Boolean),
  );

  const sources = [...(item.sources ?? [])];
  let added = 0;
  let newIndependentOutlet = false;

  for (const article of articles) {
    const text = `${article.title ?? ''} ${article.description ?? ''}`;
    // すべてのキーワードを含む記事だけを紐づける（誤爆を防ぐため AND 条件）
    if (!keywords.every((keyword) => text.includes(keyword))) continue;

    const url = articleUrl(article);
    if (knownUrls.has(url)) continue;

    const publisher = article.source ?? '報道';
    sources.push({
      type: 'media',
      label: publisher,
      url,
      linkText: '報道記事を開く',
      publisher,
      publishedAt: article.pub_date,
      verifiedAt: jstIso(now),
      active: true,
      note: '自動収集',
    });
    knownUrls.add(url);
    added += 1;
    if (!knownPublishers.has(publisher)) {
      knownPublishers.add(publisher);
      newIndependentOutlet = true;
    }
  }

  if (added === 0) return { item, added: 0, bumped: false };

  return {
    item: {
      ...item,
      sources,
      // 独立媒体が増えた場合のみ重要更新として扱う
      lastMaterialUpdateAt: newIndependentOutlet ? jstIso(now) : item.lastMaterialUpdateAt,
      dailyDiff: newIndependentOutlet
        ? `独立媒体${added}件の追加報道を自動検知（${jstDate(now)}）。`
        : (item.dailyDiff ?? '前日から変化なし。'),
    },
    added,
    bumped: newIndependentOutlet,
  };
}

/* ------------------------------------------------------- 自動項目の生成 */

function autoIdFor(article, prefix) {
  const url = articleUrl(article);
  // URLから安定したidを作る（同じ記事が翌日also来ても重複しない）
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }
  const date = (article.pub_date ?? '').slice(0, 10).replace(/-/g, '') || 'nodate';
  return `${prefix}-auto-${date}-${Math.abs(hash).toString(36)}`;
}

function baseAutoItem(article, now, tags) {
  const title = cleanTitle(article.title);
  const publisher = article.source ?? '報道';
  return {
    title,
    // 自動収集した項目は必ず「新着」。要注視の判定は人が行う。
    status: 'new',
    severity: severityOf(article),
    detectedAt: jstIso(now),
    publishedAt: article.pub_date ?? jstIso(now),
    lastMaterialUpdateAt: article.pub_date ?? jstIso(now),
    summary: (article.description ?? '').trim() || '本文未取得。出典を参照してください。',
    dailyDiff: `${jstDate(now)}の自動収集で新規検知。`,
    reviewState: 'unreviewed',
    tags: ['自動収集', ...tags],
    publicVoices: [],
    factChecks: [],
    sources: [
      {
        type: 'media',
        label: publisher,
        url: articleUrl(article),
        linkText: '報道記事を開く',
        publisher,
        publishedAt: article.pub_date,
        verifiedAt: jstIso(now),
        active: true,
      },
    ],
  };
}

/* ------------------------------------------------------------ アーカイブ */

function archivePreviousDay(previous, today) {
  if (!previous || !previous.reportDate) return null;
  if (previous.reportDate === today) return null; // 同日中の再実行は退避しない

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const path = join(ARCHIVE_DIR, `${previous.reportDate}.json`);
  writeJson(path, previous);
  log(`前日分を退避: ${path}`);
  return { date: previous.reportDate, title: '日次レポート', dataPath: `archive/${previous.reportDate}.json` };
}

function listArchive(now) {
  if (!existsSync(ARCHIVE_DIR)) return [];
  const cutoff =
    ARCHIVE_RETENTION_DAYS > 0
      ? jstDate(new Date(now.getTime() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000))
      : null;

  return readdirSync(ARCHIVE_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace('.json', ''))
    .filter((date) => !cutoff || date >= cutoff)
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({ date, title: '日次レポート', dataPath: `archive/${date}.json` }));
}

/* ----------------------------------------------------------------- 本体 */

async function main() {
  const now = new Date();
  const today = jstDate(now);

  const curated = readJson(CURATED_PATH);
  if (!curated) {
    throw new Error(`${CURATED_PATH} がありません。人が判断して書くファイルなので必須です。`);
  }

  const previous = readJson(CURRENT_PATH);

  let feed = { updated: null, articles: [] };
  let feedError = null;
  try {
    feed = await fetchArticles();
  } catch (error) {
    feedError = error instanceof Error ? error.message : String(error);
    warn(`収集元を取得できませんでした: ${feedError}`);
  }

  /* --- 官公庁の公式情報源を直接収集（見出しフィードに入らないものを取る） --- */
  let official = { articles: [], statusIncidents: [], errors: [] };
  if (OFFICIAL_SOURCES) {
    log(`公式情報源を直接収集: ${OFFICIAL_SOURCES}`);
    official = await collectOfficialSources({
      sourcesPath: OFFICIAL_SOURCES,
      statePath: join(DATA_DIR, 'source-state.json'),
      now,
      maxAgeDays: MAX_ARTICLE_AGE_DAYS,
    });
    log(
      `  公式RSS・独自検索: ${official.articles.length}件 / 稼働状況ページ由来: ${official.statusIncidents.length}件`,
    );
    for (const message of official.errors) warn(`公式情報源: ${message}`);
    // 見出しフィードの後ろに足す。重複はURL・タイトルで後段が弾く。
    feed.articles = [...feed.articles, ...official.articles];
  }

  /* --- 朝の状況判断（検索とページ確認を伴う調査） --- */
  /*
   * 機械収集とは別のレイヤー。ここだけが「公式ページが今どう表示しているか」
   * 「前日の数値と比べてどう動いたか」「確認できなかったこと」を持てる。
   * 生成に失敗しても機械収集の結果は公開する（briefing は undefined になる）。
   */
  let briefing;
  if (ENABLE_BRIEFING) {
    log('朝の状況判断を生成: 検索・ページ確認');
    const result = await collectBriefing({
      now,
      // 前日のブリーフィングを渡す。渡さないと数値の差分（466件→509件）が出せない。
      previous: previous?.briefing ?? null,
    });
    for (const message of result.errors) warn(message);
    if (result.briefing) {
      briefing = result.briefing;
      log(
        `  指標 ${briefing.metrics.length} / 差分 ${briefing.diffs.length} / ` +
          `優先ウォッチ ${briefing.watchlist.length} / 出典 ${briefing.sources.length}（モデル: ${briefing.generatedBy}）`,
      );
    } else {
      // 前日分をそのまま流用しない。古い判断を今朝のものとして出す方が有害。
      log('  生成できなかったため、朝の状況判断なしで出力します');
    }
  }

  /* --- 既知URLの集合（重複追加を防ぐ） --- */
  const knownUrls = new Set();
  const knownTitles = new Set();
  const collectKnown = (items) => {
    for (const item of items ?? []) {
      for (const source of item.sources ?? []) knownUrls.add(source.url);
      knownTitles.add(normalizeTitle(item.title));
    }
  };
  collectKnown(curated.news);
  collectKnown(curated.incidents);
  collectKnown(curated.prItems);
  // 前日までに自動追加したものも既知として扱う
  if (previous) {
    collectKnown(previous.news);
    collectKnown(previous.incidents);
    collectKnown(previous.prItems);
  }

  /* --- curated 項目へ追加報道を紐づける --- */
  let coverageAdded = 0;
  let coverageBumped = 0;
  const withCoverage = (items) =>
    (items ?? []).map((item) => {
      const result = attachCoverage(item, feed.articles, now);
      coverageAdded += result.added;
      if (result.bumped) coverageBumped += 1;
      return result.item;
    });

  // curated 由来の項目は明示的にレビュー済とする
  const markReviewed = (items) => items.map((item) => ({ ...item, reviewState: 'reviewed' }));
  const news = markReviewed(withCoverage(curated.news));
  const incidents = markReviewed(withCoverage(curated.incidents));
  const prItems = markReviewed(withCoverage(curated.prItems));

  /* --- 前日までに自動追加した項目の引き継ぎ --- */
  const curatedIds = new Set([...news, ...incidents, ...prItems].map((i) => i.id));
  // curated.json の dismissedIds に入れた項目は二度と表示しない（却下）
  const dismissedIds = new Set(
    Array.isArray(curated.dismissedIds)
      ? curated.dismissedIds.filter((id) => typeof id === 'string')
      : [],
  );
  const retentionCutoff = now.getTime() - AUTO_ITEM_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const dropped = { promoted: 0, dismissed: 0, expired: 0 };

  const carryOver = (previousItems) =>
    (previousItems ?? []).filter((item) => {
      if (item.reviewState !== 'unreviewed') return false;
      // curated.json に同じ id で書き起こされた＝昇格済み。curated 版に置き換わる。
      if (curatedIds.has(item.id)) {
        dropped.promoted += 1;
        return false;
      }
      if (dismissedIds.has(item.id)) {
        dropped.dismissed += 1;
        return false;
      }
      const detectedAt = Date.parse(item.detectedAt ?? item.lastMaterialUpdateAt ?? '');
      if (Number.isFinite(detectedAt) && detectedAt < retentionCutoff) {
        dropped.expired += 1;
        return false;
      }
      return true;
    })
      // 分類ルールを毎回かけ直す（ルール変更が既存項目にも反映されるように）
      .map(reclassifyCarriedItem);

  const autoNews = carryOver(previous?.news);
  const autoIncidents = carryOver(previous?.incidents);
  const autoPr = carryOver(previous?.prItems);

  /* --- 新着記事を自動項目として追加 --- */
  const ageCutoff = new Date(now.getTime() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000);
  let addedCount = 0;
  let candidateCount = 0;
  let commentaryCount = 0;
  let referenceCount = 0;
  const skipped = { duplicate: 0, tooOld: 0, overLimit: 0 };

  /*
   * 追加の優先順位。情報源を増やしたため、上限に達したときに何が残るかが
   * 重要になった。不具合・広報の候補（＝監視対象そのもの）を最優先し、
   * 次に官公庁の一次情報、最後に解説記事という順で詰める。
   */
  const priority = (article) => {
    const tags = candidateTags(article);
    if (tags.length > 0) return 0;
    return isOfficialSource(article) ? 1 : 2;
  };
  const sortedArticles = [...feed.articles].sort((a, b) => {
    const diff = priority(a) - priority(b);
    if (diff !== 0) return diff;
    // 同じ優先度なら新しい記事から
    return Date.parse(b.pub_date ?? 0) - Date.parse(a.pub_date ?? 0);
  });

  for (const article of sortedArticles) {
    if (addedCount >= MAX_AUTO_ITEMS) {
      skipped.overLimit += 1;
      continue;
    }
    const url = articleUrl(article);
    const normalized = normalizeTitle(article.title);
    if (knownUrls.has(url) || knownTitles.has(normalized)) {
      skipped.duplicate += 1;
      continue;
    }
    // 公式情報源の収集器は情報源ごとに期間を判定している（自治体の周知ページは
    // Google News の索引が遅く、報道と同じ3日窓では1件も通らない）。
    // 判定済みの記事にここで再度3日フィルタをかけると二重に落ちてしまう。
    if (!article._ageChecked) {
      const published = article.pub_date ? new Date(article.pub_date) : null;
      if (published && !Number.isNaN(published.getTime()) && published < ageCutoff) {
        skipped.tooOld += 1;
        continue;
      }
    }

    const id = autoIdFor(article, 'news');
    // 却下済みの記事は再収集しても復活させない
    if (dismissedIds.has(id) || curatedIds.has(id)) {
      skipped.duplicate += 1;
      continue;
    }

    const tags = candidateTags(article);
    const lane = laneFor(article, tags);
    // 自動項目は必ずニュース配列に入れる。不具合・広報レーンは人が検証したものだけ。
    // category で「本文一覧 / 参考情報 / 解説記事」の置き場所を分ける。
    autoNews.push({
      ...baseAutoItem(article, now, tags),
      id,
      category: lane,
      ...(lane === 'commentary' ? { polarity: toneOf(article) } : {}),
    });
    if (tags.length > 0) candidateCount += 1;
    if (lane === 'commentary') commentaryCount += 1;
    if (lane === 'reference') referenceCount += 1;

    knownUrls.add(url);
    knownTitles.add(normalized);
    addedCount += 1;
  }

  /* --- 稼働状況ページ由来の不具合 --- */
  /*
   * 例外的に、公式の稼働状況ページ由来のものだけは自動でも不具合レーンに入れる。
   * 見出しの推測ではなく「公式が障害と書いている」一次情報であり、誤って
   * 不具合を掲載するリスクが無いため。curated に同じ id があれば人の版を優先。
   */
  let statusAdded = 0;
  for (const incident of official.statusIncidents) {
    if (curatedIds.has(incident.id) || dismissedIds.has(incident.id)) continue;
    if (autoIncidents.some((x) => x.id === incident.id)) continue;
    autoIncidents.push({
      ...incident,
      detectedAt: jstIso(now),
      lastMaterialUpdateAt: jstIso(now),
      dailyDiff: `${jstDate(now)}に公式稼働状況ページを自動確認して検知。`,
    });
    statusAdded += 1;
  }

  /* --- アーカイブ --- */
  archivePreviousDay(previous, today);
  const archive = listArchive(now);

  /* --- データ更新状態 --- */
  const dataUpdate = feedError
    ? {
        state: 'failed',
        lastSuccessfulUpdateAt: previous?.dataUpdate?.lastSuccessfulUpdateAt ?? previous?.generatedAt,
        attemptedAt: jstIso(now),
        message: `収集元（${NEWS_FEED_URL}）を取得できませんでした：${feedError}`,
      }
    : { state: 'ok', lastSuccessfulUpdateAt: jstIso(now) };

  /* --- 出力 --- */
  const dataset = {
    dataset: 'live',
    generatedAt: jstIso(now),
    reportDate: today,
    settings: curated.settings,
    dataUpdate,
    headline: curated.headline,
    briefing,
    news: [...news, ...autoNews],
    incidents: [...incidents, ...autoIncidents],
    prItems: [...prItems, ...autoPr],
    surveys: curated.surveys ?? [],
    pulses: curated.pulses ?? [],
    archive,
    timeline: curated.timeline ?? [],
    corrections: curated.corrections ?? [],
  };

  writeJson(CURRENT_PATH, dataset);

  log('');
  log('=== 更新結果 ===');
  log(`  基準日: ${today}`);
  log(`  収集元の記事: ${feed.articles.length}件`);
  log(`  新規追加: ${addedCount}件（重複除外 ${skipped.duplicate} / 古い ${skipped.tooOld} / 上限超過 ${skipped.overLimit}）`);
  log(`  うち不具合・広報の候補タグ付き: ${candidateCount}件（レーン移動は人が curated.json で行う）`);
  log(`  うち解説記事・二次情報として下部へ: ${commentaryCount}件`);
  log(`  うち参考情報（一次情報だが監視対象外）: ${referenceCount}件`);
  log(`  公式稼働状況ページ由来の不具合: ${statusAdded}件`);
  log(`  curated項目への追加報道: ${coverageAdded}件（うち重要更新扱い ${coverageBumped}件）`);
  log(
    `  未レビューから外れた項目: 昇格 ${dropped.promoted} / 却下 ${dropped.dismissed} / ${AUTO_ITEM_RETENTION_DAYS}日経過 ${dropped.expired}`,
  );
  log(`  残っている未レビュー: ${autoNews.length + autoIncidents.length + autoPr.length}件`);
  log(`  合計: ニュース ${dataset.news.length} / 不具合 ${dataset.incidents.length} / 広報 ${dataset.prItems.length}`);
  log(`  アーカイブ: ${archive.length}日分`);
  log(`  更新状態: ${dataUpdate.state}`);
  log(`  出力: ${CURRENT_PATH}`);

  // 収集元が落ちていても current.json は生成する（サイトを空にしない）。
  // ただし終了コードは 1 にして、失敗が見えるようにする。
  if (feedError) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[エラー] ${error.message}`);
  process.exit(2);
});
