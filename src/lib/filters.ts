import type {
  BaseItem,
  Incident,
  IncidentCategory,
  ItemStatus,
  PRClassification,
  PRItem,
  Severity,
  StableSubtype,
} from '@/types/monitoring';
import { SEVERITY_ORDER, STATUS_META } from '@/lib/statusLabels';

/** Search + filter + sort helpers shared by every list view. */

/* --------------------------------------------------------------- searching */

function collectSearchText(item: BaseItem): string {
  const parts: (string | undefined)[] = [
    item.title,
    item.summary,
    item.whatIsNew,
    item.audience,
    item.category,
    item.dailyDiff,
    STATUS_META[item.status]?.label,
    ...(item.tags ?? []),
    ...(item.communicationRisks ?? []),
    ...(item.publicVoices ?? []).map((voice) => voice.summary),
    ...(item.factChecks ?? []).flatMap((check) => [check.claim, check.explanation]),
    ...(item.sources ?? []).flatMap((source) => [source.label, source.publisher, source.note]),
  ];

  const incident = item as Partial<Incident>;
  parts.push(
    incident.entityName,
    incident.region,
    incident.systemName,
    incident.cause,
    incident.symptoms,
    incident.medicalImpact,
    incident.personalDataImpact,
    incident.subcategory,
    incident.officialStatus,
  );

  const pr = item as Partial<PRItem>;
  parts.push(
    pr.ministry,
    pr.campaignName,
    pr.message,
    pr.creative,
    pr.placement,
    pr.partner,
    pr.targetAudience,
    pr.officialAction,
    ...(pr.riskFactors ?? []),
  );

  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Case-insensitive AND match over whitespace-separated terms. */
export function matchesQuery(item: BaseItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = collectSearchText(item);
  return trimmed.split(/\s+/).every((term) => haystack.includes(term));
}

/* --------------------------------------------------------------- filtering */

export interface CommonFilterState {
  query: string;
  /** Empty array = no status restriction. */
  statuses: ItemStatus[];
  severities: Severity[];
}

export interface IncidentFilterState extends CommonFilterState {
  category: IncidentCategory;
  region: string;
  /** '' = all, 'cyber' = cyber attacks only, 'non_cyber' = everything else */
  cyber: '' | 'cyber' | 'non_cyber';
  /** '' = all, 'recovered' / 'not_recovered' */
  recovery: '' | 'recovered' | 'not_recovered';
}

export interface PRFilterState extends CommonFilterState {
  /** '' = all three lanes. */
  classification: PRClassification | '';
  ministry: string;
  /** '' = all; only applies to `active_stable`. */
  stableSubtype: StableSubtype | '';
  /** '' = all, 'acted' = 公式対応あり, 'none' = なし */
  officialAction: '' | 'acted' | 'none';
}

export const EMPTY_COMMON_FILTER: CommonFilterState = {
  query: '',
  statuses: [],
  severities: [],
};

function matchesCommon(item: BaseItem, state: CommonFilterState, status: ItemStatus): boolean {
  if (!matchesQuery(item, state.query)) return false;
  if (state.statuses.length > 0 && !state.statuses.includes(status)) return false;
  if (state.severities.length > 0 && !state.severities.includes(item.severity)) return false;
  return true;
}

/**
 * @param resolveStatus maps an item to the status actually displayed
 *        (so filtering by 沈静化 matches what the user sees).
 */
export function filterItems<T extends BaseItem>(
  items: readonly T[],
  state: CommonFilterState,
  resolveStatus: (item: T) => ItemStatus,
): T[] {
  return items.filter((item) => matchesCommon(item, state, resolveStatus(item)));
}

export function filterIncidents(
  incidents: readonly Incident[],
  state: IncidentFilterState,
  resolveStatus: (item: Incident) => ItemStatus,
): Incident[] {
  return incidents.filter((incident) => {
    if (incident.incidentCategory !== state.category) return false;
    if (!matchesCommon(incident, state, resolveStatus(incident))) return false;
    if (state.region && incident.region !== state.region) return false;
    if (state.cyber === 'cyber' && incident.cyberAttack !== true) return false;
    if (state.cyber === 'non_cyber' && incident.cyberAttack === true) return false;
    if (state.recovery === 'recovered' && !incident.recoveryAt) return false;
    if (state.recovery === 'not_recovered' && incident.recoveryAt) return false;
    return true;
  });
}

export function filterPRItems(
  items: readonly PRItem[],
  state: PRFilterState,
  resolveStatus: (item: PRItem) => ItemStatus,
): PRItem[] {
  return items.filter((item) => {
    if (state.classification && item.prClassification !== state.classification) return false;
    if (!matchesCommon(item, state, resolveStatus(item))) return false;
    if (state.ministry && item.ministry !== state.ministry) return false;
    if (state.stableSubtype) {
      if (item.prClassification !== 'active_stable') return false;
      if (item.stableSubtype !== state.stableSubtype) return false;
    }
    if (state.officialAction === 'acted' && !item.officialAction) return false;
    if (state.officialAction === 'none' && item.officialAction) return false;
    return true;
  });
}

/* ----------------------------------------------------------------- sorting */

export type SortKey = 'severity' | 'lastUpdate' | 'occurred' | 'reactions' | 'affected';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'severity', label: '重要度順' },
  { value: 'lastUpdate', label: '最新更新順' },
  { value: 'occurred', label: '発生日順' },
  { value: 'reactions', label: '反応量順' },
  { value: 'affected', label: '影響人数順' },
];

function time(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function reactionVolume(item: BaseItem): number {
  return (item.publicVoices ?? []).reduce(
    (total, voice) =>
      total +
      (voice.likeCount ?? 0) +
      (voice.repostCount ?? 0) +
      (voice.replyCount ?? 0) +
      (voice.commentCount ?? 0),
    0,
  );
}

function affectedVolume(item: BaseItem): number {
  const incident = item as Partial<Incident>;
  return typeof incident.affectedCount === 'number' ? incident.affectedCount : -1;
}

/** Stable, non-mutating sort. Ties fall back to the latest material update. */
export function sortItems<T extends BaseItem>(items: readonly T[], key: SortKey): T[] {
  const copy = [...items];
  copy.sort((a, b) => {
    switch (key) {
      case 'severity': {
        const diff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
        if (diff !== 0) return diff;
        break;
      }
      case 'occurred': {
        const diff = time(b.occurredAt ?? b.publishedAt) - time(a.occurredAt ?? a.publishedAt);
        if (diff !== 0) return diff;
        break;
      }
      case 'reactions': {
        const diff = reactionVolume(b) - reactionVolume(a);
        if (diff !== 0) return diff;
        break;
      }
      case 'affected': {
        const diff = affectedVolume(b) - affectedVolume(a);
        if (diff !== 0) return diff;
        break;
      }
      case 'lastUpdate':
      default:
        break;
    }
    return time(b.lastMaterialUpdateAt) - time(a.lastMaterialUpdateAt);
  });
  return copy;
}

/** Distinct, sorted values for a select box. */
export function distinctValues<T>(items: readonly T[], pick: (item: T) => string | undefined): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const value = pick(item);
    if (value) set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
}
