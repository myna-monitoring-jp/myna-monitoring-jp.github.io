import type { AppSettings, PRClassification, PRItem } from '@/types/monitoring';
import { PRItemCard } from '@/components/pr/PRItemCard';
import { PR_CLASSIFICATION_META } from '@/lib/statusLabels';

interface PRColumnProps {
  classification: PRClassification;
  items: readonly PRItem[];
  settings: AppSettings;
  now: Date;
  detailed?: boolean;
}

const HEADING_MARK: Record<PRClassification, string> = {
  reported_backlash: '🔥',
  active_watch: '📣',
  active_stable: '✨',
};

/** One of the three PR lanes. */
export function PRColumn({ classification, items, settings, now, detailed = true }: PRColumnProps) {
  const meta = PR_CLASSIFICATION_META[classification];
  return (
    <section
      className="pr-col"
      id={`pr-${classification}`}
      data-testid="pr-column"
      data-classification={classification}
      aria-labelledby={`pr-heading-${classification}`}
    >
      <h3 id={`pr-heading-${classification}`}>
        <span aria-hidden="true">{HEADING_MARK[classification]} </span>
        {meta.heading}
        <span className="tab-count">（{items.length}件）</span>
      </h3>
      <p className="pr-col-desc">{meta.description}</p>

      {items.length === 0 ? (
        <p className="empty">該当する案件はありません。</p>
      ) : (
        items.map((item) => (
          <PRItemCard key={item.id} item={item} settings={settings} now={now} detailed={detailed} />
        ))
      )}
    </section>
  );
}
