// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 404 ページの自動復帰のテスト。
 *
 * 実際に配信される public/404.html から関数を抜き出して検証する。
 * 別ファイルに書き写すと本番の挙動と乖離するため、抜き出す方式にしている。
 *
 * 直す動機：共有文の丸括弧が一緒にコピーされて `.../github.io/)` になり
 * 「開けない」という事故が起きた。社内配布するURLが1文字で行き止まりに
 * なるのは共有物として問題がある。
 */

function loadResolveFallback(): (href: string) => string {
  const html = readFileSync('public/404.html', 'utf8');
  const match = html.match(/\/\* @testable:start[\s\S]*?\*\/([\s\S]*?)\/\* @testable:end \*\//);
  if (!match) throw new Error('404.html から @testable ブロックを抜き出せませんでした。');
  // 関数宣言を評価して取り出す
  return new Function(`${match[1]}; return resolveFallback;`)() as (href: string) => string;
}

const resolveFallback = loadResolveFallback();

const ROOT = 'https://myna-monitoring-jp.github.io';

describe('404ページの自動復帰', () => {
  it('末尾に丸括弧が混ざったURLをトップへ戻す（実際に起きた事故）', () => {
    expect(resolveFallback(`${ROOT}/)`)).toBe(`${ROOT}/`);
  });

  it('全角の括弧・句読点が混ざった場合も戻す', () => {
    for (const junk of ['）', '」', '。', '、', '.', ',', ';', ']', '}']) {
      expect(resolveFallback(`${ROOT}/${junk}`)).toBe(`${ROOT}/`);
    }
  });

  it('ハッシュを省いたパス指定は該当画面へ振り替える', () => {
    expect(resolveFallback(`${ROOT}/news`)).toBe(`${ROOT}/#/news`);
    expect(resolveFallback(`${ROOT}/incidents`)).toBe(`${ROOT}/#/incidents`);
    expect(resolveFallback(`${ROOT}/pr`)).toBe(`${ROOT}/#/pr`);
    expect(resolveFallback(`${ROOT}/archive`)).toBe(`${ROOT}/#/archive`);
  });

  it('画面名の末尾に記号が付いていても振り替える', () => {
    expect(resolveFallback(`${ROOT}/news)`)).toBe(`${ROOT}/#/news`);
  });

  it('知らない画面名はダッシュボードへ戻す', () => {
    expect(resolveFallback(`${ROOT}/dashboard`)).toBe(`${ROOT}/`);
    expect(resolveFallback(`${ROOT}/totally-unknown`)).toBe(`${ROOT}/`);
  });

  it('共有された深いリンクのハッシュは保持する', () => {
    expect(resolveFallback(`${ROOT}/)#/incidents?category=common_system`)).toBe(
      `${ROOT}/#/incidents?category=common_system`,
    );
  });

  it('サブディレクトリ配信でもサイトのルートへ戻す（絶対パスを埋め込まない）', () => {
    expect(resolveFallback('https://example.github.io/myna-portal/)')).toBe(
      'https://example.github.io/myna-portal/',
    );
    expect(resolveFallback('https://example.github.io/myna-portal/news')).toBe(
      'https://example.github.io/myna-portal/#/news',
    );
  });

  it('戻り先は必ず同じオリジンになる（外部へ飛ばさない）', () => {
    for (const path of ['/)', '/news', '/unknown', '//evil.example.com']) {
      expect(new URL(resolveFallback(`${ROOT}${path}`)).origin).toBe(ROOT);
    }
  });
});
