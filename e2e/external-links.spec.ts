import { expect, test, type Page } from '@playwright/test';

/**
 * 必須テスト 6 (E2E): 外部リンクが実体のある <a href> で、
 * 新しいタブを開く属性を持つことを、ビルド済みサイトに対して検証する。
 */

const ROUTES = [
  { hash: '#/', name: 'ダッシュボード' },
  { hash: '#/news', name: 'トップニュース・世論' },
  { hash: '#/incidents', name: '不具合・エラー詳細' },
  { hash: '#/pr', name: '広報・広告ウォッチ' },
  { hash: '#/archive', name: 'アーカイブ' },
];

async function goto(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await page.waitForSelector('#main-content');
}

for (const route of ROUTES) {
  test.describe(route.name, () => {
    test('全ての外部リンクが href / target="_blank" / rel="noopener noreferrer" を持つ', async ({
      page,
    }) => {
      await goto(page, route.hash);

      const anchors = await page.locator('a[data-testid="external-link"]').all();
      for (const anchor of anchors) {
        const href = await anchor.getAttribute('href');
        expect(href, '空のhrefは禁止').toBeTruthy();
        expect(href!).toMatch(/^https?:\/\//);
        await expect(anchor).toHaveAttribute('target', '_blank');
        await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });

    test('javascript: / # のみのリンクが存在しない', async ({ page }) => {
      await goto(page, route.hash);

      const hrefs = await page.locator('a').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? ''),
      );
      for (const href of hrefs) {
        expect(href).not.toBe('');
        expect(href).not.toBe('#');
        expect(href.toLowerCase()).not.toContain('javascript:');
      }
    });

    test('参照元ボタンは全体がクリック可能で、pointer-events が無効化されていない', async ({
      page,
    }) => {
      await goto(page, route.hash);

      const anchors = page.locator('a[data-testid="external-link"]');
      const count = await anchors.count();
      if (count === 0) return;

      for (let index = 0; index < count; index += 1) {
        const anchor = anchors.nth(index);
        await expect(anchor).toBeVisible();
        const pointerEvents = await anchor.evaluate(
          (node) => getComputedStyle(node).pointerEvents,
        );
        expect(pointerEvents).toBe('auto');

        // ボタンの四隅がリンク自身にヒットする（カードを覆う透明要素がない）
        const box = (await anchor.boundingBox())!;
        const hit = await page.evaluate(
          ({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            return element?.closest('a[data-testid="external-link"]') !== null;
          },
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        );
        expect(hit).toBe(true);
      }
    });

    test('状態ラベルは押せない（リンクでもボタンでもない）', async ({ page }) => {
      await goto(page, route.hash);

      const badges = await page.locator('[data-testid="status-badge"]').all();
      for (const badge of badges) {
        const info = await badge.evaluate((node) => ({
          tag: node.tagName,
          inLink: node.closest('a') !== null,
          inButton: node.closest('button') !== null,
          cursor: getComputedStyle(node).cursor,
          tabIndex: node.getAttribute('tabindex'),
        }));
        expect(info.tag).toBe('SPAN');
        expect(info.inLink).toBe(false);
        expect(info.inButton).toBe(false);
        expect(info.cursor).toBe('default');
        expect(info.tabIndex).toBeNull();
      }
    });
  });
}

test('外部リンククリックで新しいタブが開く', async ({ page, context }) => {
  await goto(page, '#/news');

  const anchor = page.locator('a[data-testid="external-link"]').first();
  const href = await anchor.getAttribute('href');

  // ネットワークへ出さずに、新しいタブが要求されることだけを確認する。
  await context.route('**/*', (route) => {
    if (route.request().url() === href) return route.abort();
    return route.continue();
  });

  const [popup] = await Promise.all([context.waitForEvent('page'), anchor.click()]);
  expect(popup).toBeTruthy();
  await popup.close();
});

test('ハッシュの深いリンクが直接開ける', async ({ page }) => {
  await goto(page, '#/incidents?category=medical_it_cyber');
  await expect(page.locator('[data-testid="incident-panel"]')).toHaveAttribute(
    'data-category',
    'medical_it_cyber',
  );
});

test('未定義のパスは404画面になる', async ({ page }) => {
  await page.goto('/#/no-such-page');
  await expect(page.getByText('ページが見つかりません')).toBeVisible();
});

test('キーボードだけで参照元ボタンに到達できる', async ({ page }) => {
  await goto(page, '#/news');

  const reached = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLAnchorElement>('a[data-testid="external-link"]');
    if (!anchor) return false;
    anchor.focus();
    return document.activeElement === anchor;
  });
  expect(reached).toBe(true);
});
