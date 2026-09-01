import type { AppSettings, BaseItem, ItemStatus } from '@/types/monitoring';

/**
 * The "N-day rule" (要件 4.1, default N = 7).
 *
 * An item leaves the dashboard when `lastMaterialUpdateAt` is older than
 * `settings.dashboardQuietDays`. It is never deleted: detail pages and the
 * archive keep showing it. `pinned = true` overrides the rule.
 *
 * All functions are pure and take `now` explicitly so tests are deterministic.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export type DashboardExclusionReason =
  | 'visible'
  | 'pinned'
  | 'quiet_period_elapsed'
  | 'archived_status'
  | 'manually_hidden'
  | 'missing_last_material_update';

export interface DashboardDecision {
  visible: boolean;
  reason: DashboardExclusionReason;
  /** Whole days since `lastMaterialUpdateAt`. `null` when the date is unusable. */
  daysSinceMaterialUpdate: number | null;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days elapsed since `lastMaterialUpdateAt`. Negative values clamp to 0. */
export function daysSinceMaterialUpdate(item: BaseItem, now: Date): number | null {
  const updated = parseDate(item.lastMaterialUpdateAt);
  if (!updated) return null;
  const diff = now.getTime() - updated.getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/**
 * Decides dashboard visibility for one item.
 *
 * Precedence:
 *   1. `pinned`                       -> always visible
 *   2. `dashboardVisible === false`   -> editor hid it
 *   3. status `archived`              -> history only
 *   4. unparsable `lastMaterialUpdateAt` -> excluded (fail closed, surfaced in the UI)
 *   5. quiet days elapsed             -> excluded
 */
export function decideDashboardVisibility(
  item: BaseItem,
  settings: Pick<AppSettings, 'dashboardQuietDays'>,
  now: Date,
): DashboardDecision {
  const days = daysSinceMaterialUpdate(item, now);

  if (item.pinned) {
    return { visible: true, reason: 'pinned', daysSinceMaterialUpdate: days };
  }
  if (item.dashboardVisible === false) {
    return { visible: false, reason: 'manually_hidden', daysSinceMaterialUpdate: days };
  }
  if (item.status === 'archived') {
    return { visible: false, reason: 'archived_status', daysSinceMaterialUpdate: days };
  }
  if (days === null) {
    return {
      visible: false,
      reason: 'missing_last_material_update',
      daysSinceMaterialUpdate: null,
    };
  }
  if (days >= settings.dashboardQuietDays) {
    return { visible: false, reason: 'quiet_period_elapsed', daysSinceMaterialUpdate: days };
  }
  return { visible: true, reason: 'visible', daysSinceMaterialUpdate: days };
}

export function isOnDashboard(
  item: BaseItem,
  settings: Pick<AppSettings, 'dashboardQuietDays'>,
  now: Date,
): boolean {
  return decideDashboardVisibility(item, settings, now).visible;
}

/** Filters a list down to what the dashboard may show. Order is preserved. */
export function selectDashboardItems<T extends BaseItem>(
  items: readonly T[],
  settings: Pick<AppSettings, 'dashboardQuietDays'>,
  now: Date,
): T[] {
  return items.filter((item) => isOnDashboard(item, settings, now));
}

/** Items excluded by the rule. Used by the archive / detail views. */
export function selectQuietedItems<T extends BaseItem>(
  items: readonly T[],
  settings: Pick<AppSettings, 'dashboardQuietDays'>,
  now: Date,
): T[] {
  return items.filter((item) => !isOnDashboard(item, settings, now));
}

/**
 * Status actually rendered.
 *
 * A stored status stays authoritative for terminal states (`resolved`,
 * `planned_outage`, `archived`); otherwise an item that has gone quiet is shown
 * as 沈静化 so the label matches why it left the dashboard.
 */
export function effectiveStatus(
  item: BaseItem,
  settings: Pick<AppSettings, 'dashboardQuietDays'>,
  now: Date,
): ItemStatus {
  if (item.status === 'resolved' || item.status === 'planned_outage' || item.status === 'archived') {
    return item.status;
  }
  if (item.pinned) return item.status;
  const days = daysSinceMaterialUpdate(item, now);
  if (days !== null && days >= settings.dashboardQuietDays) return 'quiet';
  return item.status;
}

/** True while the item is inside the 新着 window (default 48h). */
export function isNewlyDetected(
  item: BaseItem,
  settings: Pick<AppSettings, 'newItemHours'>,
  now: Date,
): boolean {
  const detected = parseDate(item.detectedAt ?? item.publishedAt ?? item.lastMaterialUpdateAt);
  if (!detected) return false;
  return now.getTime() - detected.getTime() <= settings.newItemHours * MS_PER_HOUR;
}

/** Human-readable explanation used in the "なぜ非表示か" note. */
export function explainDecision(decision: DashboardDecision, quietDays: number): string {
  switch (decision.reason) {
    case 'pinned':
      return 'ピン留めのためダッシュボードに表示し続けています。';
    case 'quiet_period_elapsed':
      return `最終重要更新から${decision.daysSinceMaterialUpdate}日経過（基準${quietDays}日）のためダッシュボード非表示。詳細・アーカイブには保持しています。`;
    case 'archived_status':
      return 'アーカイブ状態のためダッシュボード非表示。履歴として保持しています。';
    case 'manually_hidden':
      return '編集者が手動でダッシュボード非表示に設定しています。';
    case 'missing_last_material_update':
      return '最終重要更新日時が未設定のためダッシュボードに表示できません。データを確認してください。';
    default:
      return `最終重要更新から${decision.daysSinceMaterialUpdate ?? 0}日（基準${quietDays}日）。`;
  }
}
