import { afterEach, vi } from 'vitest';

/**
 * テスト共通のセットアップ。
 *
 * `updatePipeline.test.ts` は子プロセスとHTTPサーバを扱うため node 環境で動く。
 * DOM が無い環境でも読み込まれるので、DOM 依存の初期化は条件付きにする。
 */
const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

if (hasDom) {
  await import('@testing-library/jest-dom/vitest');

  // jsdom は scrollTo を実装していない。ルート遷移で呼ばれるため補う。
  if (!window.scrollTo) {
    Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });
  }
}

afterEach(async () => {
  if (hasDom) {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
  vi.restoreAllMocks();
});
