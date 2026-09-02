/**
 * Data contract for the monitoring portal.
 *
 * Every field that reaches the screen is defined here. `data/current.json` and
 * `data/archive/*.json` are parsed into `MonitoringDataset`.
 *
 * Vocabulary rule: the ambiguous labels "WATCH" / "継続" are intentionally absent.
 * Use `ItemStatus` only.
 */

/* ------------------------------------------------------------------ status */

/**
 * The only status vocabulary allowed in the product.
 * - new             新着     : detected within `settings.newItemHours`
 * - attention       要注視   : impact / reaction / coverage expanding, or needs action today
 * - follow_up       続報待ち : unresolved but no recent expansion
 * - resolved        解消済   : recovered / ended / corrected / withdrawn
 * - planned_outage  計画停止 : pre-announced maintenance
 * - quiet           沈静化   : no material update for `settings.dashboardQuietDays`
 * - archived        アーカイブ: hidden from dashboard, kept as history
 */
export type ItemStatus =
  | 'new'
  | 'attention'
  | 'follow_up'
  | 'resolved'
  | 'planned_outage'
  | 'quiet'
  | 'archived';

export type Severity = 'high' | 'medium' | 'low';

export type Polarity = 'positive' | 'neutral' | 'negative_watch' | 'negative';

/* ----------------------------------------------------------------- sources */

export type SourceType = 'primary' | 'media' | 'social' | 'survey';

export interface Source {
  /** primary=一次情報 / media=報道 / social=SNS・国民の声 / survey=世論調査 */
  type: SourceType;
  /** Publisher-facing label, e.g. 「デジタル庁」 */
  label: string;
  /** Absolute http(s) URL. Empty / "#" / "javascript:" values are rejected at load time. */
  url: string;
  /**
   * Explicit button wording. When omitted a wording is derived from `type`
   * (「一次情報を開く」「報道記事を開く」「X投稿を開く」…). Never generic "詳細".
   */
  linkText?: string;
  publisher?: string;
  publishedAt?: string;
  /** When an editor last confirmed the link resolves. Drives the link-rot notice. */
  verifiedAt?: string;
  /** false => known dead link; rendered as disabled text, not as a link. */
  active?: boolean;
  note?: string;
}

/* ----------------------------------------------------------- public voices */

export type PublicVoiceChannel =
  | 'x'
  | 'yahoo_comment'
  | 'app_store'
  | 'medical_professional'
  | 'social'
  | 'other';

/** How the voice reads. Kept separate from polarity of the item itself. */
export type PublicVoiceSentiment =
  | 'supportive'
  | 'concern'
  | 'complaint'
  | 'misunderstanding'
  | 'field_impact';

/**
 * An *observed* reaction. Predicted / hypothetical criticism must NOT be stored
 * here — put it in `BaseItem.communicationRisks` instead.
 */
export interface PublicVoice {
  id?: string;
  channel: PublicVoiceChannel;
  sentiment?: PublicVoiceSentiment;
  summary: string;
  /** true = quoted as a representative post for the discussion point. */
  representative: boolean;
  url?: string;
  observedAt?: string;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  impressionCount?: number;
  commentCount?: number;
}

/* -------------------------------------------------------------- factchecks */

export type FactAssessment =
  /** 事実ベース */
  | 'fact'
  /** 誤解 */
  | 'misunderstanding'
  /** 言い過ぎ */
  | 'overstatement'
  /** 正当な制度論点 */
  | 'legitimate_debate'
  /** 影響範囲の切り分け（例: マイナアプリ障害 ≠ オン資全国障害） */
  | 'scope_separation';

export interface FactCheck {
  claim: string;
  assessment: FactAssessment;
  explanation: string;
  sourceUrls?: string[];
}

/* ------------------------------------------------------------- quantitative */

export interface QuantitativeMetric {
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
}

/* ------------------------------------------------------------- corrections */

export interface Correction {
  correctedAt: string;
  /** Item id the correction applies to. Omit for dataset-wide corrections. */
  itemId?: string;
  field?: string;
  before?: string;
  after?: string;
  reason: string;
  editor?: string;
}

/* --------------------------------------------------------------- base item */

