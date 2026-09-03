/**
 * 公式情報源の直接収集（GitHub Actions から実行。PCの電源に依存しない）
 *
 * `myna-news-jp` の見出しフィードだけでは、官公庁の公式発表や稼働状況ページを
 * 取りこぼす。実際に 2026-09-03 の更新では、外務省の旅券申請停止・自治体の窓口
 * 混雑・宮城県の実証開始などが1件も取れなかった。その穴を埋めるための収集器。
 *
 * 3種類を扱う：
 *  1. rss          … デジタル庁・厚労省の新着RSS。キーワードで絞る
 *  2. statusPages  … 稼働状況ページの本文を抽出し、前回と変わったら障害として扱う
 *  3. newsQueries  … 事故・障害に絞った独自のニュース検索クエリ
 *
 * 収集の重複について：一般ニュースの収集は myna-news-jp に任せる方針は維持し、
 * ここでは「あの見出しフィードに入らないもの」だけを取りに行く。
 *
 * 依存パッケージなし（Node 20+ の fetch を使用）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = 'Mozilla/5.0 (compatible; myna-monitoring-portal/1.0; +https://myna-monitoring-jp.github.io/)';
const FETCH_TIMEOUT_MS = 20_000;

/* ---------------------------------------------------------------- 小道具 */

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'ja' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** タグを落として本文だけにする。 */
function toPlainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 安定した短いハッシュ。状態比較に使う。 */
function fingerprint(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** RSS/Atom から item を素朴に抽出する。専用パーサを持ち込まないため正規表現で扱う。 */
function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.flatMap((block) => {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? toPlainText(m[1]) : '';
    };
    const title = pick('title');
    let link = pick('link');
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? href[1] : '';
    }
    const date = pick('pubDate') || pick('dc:date') || pick('updated') || pick('published');
    if (!title || !link) return [];
    const parsed = date ? new Date(date) : null;
    return [
      {
        title,
        link,
        pubDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
        description: pick('description') || pick('summary'),
      },
    ];
  });
}

const googleNewsUrl = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;

/* ------------------------------------------------------------------ 本体 */

/**
 * @returns {{articles: Array, statusIncidents: Array, errors: Array, state: object}}
 *   articles        … 既存の自動項目パイプラインに渡す記事（myna-news-jp と同じ形）
 *   statusIncidents … 稼働状況ページ由来の不具合項目（そのまま incidents へ入れる）
 */
