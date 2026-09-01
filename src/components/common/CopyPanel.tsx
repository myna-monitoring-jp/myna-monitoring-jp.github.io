import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface CopyPanelProps {
  title: string;
  description: string;
  text: string;
  onClose: () => void;
}

/**
 * Fallback for environments where writing to the clipboard is blocked.
 *
 * Managed corporate browsers commonly deny both `navigator.clipboard.writeText`
 * and `document.execCommand('copy')`. Telling the user "copy it manually" is
 * useless unless the text is actually on screen, so this dialog shows it in a
 * read-only textarea with the content already selected — Ctrl+C then works.
 *
 * Accessibility: real dialog role, Esc to close, focus moved in on open and
 * returned to the trigger on close.
 */
export function CopyPanel({ title, description, text, onClose }: CopyPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const selectAll = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    selectAll();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [selectAll]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /*
   * body 直下へポータルする。`.topbar` は `backdrop-filter` を持ち、これが
   * position:fixed の包含ブロックになるため、トップバー内に描画すると
   * オーバーレイがトップバーの矩形に閉じ込められて位置が崩れる。
   */
  return createPortal(
    <div
      className="copy-overlay"
      data-testid="copy-overlay"
      // クリックで閉じるのは背景のみ。ダイアログ内のクリックは伝播させない。
      onClick={onClose}
    >
      <div
        className="copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-dialog-title"
        aria-describedby="copy-dialog-desc"
        data-testid="copy-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="copy-dialog-title">{title}</h2>
        <p id="copy-dialog-desc" className="note">
          {description}
        </p>
        <label className="visually-hidden" htmlFor="copy-dialog-text">
          {title}
        </label>
        <textarea
          id="copy-dialog-text"
          ref={textareaRef}
          className="copy-textarea"
          data-testid="copy-text"
          readOnly
          rows={Math.min(16, Math.max(4, text.split('\n').length + 1))}
          value={text}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="copy-actions">
          <button type="button" className="top-action" onClick={selectAll}>
            全選択（このあと Ctrl+C）
          </button>
          <button type="button" className="top-action primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
