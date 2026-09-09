/**
 * render：日別HTMLの生成
 *
 * `public/reports/myna_news_YYYY-MM-DD.html` を作る（仕様§16）。
 *
 * リンクの契約は文字列連結ではなく、この1関数だけが `<a>` を作る形にしてある。
 * 属性の付け忘れを構造的に防ぐため。生成後は qa.checkHtml が全リンクを検査する。
 */

import { voiceTextFor } from './compose.mjs';

/* ---------------------------------------------------------------- 小道具 */

/** HTMLエスケープ。本文由来の文字列は必ずこれを通す。 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 外部リンク。`<a>` を作るのはここだけ。
 *
 * 空href・`#`・`javascript:` は生成しない（呼び出し側で弾かず、ここで注記に落とす）。
 */
export function externalLink(url, text) {
  const href = String(url ?? '');
  const usable = /^https?:\/\//i.test(href);
  if (!usable) {
    return `<span class="src-broken">${escapeHtml(text)}（URLを確認できないため注記として表示）</span>`;
  }
  let host = '';
  try {
    host = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  return (
    `<a class="src" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">` +
    `${escapeHtml(text)}<span class="src-host">${escapeHtml(host)}</span><span aria-hidden="true">↗</span></a>`
  );
}

const SEVERITY_LABEL = { critical: '重大', high: '大', medium: '中', low: '小', reference: '参考' };
const STATUS_LABEL = {
  new: '新着',
  attention: '要注視',
  follow_up: '続報待ち',
  planned: '計画停止',
  improving: '改善中',
  resolved: '解消済',
  quiet: '沈静化',
  archived: 'アーカイブ',
};
const DELTA_LABEL = {
  new: '新規',
  backfill: '追補',
  expanded: '拡大',
  material_update: '重要更新',
  improving: '改善',
  resolved: '解消',
  unchanged: '大きな動きなし',
  reignited: '再燃',
  correction: '訂正',
};
const SOURCE_LINK_TEXT = {
  primary: '一次情報を開く',
  major_media: '報道記事を開く',
  specialist_media: '専門媒体の記事を開く',
  social: 'X投稿を開く',
  survey: '調査結果を開く',
  app_store: 'アプリストアを開く',
};

const JST = (iso, fallback = '不明') => {
  if (!iso) return fallback;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return fallback;
  const d = new Date(time + 9 * 3600000);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const JST_DATE = (iso, fallback = '日付不明') => {
  const value = JST(iso, '');
  return value ? value.slice(0, 10) : fallback;
};

/* ----------------------------------------------------------- カードの描画 */

/**
 * ニュースカード。A/B/C/D の4ブロックを必ず同じカード内に置く（仕様§15.3）。
 */
function renderCard(event, index) {
  const facts = [];
  if (event.occurredAt) facts.push(['発生日', JST_DATE(event.occurredAt)]);
  if (event.publishedAt) facts.push(['公表日', JST_DATE(event.publishedAt)]);
  if (event.updatedAt) facts.push(['更新日', JST_DATE(event.updatedAt)]);
  if (typeof event.affectedCount === 'number') {
    facts.push(['影響', `${event.affectedCount.toLocaleString('ja-JP')}${event.affectedCountUnit ?? ''}`]);
  } else if (event.eventClass !== 'public_communication') {
    facts.push(['影響件数', '未公表']);
  }
  facts.push(['独立媒体数', String(event.independentMediaCount ?? 0)]);
  facts.push(['影響度 / 話題度', `${event.impactScore} / ${event.attentionScore}`]);

  const factRows = facts
    .map(([label, value]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`)
    .join('');

  const unknowns = (event.unknowns ?? [])
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('');

  const sources = (event.sources ?? [])
    .map((source) => externalLink(source.url, SOURCE_LINK_TEXT[source.type] ?? '出典を開く'))
    .join('');

  const voices = (event.publicVoices ?? [])
    .map(
      (voice) =>
        `<li>${escapeHtml(voice.summary)}<span class="voice-meta">${escapeHtml(voice.platform)}／取得 ${escapeHtml(JST(voice.observedAt))}</span></li>`,
    )
    .join('');

  return `
      <article class="card" id="event-${escapeHtml(event.id)}">
        <header class="card-head">
          <span class="card-index" aria-hidden="true">${index}</span>
          <div>
            <h3>${escapeHtml(event.title)}</h3>
            <ul class="badges">
              <li class="badge sev-${escapeHtml(event.severity)}">重要度：${escapeHtml(SEVERITY_LABEL[event.severity] ?? event.severity)}</li>
              <li class="badge">${escapeHtml(STATUS_LABEL[event.status] ?? event.status)}</li>
              <li class="badge">${escapeHtml(DELTA_LABEL[event.deltaStatus] ?? event.deltaStatus)}</li>
              ${event.systemLayer ? `<li class="badge">${escapeHtml(event.systemLayer)}</li>` : ''}
              ${event.primarySourceConfirmed ? '<li class="badge ok">一次情報あり</li>' : '<li class="badge warn">一次情報未確認</li>'}
              ${event.reviewStatus === 'review_required' ? '<li class="badge warn">要レビュー</li>' : ''}
            </ul>
          </div>
        </header>

        <section class="block">
          <h4>A. ニュース自体</h4>
          <p>${escapeHtml(event.summary)}</p>
          ${event.whatIsNew ? `<p class="whatsnew">${escapeHtml(event.whatIsNew)}</p>` : ''}
          <ul class="facts">${factRows}</ul>
        </section>

        <section class="block">
          <h4>B. 国民の声・現場の声</h4>
          ${voices ? `<ul class="voices">${voices}</ul>` : `<p class="novoice">${escapeHtml(voiceTextFor(event))}</p>`}
          <p class="note">SNS・アプリストアの反応は非代表サンプルです。全国世論へ一般化しません。</p>
        </section>

        <section class="block">
          <h4>C. 事実関係・補足</h4>
          ${unknowns ? `<ul class="unknowns">${unknowns}</ul>` : '<p>現時点で確認できていない項目はありません。</p>'}
          ${(event.officialAction ?? []).length > 0 ? `<p class="denial">公式の記載：${escapeHtml(event.officialAction.join(' / '))}</p>` : ''}
        </section>

        <section class="block">
          <h4>D. 出典・リンク</h4>
          <div class="srcrow">${sources || '<span class="src-broken">出典を確認できませんでした。</span>'}</div>
        </section>
      </article>`;
}

function renderSection(title, events, emptyText) {
  if (events.length === 0) return `<h2>${escapeHtml(title)}</h2><p class="empty">${escapeHtml(emptyText)}</p>`;
  return `<h2>${escapeHtml(title)}</h2>${events.map((event, i) => renderCard(event, i + 1)).join('')}`;
}

/* ------------------------------------------------------------------ 本体 */

/**
 * 日別レポートHTMLを組む。
 *
 * 単一ファイル・UTF-8・Meiryo優先・印刷でカードが分断されにくい構成（仕様§16）。
 */
export function renderDailyReport({ run, events, report, siteUrl }) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const pick = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);

  const negative = pick(report.negativeEventIds);
  const positive = pick(report.positiveEventIds);
  const pr = pick(report.prEventIds);
  // ネガ／ポジ／広報のどれにも入らない事象。ここが無く、制度変更や
  // 種別未確定の新規報道がカードとして表示されないまま消えていた
  const other = pick(report.otherEventIds ?? []);
  const watch = pick(report.watchEventIds);

  const diffRows = events
    .filter((event) => event.dashboardVisible)
    .map(
      (event) => `
            <tr>
              <th scope="row">${escapeHtml(DELTA_LABEL[event.deltaStatus] ?? event.deltaStatus)}</th>
              <td>${escapeHtml(event.title)}</td>
              <td>${escapeHtml(event.whatIsNew ?? '―')}</td>
            </tr>`,
    )
    .join('');

  const watchRows = watch
    .map(
      (event, index) => `
            <li><span class="rank" aria-hidden="true">${index + 1}</span>
            <div><strong>${escapeHtml(event.title)}</strong>
            <p>${escapeHtml((event.unknowns ?? []).join(' / ') || '推移を確認します。')}</p></div></li>`,
    )
    .join('');

  const allSources = [...new Map(events.flatMap((e) => e.sources ?? []).map((s) => [s.url, s])).values()];
  const sourceList = allSources
    .map((source) => `<li>${escapeHtml(source.publisher)}｜${externalLink(source.url, source.label || '出典を開く')}</li>`)
    .join('');

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>マイナ関連 朝の動向レポート ${escapeHtml(report.reportDate)}</title>
    <style>
      :root{--ink:#1d2433;--muted:#667085;--line:#e3e7ee;--bg:#f4f6fa;--purple:#6741c7;
        --red:#b42318;--red-bg:#fff1f0;--amber:#b54708;--amber-bg:#fffaeb;--green:#067647;--green-bg:#ecfdf3;--gray-bg:#f2f4f7}
      *{box-sizing:border-box}
      body{margin:0;background:var(--bg);color:var(--ink);line-height:1.65;
        font-family:'Meiryo UI','Meiryo','Yu Gothic UI','Yu Gothic',Arial,sans-serif}
      .wrap{max-width:1040px;margin:0 auto;padding:0 18px 48px}
      header.hero{background:linear-gradient(135deg,#1c1730,#4b3189 62%,#886ce0);color:#fff;padding:26px 22px}
      header.hero .inner{max-width:1040px;margin:0 auto}
      header.hero p.kicker{margin:0;font-size:10px;letter-spacing:.09em;opacity:.8;text-transform:uppercase}
      header.hero h1{margin:6px 0;font-size:26px}
      header.hero p.window{margin:0;font-size:12px;opacity:.92}
      h2{font-size:17px;margin:30px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--purple)}
      .summary{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-top:18px}
      .summary p{margin:0 0 8px;font-size:13px}
      .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
      .card-head{display:flex;gap:11px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:11px;margin-bottom:12px}
      .card-index{display:inline-grid;place-items:center;width:23px;height:23px;flex:none;border-radius:6px;background:#181326;color:#fff;font-size:11px;font-weight:800}
      .card-head h3{margin:0 0 6px;font-size:15px;line-height:1.45}
      .badges{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}
      .badge{font-size:10px;font-weight:700;border:1px solid var(--line);background:var(--gray-bg);color:#475467;border-radius:999px;padding:2px 8px}
      .badge.sev-critical,.badge.sev-high{background:var(--red-bg);border-color:#fbc9c4;color:var(--red)}
      .badge.sev-medium{background:var(--amber-bg);border-color:#fde3b0;color:var(--amber)}
      .badge.ok{background:var(--green-bg);border-color:#b7ebc9;color:var(--green)}
      .badge.warn{background:var(--amber-bg);border-color:#fde3b0;color:var(--amber)}
      .block{margin-bottom:13px}
      .block:last-child{margin-bottom:0}
      .block h4{margin:0 0 6px;font-size:11px;font-weight:800;color:var(--purple)}
      .block p{margin:0 0 7px;font-size:12.5px}
      .whatsnew{color:var(--purple);font-weight:700}
      .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:9px 0 0;padding:0;list-style:none}
      .facts li{border:1px solid var(--line);border-radius:9px;background:#fbfbfe;padding:7px 9px}
      .facts span{display:block;font-size:9.5px;color:var(--muted)}
      .facts strong{display:block;font-size:12.5px}
      .voices,.unknowns{margin:0 0 7px;padding-left:18px}
      .voices li,.unknowns li{font-size:12px;margin-bottom:4px}
      .voice-meta{display:block;font-size:10px;color:var(--muted)}
      .novoice{color:var(--muted)}
      .denial{font-size:11.5px;background:var(--gray-bg);border-radius:8px;padding:7px 9px}
      .note{font-size:10.5px;color:var(--muted);margin:0}
      .srcrow{display:flex;flex-wrap:wrap;gap:7px}
      a.src{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:6px 11px;border:1px solid #d9d0f5;
        background:#f7f3ff;color:#4b2fa8;border-radius:8px;font-size:11.5px;font-weight:700;text-decoration:none;pointer-events:auto}
      a.src:hover{background:#efe8ff}
      a.src:focus-visible{outline:3px solid #7a5af8;outline-offset:2px}
      .src-host{font-weight:400;color:var(--muted);font-size:10px}
      .src-broken{font-size:11px;color:var(--muted)}
      table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
      th,td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}
      thead th{background:var(--gray-bg);font-size:11px;color:#475467}
      .watch{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:9px}
      .watch li{display:flex;gap:8px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
      .rank{display:inline-grid;place-items:center;width:19px;height:19px;flex:none;border-radius:5px;background:var(--purple);color:#fff;font-size:10px}
      .watch strong{font-size:12px}
      .watch p{margin:2px 0 0;font-size:11px;color:var(--muted)}
      .sources{margin:0;padding-left:18px}
      .sources li{font-size:11.5px;margin-bottom:5px}
      .empty{font-size:12.5px;color:var(--muted);background:#fff;border:1px dashed var(--line);border-radius:10px;padding:14px}
      footer{margin-top:32px;font-size:11px;color:var(--muted)}
      @media (max-width:820px){.facts{grid-template-columns:repeat(2,1fr)}.watch{grid-template-columns:1fr}header.hero h1{font-size:21px}}
      @media print{body{background:#fff}.card,.summary,.watch li{box-shadow:none;break-inside:avoid;page-break-inside:avoid}
        a.src{text-decoration:underline}h2{break-after:avoid}}
    </style>
  </head>
  <body>
    <header class="hero">
      <div class="inner">
        <p class="kicker">DAILY MONITORING / MY NUMBER &amp; MYNA INSURANCE CARD</p>
        <h1>マイナ関連 朝の動向レポート</h1>
        <p class="window">${escapeHtml(report.reportDate)}｜主対象：${escapeHtml(JST(run.primaryWindowStart))} 〜 ${escapeHtml(JST(run.primaryWindowEnd))} JST（直近24時間）</p>
      </div>
    </header>

    <div class="wrap">
      <section class="summary">
        <h2 style="margin-top:4px">今朝の総括</h2>
        <p>${escapeHtml(report.summary)}</p>
      </section>

      <h2>前日からの差分</h2>
      ${
        diffRows
          ? `<table><caption class="note" style="text-align:left;padding:8px 10px">前日から動いた項目</caption>
        <thead><tr><th scope="col">差分</th><th scope="col">事象</th><th scope="col">内容</th></tr></thead>
        <tbody>${diffRows}</tbody></table>`
          : '<p class="empty">掲載対象の事象がありません。</p>'
      }

      ${renderSection('ネガティブなニュース／要注意', negative, '直近24時間で、掲載対象となる新たなネガティブ事象は確認できませんでした。')}
      ${renderSection('ポジティブなニュース／制度・運用の前進', positive, '掲載対象となる前進事象は確認できませんでした。')}
      ${renderSection('広報・SNS炎上／批判動向', pr, '直近24時間で、新たな行政広報案件は確認できませんでした。')}
      ${renderSection('その他の新規の動き', other, '上記3区分に入らない新規の動きはありません。')}

      <h2>今日の優先ウォッチ</h2>
      ${watchRows ? `<ol class="watch">${watchRows}</ol>` : '<p class="empty">優先して確認すべき項目はありません。</p>'}

      <h2>主な情報源</h2>
      ${sourceList ? `<ul class="sources">${sourceList}</ul>` : '<p class="empty">出典がありません。</p>'}

      <footer>
        <p>検索 ${escapeHtml(String(run.queries.length))} 本を実行しました。「確認できず」は公開情報・主要報道・取得できた公式情報の範囲での判断であり、存在しないことの証明ではありません。</p>
        <p>SNS・Yahoo!コメント・アプリストアのレビューは全国世論を代表しません。「炎上」は批判の存在だけでなく、反応量・二次転載・主要媒体への波及・公式対応を確認して評価しています。</p>
        <p>${externalLink(siteUrl ?? 'https://myna-monitoring-jp.github.io/', 'モニタリングポータルを開く')}</p>
      </footer>
    </div>
  </body>
</html>
`;
}
