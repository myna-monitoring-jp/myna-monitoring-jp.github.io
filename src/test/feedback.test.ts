import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_TITLE_PREFIX,
  buildIssueBody,
  buildIssueTitle,
  buildIssueUrl,
  emptyDraft,
  feedbackListUrl,
  isSubmittable,
  type FeedbackContext,
  type FeedbackDraft,
} from '@/lib/feedback';

const context: FeedbackContext = {
  url: 'https://myna-monitoring-jp.github.io/#/incidents?category=common_system',
  generatedAt: '2026/09/01 18:29 JST',
  viewport: '1400×950',
  submittedAt: '2026/09/01 19:00 JST',
};

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    ...emptyDraft('不具合・エラー詳細'),
    wanted: '前回確認日の列を足してほしい',
    ...overrides,
  };
}

describe('改修要望の投稿', () => {
  it('「こうしたい」が空なら投稿できない', () => {
    expect(isSubmittable(draft({ wanted: '' }))).toBe(false);
    expect(isSubmittable(draft({ wanted: '   ' }))).toBe(false);
    expect(isSubmittable(draft())).toBe(true);
  });

  it('タイトルに接頭辞と対象画面を入れる（週次集計でフィルタするため）', () => {
    const title = buildIssueTitle(draft());
    expect(title.startsWith(FEEDBACK_TITLE_PREFIX)).toBe(true);
    expect(title).toContain('不具合・エラー詳細');
    expect(title).toContain('前回確認日の列を足してほしい');
  });

  it('タイトルが長くなりすぎない', () => {
    const title = buildIssueTitle(draft({ wanted: 'あ'.repeat(300) }));
    expect(title.length).toBeLessThan(120);
  });

  it('本文に区分と環境情報を含める', () => {
    const body = buildIssueBody(
      draft({ current: '今はこう', reason: '二度見してしまう', author: '山下' }),
      context,
    );
    expect(body).toContain('## こうしたい');
    expect(body).toContain('前回確認日の列を足してほしい');
    expect(body).toContain('今はこう');
    expect(body).toContain('二度見してしまう');
    expect(body).toContain('対象画面：不具合・エラー詳細');
    expect(body).toContain('記入者：山下');
    expect(body).toContain(context.url);
    expect(body).toContain('データ基準時刻：2026/09/01 18:29 JST');
    expect(body).toContain('画面幅：1400×950');
  });

  it('任意項目が空なら「記入なし」「匿名」と明示する', () => {
    const body = buildIssueBody(draft({ current: '', reason: '', author: '' }), context);
    expect(body).toContain('（記入なし）');
    expect(body).toContain('記入者：（匿名）');
  });

  it('本文が長すぎる場合は切り詰める（URL長の上限対策）', () => {
    const body = buildIssueBody(draft({ wanted: 'あ'.repeat(20000) }), context);
    expect(body.length).toBeLessThanOrEqual(6100);
    expect(body).toContain('（省略）');
  });

  it('GitHubのnew-issue URLを組み立て、内容をエスケープして載せる', () => {
    const url = new URL(buildIssueUrl(draft(), context));
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/myna-monitoring-jp/myna-monitoring-jp.github.io/issues/new');
    expect(url.searchParams.get('title')).toContain(FEEDBACK_TITLE_PREFIX);
    expect(url.searchParams.get('body')).toContain('## こうしたい');
    expect(url.searchParams.get('labels')).toBe('改修要望');
  });

  it('日本語や記号を含んでも壊れないURLになる', () => {
    const url = buildIssueUrl(
      draft({ wanted: '「要注視」を#1段に & もっと目立たせたい？' }),
      context,
    );
    expect(() => new URL(url)).not.toThrow();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toContain('「要注視」を#1段に & もっと目立たせたい？');
  });

  it('要望一覧のURLはラベルで絞り込む', () => {
    const url = new URL(feedbackListUrl());
    expect(url.pathname).toContain('/issues');
    expect(decodeURIComponent(url.search)).toContain('label:改修要望');
  });

  it('初期値は対象画面を引き継ぎ、優先度は「中」', () => {
    const initial = emptyDraft('ダッシュボード');
    expect(initial.screen).toBe('ダッシュボード');
    expect(initial.priority).toContain('中');
    expect(initial.wanted).toBe('');
  });
});
