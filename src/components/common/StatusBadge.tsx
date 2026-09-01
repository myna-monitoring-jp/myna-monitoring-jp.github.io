import type { ItemStatus } from '@/types/monitoring';
import { STATUS_META } from '@/lib/statusLabels';

interface StatusBadgeProps {
  status: ItemStatus;
  /** Adds the plain-language meaning as a title, e.g. in legends. */
  withDescription?: boolean;
}

/**
 * Informational status label.
 *
 * Rendered as a <span>: not focusable, no click handler, `cursor: default`.
 * It must never look or behave like a button (受入条件 3).
 *
 * A symbol accompanies the colour so the meaning does not depend on colour alone.
 */
export function StatusBadge({ status, withDescription = false }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <span
      className={`status status-${meta.tone}`}
      data-testid="status-badge"
      data-status={status}
      title={withDescription ? meta.description : undefined}
    >
      <span className="status-symbol" aria-hidden="true">
        {meta.symbol}
      </span>
      <span className="visually-hidden">状態：</span>
      {meta.label}
    </span>
  );
}