export interface BaseItem {
  id: string;
  title: string;
  category?: string;
  polarity?: Polarity;
  status: ItemStatus;
  severity: Severity;
  detectedAt?: string;
  occurredAt?: string;
  publishedAt?: string;
  /**
   * Anchor of the N-day rule. Update ONLY on a material update:
   * new official announcement / independent additional coverage /
   * significant increase in reactions / change of severity-scope-headcount /
   * recovery, root cause, apology, deletion, cancellation.
   */
  lastMaterialUpdateAt: string;
  /** Editor override. `null`/undefined => computed by the N-day rule. */
  dashboardVisible?: boolean | null;
  /** Manual pin. Keeps the item on the dashboard regardless of the N-day rule. */
  pinned?: boolean;
  summary: string;
  /** 何が新しいか */
  whatIsNew?: string;
  /** 影響対象 */
  audience?: string;
  quantitativeMetrics?: QuantitativeMetric[];
  /** 前日からの差分。無い場合は画面で「前日から変化なし」を表示。 */
  dailyDiff?: string;
  publicVoices?: PublicVoice[];
  factChecks?: FactCheck[];
  sources: Source[];
  relatedIds?: string[];
  tags?: string[];
  /**
   * 広報上のリスク。まだ観測されていない“予測される批判”はここに入れる。
   * 国民の声 (`publicVoices`) と混ぜてはいけない。
   */
  communicationRisks?: string[];
  corrections?: Correction[];
  /**
   * レビュー状態（要件 9「レビュー」）。
   * 日次の自動収集で追加された項目は `unreviewed`。重要度・状態・事実関係の
   * 切り分けは判断が必要なため自動では確定させず、画面に「未レビュー」と明示する。
   * 編集者が `curated.json` に書き起こした項目は `reviewed`。
   */
  reviewState?: ReviewState;
  /**
   * この案件に紐づく追加報道を自動検知するためのキーワード（AND条件）。
   * `curated.json` で人が指定する。日次処理はこれに一致した記事だけを出典に追記し、
   * 独立媒体が増えた場合に限り `lastMaterialUpdateAt` を進める。
   */
  matchKeywords?: string[];
}

/** 未レビュー = 自動収集のまま。レビュー済 = 人が判断を書いた。 */
export type ReviewState = 'unreviewed' | 'reviewed';

/* -------------------------------------------------------------- news items */

export type NewsCategory =
  | 'policy'
  | 'public_communication'
  | 'incident'
  | 'survey'
  /**
   * 解説記事・二次情報。一次情報でも独自報道でもない、制度の解説・ハウツー・
   * まとめ記事。監視対象の事象ではないため本文の一覧には混ぜず、画面下部の
   * 小タイル欄に論調（ポジティブ／中立／ネガティブ）を添えて並べる。
   */
  | 'commentary'
  /**
   * 参考情報。官公庁・自治体の一次情報だが、不具合・障害・炎上のような
   * 監視対象の事象ではないもの（例：省庁の周年発表、イベント開催報告）。
   * 押さえておくと役に立つのでダッシュボード下部に小さく残す。
   */
  | 'reference'
  | 'other';

export interface NewsItem extends BaseItem {
  category?: NewsCategory;
}

/* --------------------------------------------------------------- incidents */

/** The three monitoring lanes. Never merge them in the UI. */
export type IncidentCategory =
  /** 自治体・保険者関連 */
  | 'local_government_insurer'
  /** オン資・マイナポータル等の共通システム */
  | 'common_system'
  /** 医療機関・周辺IT／サイバー */
  | 'medical_it_cyber';

export interface Incident extends BaseItem {
  incidentCategory: IncidentCategory;
  subcategory?: string;
  /** 自治体名・保険者名・医療機関名・省庁名など */
  entityName: string;
  region?: string;
  systemName?: string;
  /** null = 未公表 (distinct from 0) */
  affectedCount?: number | null;
  affectedCountNote?: string;
  symptoms?: string;
  cause?: string;
  workaround?: string;
  recoveryAt?: string;
  medicalImpact?: string;
  personalDataImpact?: string;
  cyberAttack?: boolean;
  /** 公式発表の状況（未公表 / 公表済 / 続報予定 など） */
  officialStatus?: string;
}