export async function collectOfficialSources({ sourcesPath, statePath, now, maxAgeDays = 3 }) {
  const result = { articles: [], statusIncidents: [], errors: [], state: {} };

  if (!sourcesPath || !existsSync(sourcesPath)) {
    result.errors.push(`情報源の定義が見つかりません: ${sourcesPath}`);
    return result;
  }

  const config = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const previousState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const state = { ...previousState };

  const keyword = config.keywordFilter ? new RegExp(config.keywordFilter) : null;

  /**
   * 取得期間は情報源ごとに変えられる。
   * 報道は3日で十分だが、自治体の周知ページは Google News の索引が遅く、
   * 10〜80日前のものとして出てくる。同じ窓では1件も通らない。
   */
  const withinAge = (iso, days = maxAgeDays) => {
    if (!iso) return true; // 日付が取れないものは落とさない（判断は後段に任せる）
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return true;
    return t >= now.getTime() - days * 24 * 60 * 60 * 1000;
  };

  /* --- 1. 官公庁の新着RSS --- */
  for (const source of config.rss ?? []) {
    try {
      const items = parseFeed(await fetchText(source.url));
      for (const item of items) {
        if (keyword && !keyword.test(`${item.title} ${item.description}`)) continue;
        if (!withinAge(item.pubDate, source.maxAgeDays)) continue;
        result.articles.push({
          title: item.title,
          link: item.link,
          _resolved_url: item.link,
          pub_date: item.pubDate,
          source: source.publisher ?? source.label,
          description: item.description,
          // 収集器側で期間を判定済み。後段で3日フィルタを再適用させない。
          _ageChecked: true,
          _origin: `rss:${source.id}`,
        });
      }
    } catch (error) {
      result.errors.push(`${source.label}（${source.url}）: ${error.message}`);
    }
  }

  /* --- 2. 稼働状況ページ --- */
  /*
   * 節の見出しで切り出す方式はやめた。「稼働状況」はページの <title> にも
   * 現れるため、indexOf ではナビゲーションを拾ってしまう。
   * 代わりに、この種のページが使う 【解消済】【障害】 のようなマーカーを直接
   * 拾う。マーカーから次のマーカーまでが1件の記載になる。
   */
  const MARKER = /【[^】]{1,14}】/g;

  for (const page of config.statusPages ?? []) {
    try {
      const text = toPlainText(await fetchText(page.url));

      // マーカーの位置で区切って個別の記載に分ける
      const marks = [...text.matchAll(MARKER)];
      const entries = marks.map((m, index) => {
        const from = m.index;
        const to = index + 1 < marks.length ? marks[index + 1].index : Math.min(text.length, from + 500);
        return text.slice(from, to).trim();
      });

      const key = `statusPage:${page.id}`;
      state[key] = {
        fingerprint: fingerprint(entries.join('|')),
        entryCount: entries.length,
        checkedAt: now.toISOString(),
      };

      for (const entry of entries) {
        // 障害の記載だけを対象にする（正常稼働や無関係な注記は載せない）
        if (!/障害|不具合|停止|エラー|取得できな|利用できな/.test(entry)) continue;
        // メンテナンス予定表の行は計画停止であって障害ではないため除外
        if (/^【?(メンテナンス|予定)/.test(entry)) continue;

        const resolved = /解消|復旧/.test(entry);
        const print = fingerprint(entry);
        result.statusIncidents.push({
          // 内容が変わると id も変わる。別の障害を同じ項目に上書きしないため。
          id: `incident-status-${page.id}-${print}`,
          incidentCategory: page.incidentCategory ?? 'common_system',
          entityName: page.entityName ?? page.publisher ?? '主体未確認',
          systemName: page.systemName,
          title: `${page.systemName ?? page.label}：${entry.replace(MARKER, '').trim().slice(0, 56)}`,
          status: resolved ? 'resolved' : 'attention',
          severity: resolved ? 'medium' : 'high',
          symptoms: entry.slice(0, 600),
          officialStatus: '公式の稼働状況ページに記載あり。',
          affectedCount: null,
          affectedCountNote: '影響件数は未公表',
          cyberAttack: false,
          summary: entry.slice(0, 300),
          whatIsNew: '公式の稼働状況ページを自動確認して検知。',
          reviewState: 'unreviewed',
          tags: ['自動収集', '公式稼働状況', resolved ? '解消済み' : '継続中の記載'],
          publicVoices: [],
          factChecks: [
            {
              claim: 'オンライン資格確認が全国的に停止している',
              assessment: 'scope_separation',
              explanation:
                'このAPIの障害・制限と、医療機関のオンライン資格確認の全国停止は別事象。公式ページの記載範囲を確認すること。',
            },
          ],
          sources: [
            {
              type: 'primary',
              label: page.label,
              url: page.url,
              linkText: '一次情報を開く',
              publisher: page.publisher,
              verifiedAt: now.toISOString(),
              active: true,
            },
          ],
          _origin: `status:${page.id}`,
        });
      }
    } catch (error) {
      result.errors.push(`${page.label}（${page.url}）: ${error.message}`);
    }
  }

  /* --- 3. 事故・障害に絞った独自ニュース検索 --- */
  for (const entry of config.newsQueries ?? []) {
    // 文字列でもオブジェクト（期間・件数の指定つき）でも書ける
    const query = typeof entry === 'string' ? entry : entry.q;
    const limit = (typeof entry === 'object' && entry.limit) || 10;
    const ageDays = typeof entry === 'object' ? entry.maxAgeDays : undefined;
    try {
      const items = parseFeed(await fetchText(googleNewsUrl(query)));
      for (const item of items.slice(0, limit)) {
        if (!withinAge(item.pubDate, ageDays)) continue;
        result.articles.push({
          title: item.title,
          link: item.link,
          _resolved_url: item.link,
          pub_date: item.pubDate,
          // Google News のタイトル末尾「 - 媒体名」から媒体を拾う
          source: (item.title.split(' - ').pop() ?? '報道').trim(),
          description: item.description,
          _ageChecked: true,
          _origin: `query:${query}`,
        });
      }
    } catch (error) {
      result.errors.push(`検索「${query}」: ${error.message}`);
    }
  }

  result.state = state;
  if (statePath) writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  return result;
}
