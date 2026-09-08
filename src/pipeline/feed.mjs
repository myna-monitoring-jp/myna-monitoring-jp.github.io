/**
 * RSS/Atom の読み取り。
 *
 * 専用パーサを持ち込まず正規表現で扱う。扱う相手が
 * Google News RSS と官公庁の新着RSSに限られ、形が安定しているため。
 *
 * 実体参照の復元はタグ落としの「前」に行う。順序を逆にすると、
 * 二重エスケープされた本文（Google News の `&amp;lt;a href=...`）から
 * 生のタグが文字列として残る。実際に画面へ出た不具合。
 */

import { decodeEntities } from './fetch.mjs';

export function toPlainText(html) {
  return decodeEntities(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Google News の表題は「見出し - 媒体名」。媒体名を表題に残さない。 */
export function splitTitle(raw) {
  const text = String(raw ?? '').trim();
  const index = text.lastIndexOf(' - ');
  if (index <= 0 || text.length - index - 3 > 40) return { title: text, publisher: '' };
  return { title: text.slice(0, index).trim(), publisher: text.slice(index + 3).trim() };
}

/** 概要が表題（＋媒体名）の焼き直しにすぎないか。 */
export function isEchoOfTitle(description, title, publisher) {
  const squash = (value) => String(value ?? '').replace(/\s+/g, '');
  const body = squash(description);
  if (!body) return true;
  return body.replace(squash(title), '').replace(squash(publisher), '').length <= 4;
}

/**
 * 一覧ページから子リンクを抽出する。
 *
 * RSSを持たないが重要な情報源が多い。実際に取りこぼしていたもの：
 *  - 政府広報オンラインのCM一覧（マイナアプリCMはここにしか無い）
 *  - 政府広報オンラインの新聞広告一覧（マイナ救急の新聞広告）
 *  - 地方厚生局の医療保険関係通知（災害時の受診特例の事務連絡）
 *
 * アンカー文字列も一緒に持ち帰る。厚生局の通知はPDFで本文を取れないが、
 * リンクの文字列自体が「何の通知か」を伝えている。
 *
 * 件数制限は**絞り込んだ後**に適用する。
 * 先に打ち切ると、ページ先頭のナビゲーション（サイトマップ、お問い合わせ等）で
 * 枠を使い切り、本文中の通知一覧へ到達しない。実際に厚生局の通知が
 * 1件も取れていなかった原因はこれだった。
 *
 * @param {string} html 一覧ページのHTML
 * @param {string} base 相対URLを解決する基点
 * @param {RegExp} pattern 子リンクの絶対URLに対する条件
 * @param {number} [limit] 絞り込み後に残す件数
 * @param {(text: string) => boolean} [textFilter] アンカー文字列に対する条件
 * @returns {{url: string, text: string}[]}
 */
export function extractIndexLinks(html, base, pattern, limit = 60, textFilter) {
  const found = [];
  const seen = new Set();

  for (const match of String(html ?? '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let absolute;
    try {
      absolute = new URL(decodeEntities(match[1]), base).toString();
    } catch {
      continue;
    }
    if (!pattern.test(absolute) || seen.has(absolute)) continue;

    const text = toPlainText(match[2]).slice(0, 120);
    // 文字列の条件は打ち切りの前に見る
    if (textFilter && text && !textFilter(text)) continue;

    seen.add(absolute);
    found.push({ url: absolute, text });
    if (found.length >= limit) break;
  }

  return found;
}

export function parseFeed(xml) {
  const source = String(xml ?? '');
  const blocks =
    source.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? source.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];

  return blocks.flatMap((block) => {
    const pick = (tag) => {
      const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return match ? toPlainText(match[1]) : '';
    };

    const rawTitle = pick('title');
    let link = pick('link');
    if (!link) link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? '';
    if (!rawTitle || !link) return [];

    const { title, publisher } = splitTitle(rawTitle);
    const dateText = pick('pubDate') || pick('dc:date') || pick('updated') || pick('published');
    const parsed = dateText ? new Date(dateText) : null;
    const description = pick('description') || pick('summary');

    return [
      {
        title,
        publisher,
        link,
        pubDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
        description: isEchoOfTitle(description, title, publisher) ? '' : description,
        // Google News は媒体のトップURLをここに入れてくる。Tier判定に使う
        sourceUrl: block.match(/<source[^>]*url=["']([^"']+)["']/i)?.[1] ?? '',
      },
    ];
  });
}
