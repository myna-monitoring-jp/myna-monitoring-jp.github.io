import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { EXTERNAL_LINK_ATTRS } from '@/lib/links';
import { formatDateTime } from '@/lib/format';
import {
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  buildIssueUrl,
  emptyDraft,
  feedbackListUrl,
  isSubmittable,
  type FeedbackContext,
  type FeedbackDraft,
  type FeedbackKind,
  type FeedbackPriority,
} from '@/lib/feedback';

const SCREEN_NAMES: Record<string, string> = {
  '/': 'ダッシュボード',
  '/news': 'トップニュース・世論',
  '/incidents': '不具合・エラー詳細',
  '/pr': '広報・広告ウォッチ',
  '/archive': 'アーカイブ',
};

const DRAFT_STORAGE_KEY = 'myna-monitoring-feedback-draft';

interface FeedbackButtonProps {
  /** データ基準時刻。表示崩れの再現に使うため本文へ自動記録する。 */
  generatedAt: string;
}

/**
 * 左下の「改修要望」ボタン。
 *
 * 投稿先は GitHub Issue。画面上のフォームに書いてもらい、本文を組み立てた
 * new-issue URL を新しいタブで開く。投稿者は GitHub 側で Submit を押すだけ。
 *
 * 書きかけは localStorage に保存する。誤って閉じても消えないようにするため。
 */
export function FeedbackButton({ generatedAt }: FeedbackButtonProps) {
  const location = useLocation();
  const screen = SCREEN_NAMES[location.pathname] ?? 'その他';

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft>(() => emptyDraft(screen));
  const [submitted, setSubmitted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  /* 書きかけの復元 */
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FeedbackDraft>;
        // 書きかけの文章は復元するが、対象画面は「今開いている画面」を優先する。
        // 別画面で書き始めたときに前回の画面名が残ると誤った宛先になるため。
        setDraft((current) => ({ ...current, ...parsed, screen }));
      } else {
        setDraft(emptyDraft(screen));
      }
    } catch {
      setDraft(emptyDraft(screen));
    }
    setSubmitted(false);
  }, [open, screen]);

  /* 書きかけの保存 */
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // localStorage が使えない環境でも投稿自体は行える
    }
  }, [draft, open]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const context: FeedbackContext = useMemo(
    () => ({
      url: typeof window !== 'undefined' ? window.location.href : '',
      generatedAt: formatDateTime(generatedAt, '未取得'),
      viewport: typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '不明',
      submittedAt: formatDateTime(new Date().toISOString()),
    }),
    [generatedAt],
  );

  const issueUrl = useMemo(() => buildIssueUrl(draft, context), [draft, context]);
  const canSubmit = isSubmittable(draft);

  const update = <K extends keyof FeedbackDraft>(key: K, value: FeedbackDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const handleSubmitted = () => {
    setSubmitted(true);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // 無視してよい
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="feedback-fab"
        data-testid="feedback-fab"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">✎</span>
        改修要望
      </button>

      {open &&
        createPortal(
          <div className="copy-overlay" data-testid="feedback-overlay" onClick={close}>
            <div
              className="copy-dialog feedback-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              data-testid="feedback-dialog"
              ref={dialogRef}
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id={titleId}>改修要望を送る</h2>
              <p className="note">
                「ここが見にくい」「この情報が欲しい」など、気づいたことを気軽に書いてください。
                週次でまとめて検討します。書きかけは自動保存されます。
              </p>

              <div className="feedback-grid">
                <div className="feedback-field feedback-wide">
                  <label htmlFor="fb-wanted">
                    こうしたい <span className="feedback-required">必須</span>
                  </label>
                  <textarea
                    id="fb-wanted"
                    ref={firstFieldRef}
                    rows={3}
                    value={draft.wanted}
                    placeholder="例：不具合一覧に「前回確認日」の列を足してほしい"
                    onChange={(event) => update('wanted', event.target.value)}
                  />
                </div>

                <div className="feedback-field">
                  <label htmlFor="fb-screen">対象画面</label>
                  <select
                    id="fb-screen"
                    value={draft.screen}
                    onChange={(event) => update('screen', event.target.value)}
                  >
                    {[...new Set([...Object.values(SCREEN_NAMES), 'その他'])].map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="feedback-field">
                  <label htmlFor="fb-kind">種別</label>
                  <select
                    id="fb-kind"
                    value={draft.kind}
                    onChange={(event) => update('kind', event.target.value as FeedbackKind)}
                  >
                    {FEEDBACK_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="feedback-field feedback-wide">
                  <label htmlFor="fb-current">今どうなっているか（任意）</label>
                  <textarea
                    id="fb-current"
                    rows={2}
                    value={draft.current}
                    placeholder="例：状態と最終更新は出ているが、自分が前回見た日が分からない"
                    onChange={(event) => update('current', event.target.value)}
                  />
                </div>

                <div className="feedback-field feedback-wide">
                  <label htmlFor="fb-reason">理由・困っていること（任意）</label>
                  <textarea
                    id="fb-reason"
                    rows={2}
                    value={draft.reason}
                    placeholder="例：朝の確認で、どこまで見たか分からず二度見してしまう"
                    onChange={(event) => update('reason', event.target.value)}
                  />
                </div>

                <div className="feedback-field">
                  <label htmlFor="fb-priority">優先度</label>
                  <select
                    id="fb-priority"
                    value={draft.priority}
                    onChange={(event) => update('priority', event.target.value as FeedbackPriority)}
                  >
                    {FEEDBACK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="feedback-field">
                  <label htmlFor="fb-author">お名前（任意）</label>
                  <input
                    id="fb-author"
                    type="text"
                    value={draft.author}
                    placeholder="空欄なら匿名"
                    onChange={(event) => update('author', event.target.value)}
                  />
                </div>
              </div>

              {submitted && (
                <p className="feedback-done" role="status" data-testid="feedback-done">
                  投稿画面を開きました。GitHub 側で内容を確認し、緑の「Submit new issue」ボタンを押すと登録完了です。
                </p>
              )}

              <div className="copy-actions">
                <a
                  className="action source"
                  href={feedbackListUrl()}
                  target={EXTERNAL_LINK_ATTRS.target}
                  rel={EXTERNAL_LINK_ATTRS.rel}
                  data-testid="feedback-list-link"
                  aria-label="これまでの改修要望一覧を開く（新しいタブで開きます）"
                >
                  これまでの要望一覧を開く
                  <span className="external-mark" aria-hidden="true">
                    ↗
                  </span>
                </a>

                {canSubmit ? (
                  <a
                    className="action feedback-submit"
                    href={issueUrl}
                    target={EXTERNAL_LINK_ATTRS.target}
                    rel={EXTERNAL_LINK_ATTRS.rel}
                    data-testid="feedback-submit"
                    onClick={handleSubmitted}
                    aria-label="入力内容で投稿画面を開く（新しいタブで開きます）"
                  >
                    この内容で投稿画面を開く
                    <span className="external-mark" aria-hidden="true">
                      ↗
                    </span>
                  </a>
                ) : (
                  <span className="dead-link" data-testid="feedback-submit-disabled">
                    「こうしたい」を入力すると投稿できます
                  </span>
                )}

                <button type="button" className="top-action" onClick={close}>
                  閉じる
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
