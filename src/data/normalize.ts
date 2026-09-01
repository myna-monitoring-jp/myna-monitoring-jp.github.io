import { DEFAULT_SETTINGS } from '@/config/appConfig';
import { isUsableExternalUrl } from '@/lib/links';
import type {
  AppSettings,
  ArchiveEntry,
  Correction,
  DataUpdateStatus,
  Incident,
  MonitoringDataset,
  NewsItem,
  PRItem,
  PulseItem,
  Source,
  Survey,
  TimelineEntry,
} from '@/types/monitoring';

/**
 * Turns unvalidated JSON into a `MonitoringDataset`.
 *
 * The pipeline writes these files, so the app must not crash on a bad record.
 * Anything unusable is dropped and reported through `NormalizeReport.issues`,
 * which the UI renders as a data-quality notice instead of a blank page.
 */

export interface NormalizeIssue {
  path: string;
  message: string;
}

export interface NormalizeReport {
  dataset: MonitoringDataset;
  issues: NormalizeIssue[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/* ----------------------------------------------------------------- sources */

const SOURCE_TYPES = ['primary', 'media', 'social', 'survey'] as const;

function normalizeSources(value: unknown, path: string, issues: NormalizeIssue[]): Source[] {
  return asArray(value).flatMap((raw, index) => {
    if (!isObject(raw)) {
      issues.push({ path: `${path}[${index}]`, message: '出典の形式が不正です。' });
      return [];
    }
    const url = asString(raw.url) ?? '';
    const label = asString(raw.label) ?? '出典';
    const usable = isUsableExternalUrl(url);
    if (!usable) {
      issues.push({
        path: `${path}[${index}]`,
        message: `「${label}」のURLが無効なため、リンクではなく注記として表示します。`,
      });
    }
    return [
      {
        type: oneOf(raw.type, SOURCE_TYPES, 'primary'),
        label,
        url,
        linkText: asString(raw.linkText),
        publisher: asString(raw.publisher),
        publishedAt: asString(raw.publishedAt),
        verifiedAt: asString(raw.verifiedAt),
        active: usable ? asBoolean(raw.active) ?? true : false,
        note: asString(raw.note),
      } satisfies Source,
    ];
  });
}

/* ------------------------------------------------------------- base fields */

const STATUSES = [
  'new',
  'attention',
  'follow_up',
  'resolved',
  'planned_outage',
  'quiet',
  'archived',
] as const;
const SEVERITIES = ['high', 'medium', 'low'] as const;
const POLARITIES = ['positive', 'neutral', 'negative_watch', 'negative'] as const;
const VOICE_CHANNELS = [
  'x',
  'yahoo_comment',
  'app_store',
  'medical_professional',
  'social',
  'other',
] as const;
const VOICE_SENTIMENTS = [
  'supportive',
  'concern',
  'complaint',
  'misunderstanding',
  'field_impact',
] as const;
const FACT_ASSESSMENTS = [
  'fact',
  'misunderstanding',
  'overstatement',
  'legitimate_debate',
  'scope_separation',
] as const;

function normalizeCorrections(value: unknown, itemId?: string): Correction[] {
  return asArray(value).flatMap((raw) => {
    if (!isObject(raw)) return [];
    const correctedAt = asString(raw.correctedAt);
    const reason = asString(raw.reason);
    if (!correctedAt || !reason) return [];
    return [
      {
        correctedAt,
        itemId: asString(raw.itemId) ?? itemId,
        field: asString(raw.field),
        before: asString(raw.before),
        after: asString(raw.after),
        reason,
        editor: asString(raw.editor),
      } satisfies Correction,
    ];
  });
}

function normalizeBase(raw: Json, path: string, issues: NormalizeIssue[]) {
  const id = asString(raw.id);
  const title = asString(raw.title);
  const lastMaterialUpdateAt = asString(raw.lastMaterialUpdateAt);

  if (!id || !title) {
    issues.push({ path, message: 'id または title が無いため読み込めませんでした。' });
    return null;
  }
  if (!lastMaterialUpdateAt) {
    issues.push({
      path,
      message: `「${title}」に lastMaterialUpdateAt が無いため、ダッシュボード掲載判定ができません。`,
    });
  }

  const dashboardVisible = asBoolean(raw.dashboardVisible);

  return {
    id,
    title,
    category: asString(raw.category),
    polarity: optionalOneOf(raw.polarity, POLARITIES),
    status: oneOf(raw.status, STATUSES, 'follow_up'),
    severity: oneOf(raw.severity, SEVERITIES, 'medium'),
    detectedAt: asString(raw.detectedAt),
    occurredAt: asString(raw.occurredAt),
    publishedAt: asString(raw.publishedAt),
    lastMaterialUpdateAt: lastMaterialUpdateAt ?? '',
    dashboardVisible: dashboardVisible === undefined ? null : dashboardVisible,
    pinned: asBoolean(raw.pinned) ?? false,
    summary: asString(raw.summary) ?? '',
    whatIsNew: asString(raw.whatIsNew),
    audience: asString(raw.audience),
    quantitativeMetrics: asArray(raw.quantitativeMetrics).flatMap((metric) => {
      if (!isObject(metric)) return [];
      const label = asString(metric.label);
      const rawValue = metric.value;
      if (!label || (typeof rawValue !== 'string' && typeof rawValue !== 'number')) return [];
      return [
        {
          label,
          value: rawValue,
          unit: asString(metric.unit),
          note: asString(metric.note),
        },
      ];
    }),
    dailyDiff: asString(raw.dailyDiff),
    publicVoices: asArray(raw.publicVoices).flatMap((voice) => {
      if (!isObject(voice)) return [];
      const summary = asString(voice.summary);
      if (!summary) return [];
      const url = asString(voice.url);
      return [
        {
          id: asString(voice.id),
          // `type` is accepted as an alias so files written against the original
          // sample-data.json keep working.
          channel: oneOf(voice.channel ?? voice.type, VOICE_CHANNELS, 'other'),
          sentiment: optionalOneOf(voice.sentiment, VOICE_SENTIMENTS),
          summary,
          representative: asBoolean(voice.representative) ?? false,
          url: url && isUsableExternalUrl(url) ? url : undefined,
          observedAt: asString(voice.observedAt),
          replyCount: asNumber(voice.replyCount),
          repostCount: asNumber(voice.repostCount),
          likeCount: asNumber(voice.likeCount),
          impressionCount: asNumber(voice.impressionCount),
          commentCount: asNumber(voice.commentCount),
        },
      ];
    }),
    factChecks: asArray(raw.factChecks).flatMap((check) => {
      if (!isObject(check)) return [];
      const claim = asString(check.claim);
      const explanation = asString(check.explanation);
      if (!claim || !explanation) return [];
      return [
        {
          claim,
          assessment: oneOf(check.assessment, FACT_ASSESSMENTS, 'legitimate_debate'),
          explanation,
          sourceUrls: asStringArray(check.sourceUrls).filter(isUsableExternalUrl),
        },
      ];
    }),
    sources: normalizeSources(raw.sources, `${path}.sources`, issues),
    relatedIds: asStringArray(raw.relatedIds),
    tags: asStringArray(raw.tags),
    communicationRisks: asStringArray(raw.communicationRisks),
    corrections: normalizeCorrections(raw.corrections, id),
    // 明示されていなければ「レビュー済」として扱う（手書きデータの既定）
    reviewState: raw.reviewState === 'unreviewed' ? ('unreviewed' as const) : ('reviewed' as const),
    matchKeywords: asStringArray(raw.matchKeywords),
  };
}

/* -------------------------------------------------------------- collections */

const NEWS_CATEGORIES = ['policy', 'public_communication', 'incident', 'survey', 'other'] as const;
const INCIDENT_CATEGORIES = [
  'local_government_insurer',
  'common_system',
  'medical_it_cyber',
] as const;
const PR_CLASSIFICATIONS = ['reported_backlash', 'active_watch', 'active_stable'] as const;
const STABLE_SUBTYPES = ['quiet', 'positive'] as const;
const PR_MEDIA = [
  'newspaper_ad',
  'tv',
  'web_ad',
  'sns',
  'video',
  'event',
  'tie_up',
  'poster',
  'other',
] as const;

function normalizeNews(value: unknown, issues: NormalizeIssue[]): NewsItem[] {
  return asArray(value).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const base = normalizeBase(raw, `news[${index}]`, issues);
    if (!base) return [];
    return [{ ...base, category: oneOf(raw.category, NEWS_CATEGORIES, 'other') } as NewsItem];
  });
}

