import type { IncidentCategory } from '@/types/monitoring';
import { INCIDENT_CATEGORY_META, INCIDENT_CATEGORY_ORDER } from '@/lib/statusLabels';

interface CategoryTabsProps {
  active: IncidentCategory;
  counts: Record<IncidentCategory, number>;
  onChange: (category: IncidentCategory) => void;
}

/**
 * The three incident lanes. Implemented as a real ARIA tablist so arrow keys
 * work and the selected tab is announced.
 */
export function CategoryTabs({ active, counts, onChange }: CategoryTabsProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = INCIDENT_CATEGORY_ORDER.indexOf(active);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      INCIDENT_CATEGORY_ORDER[
        (index + delta + INCIDENT_CATEGORY_ORDER.length) % INCIDENT_CATEGORY_ORDER.length
      ];
    onChange(next);
  };

  return (
    <div className="category-tabs" role="tablist" aria-label="不具合カテゴリー" onKeyDown={handleKeyDown}>
      {INCIDENT_CATEGORY_ORDER.map((category) => {
        const meta = INCIDENT_CATEGORY_META[category];
        const selected = category === active;
        return (
          <button
            key={category}
            type="button"
            role="tab"
            id={`tab-${category}`}
            aria-selected={selected}
            aria-controls={`panel-${category}`}
            tabIndex={selected ? 0 : -1}
            className="category-tab"
            data-category={category}
            onClick={() => onChange(category)}
          >
            {meta.short}
            <span className="tab-count">{counts[category]}件</span>
          </button>
        );
      })}
    </div>
  );
}
