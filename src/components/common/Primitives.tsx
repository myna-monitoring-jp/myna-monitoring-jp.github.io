import type { ReactNode } from 'react';

/** Small presentational building blocks shared across views. */

export function Tag({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: 'gray' | 'red' | 'green' | 'blue' | 'purple' | 'amber';
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function SectionTitle({
  title,
  description,
  id,
  actions,
}: {
  title: string;
  description?: string;
  id?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="empty" role="status">
      {children}
    </p>
  );
}

export type BannerTone = 'info' | 'warn' | 'error' | 'sample';

const BANNER_MARK: Record<BannerTone, string> = {
  info: 'ℹ',
  warn: '⚠',
  error: '✕',
  sample: '★',
};

/** Notice strip. The mark gives a non-colour cue for the severity. */
export function Banner({
  tone,
  title,
  children,
  role = 'status',
}: {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className={`banner banner-${tone}`} role={role} data-testid={`banner-${tone}`}>
      <span className="banner-mark" aria-hidden="true">
        {BANNER_MARK[tone]}
      </span>
      <span>
        <b>{title}</b>
        {children ? <> {children}</> : null}
      </span>
    </div>
  );
}

export function CardBlock({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="card-block">
      <h4>{heading}</h4>
      {children}
    </section>
  );
}
