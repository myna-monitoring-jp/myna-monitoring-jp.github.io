import { FEEDBACK_REPO } from '@/config/appConfig';

/**
 * 改修要望の投稿。
 *
 * 静的サイトなので投稿を受け取るサーバがない。代わりに GitHub Issue を使う：
 * 画面上のフォームで書いてもらい、本文を組み立てた new-issue URL を開くだけ。
 * 投稿者は GitHub 側で「Submit new issue」を押すだけで済む。
 *
 * タイトル接頭辞でフィルタできるようにしておく（ラベルは権限がないと付かないため）。
 */

export const FEEDBACK_TITLE_PREFIX = '[改修要望]';

/** GitHub Issue の URL 長に収まるよう本文を制限する。 */
const MAX_BODY_LENGTH = 6000;

export const FEEDBACK_KINDS = [
  '見にくい・分かりにくい',
  '情報が足りない',
  '分類・状態の判定がおかしい',
  '操作しにくい',
  '不具合・表示崩れ',
  '新しい画面・機能がほしい',
  'その他',
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_PRIORITIES = ['高（業務が止まる）', '中（不便）', '低（あれば嬉しい）'] as const;

export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export interface FeedbackDraft {
  /** 対象画面の表示名 */
  screen: string;
  kind: FeedbackKind;
  /** 今どうなっているか（任意） */
  current: string;
  /** こうしたい（必須） */
  wanted: string;
  /** 理由・困っていること（任意） */
  reason: string;
  priority: FeedbackPriority;
  /** 記入者名（任意） */
  author: string;
}

export interface FeedbackContext {
  /** 投稿時に開いていたURL */
  url: string;
  /** データ基準時刻 */
  generatedAt: string;
  /** 画面幅。表示崩れの再現に使う */
  viewport: string;
  submittedAt: string;
}

export function emptyDraft(screen: string): FeedbackDraft {
  return {
    screen,
    kind: FEEDBACK_KINDS[0],
    current: '',
    wanted: '',
    reason: '',
    priority: FEEDBACK_PRIORITIES[1],
    author: '',
  };
}

/** 必須項目が埋まっているか。 */
export function isSubmittable(draft: FeedbackDraft): boolean {
  return draft.wanted.trim().length > 0;
}

export function buildIssueTitle(draft: FeedbackDraft): string {
  const summary = draft.wanted.trim().replace(/\s+/g, ' ').slice(0, 60);
  return `${FEEDBACK_TITLE_PREFIX} ${draft.screen}：${summary}`;
}

export function buildIssueBody(draft: FeedbackDraft, context: FeedbackContext): string {
  const lines = [
    '## こうしたい',
    draft.wanted.trim(),
    '',
    '## 今どうなっているか',
    draft.current.trim() || '（記入なし）',
    '',
    '## 理由・困っていること',
    draft.reason.trim() || '（記入なし）',
    '',
    '## 区分',
    `- 対象画面：${draft.screen}`,
    `- 種別：${draft.kind}`,
    `- 優先度：${draft.priority}`,
    `- 記入者：${draft.author.trim() || '（匿名）'}`,
    '',
    '## 環境（自動記録）',
    `- URL：${context.url}`,
    `- データ基準時刻：${context.generatedAt}`,
    `- 画面幅：${context.viewport}`,
    `- 投稿日時：${context.submittedAt}`,
    '',
    '<!-- このIssueは画面の「改修要望」ボタンから作成されました。週次でまとめて検討します。 -->',
  ];

  const body = lines.join('\n');
  return body.length > MAX_BODY_LENGTH ? `${body.slice(0, MAX_BODY_LENGTH)}\n…（省略）` : body;
}

/** GitHub の new-issue URL。本文・タイトル・ラベルを事前入力する。 */
export function buildIssueUrl(draft: FeedbackDraft, context: FeedbackContext): string {
  const params = new URLSearchParams({
    title: buildIssueTitle(draft),
    body: buildIssueBody(draft, context),
    labels: '改修要望',
  });
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${params.toString()}`;
}

/** 投稿済み一覧（誰が何を出したかを確認する導線）。 */
export function feedbackListUrl(): string {
  const query = `is:issue label:改修要望`;
  return `https://github.com/${FEEDBACK_REPO}/issues?q=${encodeURIComponent(query)}`;
}