function normalizeIncidents(value: unknown, issues: NormalizeIssue[]): Incident[] {
  return asArray(value).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const path = `incidents[${index}]`;
    const base = normalizeBase(raw, path, issues);
    if (!base) return [];
    if (!(INCIDENT_CATEGORIES as readonly string[]).includes(String(raw.incidentCategory))) {
      issues.push({
        path,
        message: `「${base.title}」の incidentCategory が不正です。自治体・保険者として扱います。`,
      });
    }
    const affected = raw.affectedCount;
    return [
      {
        ...base,
        incidentCategory: oneOf(raw.incidentCategory, INCIDENT_CATEGORIES, 'local_government_insurer'),
        subcategory: asString(raw.subcategory),
        entityName: asString(raw.entityName) ?? '主体未記載',
        region: asString(raw.region),
        systemName: asString(raw.systemName),
        affectedCount: typeof affected === 'number' && Number.isFinite(affected) ? affected : null,
        affectedCountNote: asString(raw.affectedCountNote),
        symptoms: asString(raw.symptoms),
        cause: asString(raw.cause),
        workaround: asString(raw.workaround),
        recoveryAt: asString(raw.recoveryAt),
        medicalImpact: asString(raw.medicalImpact),
        personalDataImpact: asString(raw.personalDataImpact),
        cyberAttack: asBoolean(raw.cyberAttack) ?? false,
        officialStatus: asString(raw.officialStatus),
      } as Incident,
    ];
  });
}

