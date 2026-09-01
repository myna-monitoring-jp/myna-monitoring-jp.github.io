import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildShareUrl, copyToClipboard, currentShareUrl } from '@/lib/share';
import { removeClipboard, stubClipboard, stubExecCommand } from '@/test/clipboard';

/** 必須テスト 7: URLコピー */
describe('共有URL', () => {
  it('画面ごとのハッシュURLを組み立てる', () => {
    expect(buildShareUrl('news')).toContain('#/news');
    expect(buildShareUrl('dashboard')).toContain('#/');
  });

  it('クエリを付けた深いリンクを作れる', () => {
    expect(buildShareUrl('incidents', { category: 'common_system' })).toContain(
      '#/incidents?category=common_system',
    );
  });

  it('未定義のクエリ値は付けない', () => {
    expect(buildShareUrl('pr', { classification: undefined })).not.toContain('?');
  });

  it('現在URLを取得できる', () => {
    expect(currentShareUrl()).toBe(window.location.href);
  });
});

describe('クリップボードコピー', () => {
  beforeEach(() => {
    removeClipboard();
  });

  it('Clipboard APIが使える場合はそれを使う', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyToClipboard('テキスト')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('テキスト');
  });

  it('Clipboard APIが失敗したらexecCommandへフォールバックする', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const execCommand = stubExecCommand(true);

    await expect(copyToClipboard('テキスト')).resolves.toBe('copied');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('どちらも失敗したら failed を返す（例外は投げない）', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    stubExecCommand(false);

    await expect(copyToClipboard('テキスト')).resolves.toBe('failed');
  });

  it('Clipboard APIが解決しない場合もタイムアウトして failed を返す', async () => {
    vi.useFakeTimers();
    try {
      // 永久に解決しないPromiseを返すブラウザ実装を模す
      stubClipboard(vi.fn().mockReturnValue(new Promise(() => undefined)));
      stubExecCommand(false);

      const promise = copyToClipboard('テキスト');
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('フォールバックのtextareaを opacity:0 や display:none にしない（Chromeがコピーを拒否するため）', async () => {
    removeClipboard();
    let captured: { opacity: string; display: string } | null = null;
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => {
        const node = document.querySelector('textarea');
        if (node) {
          captured = { opacity: node.style.opacity, display: node.style.display };
        }
        return true;
      }),
      configurable: true,
      writable: true,
    });

    await copyToClipboard('テキスト');
    expect(captured).not.toBeNull();
    expect(captured!.opacity).not.toBe('0');
    expect(captured!.display).not.toBe('none');
  });

  it('フォールバック時にDOMへtextareaを残さない', async () => {
    removeClipboard();
    stubExecCommand(true);

    await copyToClipboard('テキスト');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