/* ---------------------------------------------------------------- PR items */

/** The three PR lanes. */
export type PRClassification =
  /** 二次転載・報道化まで拡大した炎上 */
  | 'reported_backlash'
  /** 掲載中・要注視 */
  | 'active_watch'
  /** 掲載中・安定／ポジティブ */
  | 'active_stable';

/**
 * Only meaningful for `active_stable`. Distinguishes
 * 「炎上していないだけ」(quiet) from 「実際に好意的・効果あり」(positive).
 */
export type StableSubtype = 'quiet' | 'positive';

export type PRMedium =
  | 'newspaper_ad'
  | 'tv'
  | 'web_ad'
  | 'sns'
  | 'video'
  | 'event'
  | 'tie_up'
  | 'poster'
  | 'other';

export interface PRItem extends BaseItem {
  ministry: string;
  campaignName: string;
  medium?: PRMedium;
  startAt?: string;
  endAt?: string;
  targetAudience?: string;
  message?: string;
  creative?: string;
  placement?: string;
  partner?: string;
  /** 0 = none, 3 = reported nationally */
  controversyLevel?: 0 | 1 | 2 | 3;
  /** Independent outlets only. Wire-service reprints are not counted twice. */
  mediaPickupCount?: number;
  officialAction?: string;
  effectMetrics?: QuantitativeMetric[];
  prClassification: PRClassification;
  stableSubtype?: StableSubtype;
  riskFactors?: string[];
}

/* -------------------------------------------- surveys / pulses / archive */

/** Nationally representative polling. Deliberately separated from SNS. */
export interface Survey {
  id: string;
  title: string;
  organization: string;
  method: string;
  sampleSize: number;
  fieldworkPeriod: string;
  questionText: string;
  summary: string;
  publishedAt: string;
  sources: Source[];
}

/** 世論・SNSの論点。代表性は主張しない。 */
export interface PulseItem {
  id: string;
  title: string;
  description: string;
  /** e.g. 「代表投稿 5,029RP」 */
  scaleNote?: string;
  sources?: Source[];
}

export interface ArchiveEntry {
  date: string;
  title: string;
  description?: string;
  /** Relative path under the data root, e.g. "archive/2026-08-31.json". */
  dataPath?: string;
  /** Optional external/legacy HTML report. */
  htmlUrl?: string;
}

export interface TimelineEntry {
  date: string;
  title: string;
  description?: string;
  relatedId?: string;
  sources?: Source[];
}

/* ------------------------------------------------------ dataset + settings */

export interface AppSettings {
  /** N of the "N-day rule". Requirement default: 7. */
  dashboardQuietDays: number;
  /** Hours during which an item is labelled 新着. Default 48. */
  newItemHours: number;
  timezone: string;
  /** Free-form label shown in the footer. */
  organizationLabel?: string;
}

export type DataUpdateState = 'ok' | 'stale' | 'failed' | 'never_updated';

/** Drives the "データ更新失敗時の表示" requirement. */
export interface DataUpdateStatus {
  state: DataUpdateState;
  /** Last time the pipeline completed successfully. Always shown on failure. */
  lastSuccessfulUpdateAt?: string;
  attemptedAt?: string;
  message?: string;
}

export type DatasetKind = 'sample' | 'live';

export interface MonitoringDataset {
  /** Hard separation between demo and production data. Shown as a banner. */
  dataset: DatasetKind;
  /** ISO datetime the file was produced. */
  generatedAt: string;
  /** YYYY-MM-DD the report covers. */
  reportDate: string;
  settings: AppSettings;
  dataUpdate: DataUpdateStatus;
  headline?: {
    title: string;
    description: string;
  };
  news: NewsItem[];
  incidents: Incident[];
  prItems: PRItem[];
  surveys: Survey[];
  pulses: PulseItem[];
  archive: ArchiveEntry[];
  timeline: TimelineEntry[];
  /** Dataset-level correction log (訂正履歴). */
  corrections: Correction[];
}

/** Anything that can be rendered by the shared card/filter helpers. */
export type MonitoringItem = NewsItem | Incident | PRItem;