function normalizePRItems(value: unknown, issues: NormalizeIssue[]): PRItem[] {
  return asArray(value).flatMap((raw, index) => {
    if (!isObject(raw)) return [];
    const path = `prItems[${index}]`;
    const base = normalizeBase(raw, path, issues);
    if (!base) return [];
    const classification = oneOf(raw.prClassification, PR_CLASSIFICATIONS, 'active_watch');
    let stableSubtype = optionalOneOf(raw.stableSubtype, STABLE_SUBTYPES);

    // 「炎上していないだけ」と「実際にポジティブ」を必ず区別する。
    if (classification === 'active_stable' && !stableSubtype) {
      stableSubtype = 'quiet';
      issues.push({
        path,
        message: `「${base.title}」に stableSubtype が無いため「反応未検知」として表示します。`,
      });
    }
    if (classification !== 'active_stable') stableSubtype = undefined;

    const controversy = asNumber(raw.controversyLevel);
    return [
      {
        ...base,
        ministry: asString(raw.ministry) ?? '省庁未記載',
        campaignName: asString(raw.campaignName) ?? base.title,
        medium: optionalOneOf(raw.medium, PR_MEDIA),
        startAt: asString(raw.startAt),
        endAt: asString(raw.endAt),
        targetAudience: asString(raw.targetAudience),
        message: asString(raw.message),
        creative: asString(raw.creative),
        placement: asString(raw.placement),
        partner: asString(raw.partner),
        controversyLevel:
          controversy === 0 || controversy === 1 || controversy === 2 || controversy === 3
            ? controversy
            : undefined,
        mediaPickupCount: asNumber(raw.mediaPickupCount),
        officialAction: asString(raw.officialAction),
        effectMetrics: asArray(raw.effectMetrics).flatMap((metric) => {
          if (!isObject(metric)) return [];
          const label = asString(metric.label);
          const metricValue = metric.value;
          if (!label || (typeof metricValue !== 'string' && typeof metricValue !== 'number')) return [];
          return [{ label, value: metricValue, unit: asString(metric.unit), note: asString(metric.note) }];
        }),
        prClassification: classification,
        stableSubtype,
        riskFactors: asStringArray(raw.riskFactors),
      } as PRItem,
    ];
  });
}

function normalizeSurveys(value: unknown): Survey[] {
  return asArray(value).flatMap((raw) => {
    if (!isObject(raw)) return [];
    const id = asString(raw.id);
    const title = asString(raw.title);
    if (!id || !title) return [];
    return [
      {
        id,
        title,
        organization: asString(raw.organization) ?? '調査主体未記載',
        method: asString(raw.method) ?? '調査方法未記載',
        sampleSize: asNumber(raw.sampleSize) ?? 0,
        fieldworkPeriod: asString(raw.fieldworkPeriod) ?? '―',
        questionText: asString(raw.questionText) ?? '設問文未記載',
        summary: asString(raw.summary) ?? '',
        publishedAt: asString(raw.publishedAt) ?? '',
        sources: normalizeSources(raw.sources, `surveys.${id}.sources`, []),
      } satisfies Survey,
    ];
  });
}

function normalizePulses(value: unknown): PulseItem[] {
  return asArray(value).flatMap((raw) => {
    if (!isObject(raw)) return [];
    const id = asString(raw.id);
    const title = asString(raw.title);
    if (!id || !title) return [];
    return [
      {
        id,
        title,
        description: asString(raw.description) ?? '',
        scaleNote: asString(raw.scaleNote),
        sources: normalizeSources(raw.sources, `pulses.${id}.sources`, []),
      } satisfies PulseItem,
    ];
  });
}

