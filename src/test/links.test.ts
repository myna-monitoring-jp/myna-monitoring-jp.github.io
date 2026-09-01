import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_LINK_ATTRS,
  isLinkableSource,
  isUsableExternalUrl,
  partitionSources,
  sourceLinkText,
} from '@/lib/links';
import type { Source } from '@/types/monitoring';

/** 必須テスト 6 の一部: 参照元URLの妥当性 */
describe('外部URLの判定', () => {
  it('http(s)の絶対URLだけを許可する', () => {
    expect(isUsableExternalUrl('https://www.digital.go.jp/')).toBe(true);
    expect(isUsableExternalUrl('http://example.com/a')).toBe(true);
  });

  it('空のhref・#・javascript: を拒否する', () => {
    expect(isUsableExternalUrl('')).toBe(false);
    expect(isUsableExternalUrl('   ')).toBe(false);
    expect(isUsableExternalUrl('#')).toBe(false);
    expect(isUsableExternalUrl('#/news')).toBe(false);
    expect(isUsableExternalUrl('javascript:void(0)')).toBe(false);
    expect(isUsableExternalUrl('JavaScript:void(0);')).toBe(false);
    expect(isUsableExternalUrl('about:blank')).toBe(false);
  });

  it('相対パスやdata:を拒否する', () => {
    expect(isUsableExternalUrl('/news')).toBe(false);
    expect(isUsableExternalUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isUsableExternalUrl(undefined)).toBe(false);
    expect(isUsableExternalUrl(null)).toBe(false);
  });
});

describe('出典のリンク可否', () => {
  const base: Source = { type: 'primary', label: '出典', url: 'https://example.com/a' };

  it('active:false はリンクにしない', () => {
    expect(isLinkableSource({ ...base, active: false })).toBe(false);
  });

  it('active未指定なら有効なURLはリンクにする', () => {
    expect(isLinkableSource(base)).toBe(true);
  });

  it('リンク可能なものと切れているものを分けられる', () => {
    const { linkable, broken } = partitionSources([
      base,
      { ...base, url: '#' },
      { ...base, active: false },
    ]);
    expect(linkable).toHaveLength(1);
    expect(broken).toHaveLength(2);
  });
});

describe('ボタン文言', () => {
  it('種類ごとに明確な文言を返す', () => {
    expect(sourceLinkText({ type: 'primary', label: 'a', url: 'https://a.example/' })).toBe(
      '一次情報を開く',
    );
    expect(sourceLinkText({ type: 'media', label: 'a', url: 'https://a.example/' })).toBe(
      '報道記事を開く',
    );
    expect(sourceLinkText({ type: 'survey', label: 'a', url: 'https://a.example/' })).toBe(
      '調査結果を開く',
    );
  });

  it('x.com は「X投稿を開く」になる', () => {
    expect(sourceLinkText({ type: 'social', label: 'a', url: 'https://x.com/u/status/1' })).toBe(
      'X投稿を開く',
    );
  });

  it('linkText の明示指定が優先される', () => {
    expect(
      sourceLinkText({ type: 'primary', label: 'a', url: 'https://a.example/', linkText: '広告を開く' }),
    ).toBe('広告を開く');
  });

  it('「詳細」のような曖昧な既定文言を使わない', () => {
    const texts = (['primary', 'media', 'social', 'survey'] as const).map((type) =>
      sourceLinkText({ type, label: 'a', url: 'https://a.example/' }),
    );
    for (const text of texts) {
      expect(text).toMatch(/を開く$/);
      expect(text).not.toBe('詳細');
    }
  });
});

describe('外部リンク属性の定数', () => {
  it('target と rel が要件どおり', () => {
    expect(EXTERNAL_LINK_ATTRS).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
