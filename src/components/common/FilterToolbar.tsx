import type { ReactNode } from 'react';
import type { ItemStatus, Severity } from '@/types/monitoring';
import { SEVERITY_LABEL, SEVERITY_ORDER, STATUS_META, STATUS_ORDER } from '@/lib/statusLabels';
import { SORT_OPTIONS, type SortKey } from '@/lib/filters';

interface FilterToolbarProps {
  searchLabel: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  status: ItemStatus | '';
  onStatusChange: (value: ItemStatus | '') => void;
  severity: Severity | '';
  onSeverityChange: (value: Severity | '') => void;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  onReset: () => void;
  /** Additional selects (region, ministry, …). */
  children?: ReactNode;
  /** Announced result count. */
  resultCount: number;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="toolbar-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

/** Shared search + status + severity + sort controls. Every input has a label. */
export function FilterToolbar({
  searchLabel,
  searchPlaceholder,
  query,
  onQueryChange,
  status,
  onStatusChange,
  severity,
  onSeverityChange,
  sort,
  onSortChange,
  onReset,
  children,
  resultCount,
}: FilterToolbarProps) {
  return (
    <>
      <div className="toolbar" role="search">
        <div className="toolbar-field grow">
          <label htmlFor="filter-query">{searchLabel}</label>
          <input
            id="filter-query"
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>

        <Field label="状態">
          <select
            aria-label="状態で絞り込む"
            value={status}
            onChange={(event) => onStatusChange(event.target.value as ItemStatus | '')}
          >
            <option value="">全状態</option>
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {STATUS_META[value].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="重要度">
          <select
            aria-label="重要度で絞り込む"
            value={severity}
            onChange={(event) => onSeverityChange(event.target.value as Severity | '')}
          >
            <option value="">全重要度</option>
            {SEVERITY_ORDER.map((value) => (
              <option key={value} value={value}>
                {SEVERITY_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>

        {children}

        <Field label="並び順">
          <select
            aria-label="並び順"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <button type="button" className="toolbar-reset" onClick={onReset}>
          絞り込みを解除
        </button>
      </div>
      <p className="note" role="status" aria-live="polite" data-testid="result-count">
        {resultCount}件を表示しています。
      </p>
    </>
  );
}