function normalizeArchive(value: unknown): ArchiveEntry[] {
  return asArray(value)
    .flatMap((raw) => {
      if (!isObject(raw)) return [];
      const date = asString(raw.date);
      if (!date) return [];
      const htmlUrl = asString(raw.htmlUrl);
      return [
        {
          date,
          title: asString(raw.title) ?? `${date} レポート`,
          description: asString(raw.description),
          dataPath: asString(raw.dataPath),
          htmlUrl,
        } satisfies ArchiveEntry,
      ];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeTimeline(value: unknown): TimelineEntry[] {
  return asArray(value)
    .flatMap((raw) => {
      if (!isObject(raw)) return [];
      const date = asString(raw.date);
      const title = asString(raw.title);
      if (!date || !title) return [];
      return [
        {
          date,
          title,
          description: asString(raw.description),
          relatedId: asString(raw.relatedId),
          sources: normalizeSources(raw.sources, `timeline.${date}.sources`, []),
        } satisfies TimelineEntry,
      ];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isObject(value)) return { ...DEFAULT_SETTINGS };
  return {
    dashboardQuietDays: asNumber(value.dashboardQuietDays) ?? DEFAULT_SETTINGS.dashboardQuietDays,
    newItemHours: asNumber(value.newItemHours) ?? DEFAULT_SETTINGS.newItemHours,
    timezone: asString(value.timezone) ?? DEFAULT_SETTINGS.timezone,
    organizationLabel: asString(value.organizationLabel) ?? DEFAULT_SETTINGS.organizationLabel,
  };
}

const UPDATE_STATES = ['ok', 'stale', 'failed', 'never_updated'] as const;

function normalizeDataUpdate(value: unknown, generatedAt: string): DataUpdateStatus {
  if (!isObject(value)) {
    return { state: 'ok', lastSuccessfulUpdateAt: generatedAt };
  }
  return {
    state: oneOf(value.state, UPDATE_STATES, 'ok'),
    lastSuccessfulUpdateAt: asString(value.lastSuccessfulUpdateAt) ?? generatedAt,
    attemptedAt: asString(value.attemptedAt),
    message: asString(value.message),
  };
}

/* ------------------------------------------------------------------ public */

/** Empty but valid dataset. Used for the 404 / total-failure path. */
export function emptyDataset(overrides: Partial<MonitoringDataset> = {}): MonitoringDataset {
  return {
    dataset: 'live',
    generatedAt: '',
    reportDate: '',
    settings: { ...DEFAULT_SETTINGS },
    dataUpdate: { state: 'never_updated' },
    news: [],
    incidents: [],
    prItems: [],
    surveys: [],
    pulses: [],
    archive: [],
    timeline: [],
    corrections: [],
    ...overrides,
  };
}

export function normalizeDataset(input: unknown): NormalizeReport {
  const issues: NormalizeIssue[] = [];
  if (!isObject(input)) {
    return {
      dataset: emptyDataset({ dataUpdate: { state: 'failed', message: 'データ形式が不正です。' } }),
      issues: [{ path: '$', message: 'ルートがオブジェクトではありません。' }],
    };
  }

  const generatedAt = asString(input.generatedAt) ?? '';
  const headlineRaw = input.headline;

  const dataset: MonitoringDataset = {
    dataset: input.dataset === 'live' ? 'live' : 'sample',
    generatedAt,
    reportDate: asString(input.reportDate) ?? generatedAt.slice(0, 10),
    settings: normalizeSettings(input.settings),
    dataUpdate: normalizeDataUpdate(input.dataUpdate, generatedAt),
    headline: isObject(headlineRaw)
      ? {
          title: asString(headlineRaw.title) ?? '今日の全体像',
          description: asString(headlineRaw.description) ?? '',
        }
      : undefined,
    news: normalizeNews(input.news, issues),
    incidents: normalizeIncidents(input.incidents, issues),
    prItems: normalizePRItems(input.prItems, issues),
    surveys: normalizeSurveys(input.surveys),
    pulses: normalizePulses(input.pulses),
    archive: normalizeArchive(input.archive),
    timeline: normalizeTimeline(input.timeline),
    corrections: normalizeCorrections(input.corrections),
  };

  return { dataset, issues };
}

/** Item-level corrections rolled up with the dataset-level log, newest first. */
export function allCorrections(dataset: MonitoringDataset): Correction[] {
  const items = [...dataset.news, ...dataset.incidents, ...dataset.prItems];
  const fromItems = items.flatMap((item) =>
    (item.corrections ?? []).map((correction) => ({ ...correction, itemId: correction.itemId ?? item.id })),
  );
  return [...dataset.corrections, ...fromItems].sort((a, b) =>
    b.correctedAt.localeCompare(a.correctedAt),
  );
}

/** Titles by id, so the corrections table can name the affected item. */
export function itemTitleIndex(dataset: MonitoringDataset): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of [...dataset.news, ...dataset.incidents, ...dataset.prItems]) {
    index.set(item.id, item.title);
  }
  return index;
}
