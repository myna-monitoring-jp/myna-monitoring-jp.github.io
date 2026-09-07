import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/App';
import { NOW, makeFullDataset } from '@/test/fixtures';

/**
 * 必須テスト 6: 外部リンクの href / target / rel
 *
 * Renders every route and asserts the link contract on all rendered anchors.
 * The Playwright suite in `e2e/` performs the same check against the built site.
 */

const ROUTES = ['/', '/news', '/incidents', '/pr', '/archive'];

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App initialDataset={makeFullDataset()} now={NOW} />
    </MemoryRouter>,
  );
}

function anchorsOf(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'));
}

describe.each(ROUTES)('外部リンクの契約（%s）', (route) => {
  it('空のhref・#のみ・javascript: のリンクが存在しない', () => {
    const { container } = renderRoute(route);
    for (const anchor of anchorsOf(container)) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href).not.toBe('');
      expect(href).not.toBe('#');
      expect(href.toLowerCase()).not.toContain('javascript:');
    }
  });

  it('外部リンクはすべて target="_blank" と rel="noopener noreferrer" を持つ', () => {
    const { container } = renderRoute(route);
    const external = anchorsOf(container).filter((a) =>
      /^https?:\/\//i.test(a.getAttribute('href') ?? ''),
    );
    expect(external.length).toBeGreaterThan(0);
    for (const anchor of external) {
      expect(anchor).toHaveAttribute('target', '_blank');
      const rel = anchor.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
  });

  it('参照元ボタンの文言が「○○を開く」形式で明示されている', () => {
    const { container } = renderRoute(route);
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>(
      '[data-testid="external-link"]',
    )) {
      expect(anchor.textContent ?? '').toMatch(/を開く/);
    }
  });

  it('カード全体を覆う透明リンク・オーバーレイが存在しない', () => {
    const { container } = renderRoute(route);
    // An overlay link would wrap a card/article element. Reference anchors must
    // never contain block-level card markup.
    for (const anchor of anchorsOf(container)) {
      expect(anchor.querySelector('article')).toBeNull();
      expect(anchor.querySelector('.card')).toBeNull();
      expect(anchor.querySelector('.pr-item')).toBeNull();
      expect(anchor.querySelector('table')).toBeNull();
    }
  });

  it('状態ラベルがリンクの内側に入っていない', () => {
    const { container } = renderRoute(route);
    for (const badge of container.querySelectorAll('[data-testid="status-badge"]')) {
      expect(badge.closest('a')).toBeNull();
      expect(badge.closest('button')).toBeNull();
    }
  });

  it('内部ナビゲーションは新しいタブを開かない', () => {
    const { container } = renderRoute(route);
    const internal = anchorsOf(container).filter((a) => {
      const href = a.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) return false;
      /*
       * 日別レポートは例外。
       * SPA内の画面遷移ではなく、調査パイプラインが生成する別の静的HTML文書で、
       * 印刷や添付に使う。別タブで開くのが正しい挙動。
       */
      if (/reports\/myna_news_\d{4}-\d{2}-\d{2}\.html$/.test(href)) return false;
      return true;
    });
    for (const anchor of internal) {
      expect(anchor).not.toHaveAttribute('target', '_blank');
    }
  });

  it('日別レポートは別タブで開き、rel も付ける', () => {
    const { container } = renderRoute(route);
    const report = anchorsOf(container).find((a) =>
      /reports\/myna_news_\d{4}-\d{2}-\d{2}\.html$/.test(a.getAttribute('href') ?? ''),
    );
    // 導線はダッシュボードにだけあるので、存在するときだけ検査する
    if (!report) return;
    expect(report).toHaveAttribute('target', '_blank');
    expect(report).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('参照元ボタンのアクセシビリティ', () => {
  it('新しいタブで開くことをアクセシブル名に含める', () => {
    const { container } = renderRoute('/news');
    const anchor = container.querySelector<HTMLAnchorElement>('[data-testid="external-link"]')!;
    expect(anchor.getAttribute('aria-label')).toContain('新しいタブで開きます');
  });

  it('キーボードで到達できる（tabindex=-1 を付けない）', () => {
    const { container } = renderRoute('/news');
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>(
      '[data-testid="external-link"]',
    )) {
      expect(anchor.getAttribute('tabindex')).not.toBe('-1');
    }
  });
});
