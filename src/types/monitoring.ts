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
  | 'scope_separation'
  /**
   * 確認されず。
   * 「否定できた」ではなく「確認できていない」。断定を避けるために必要な判定で、
   * 例えば「AIモデルの学習に利用された」に対して事業者照会の説明はあるが
   * 第三者による確認がない、という状態をこれで表す。
   */
  | 'unconfirmed';

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

/* ------------------------------------------------------- 朝のブリーフィング */

/**
 * 前日差分のラベル。生成側に語彙を発明させないため列挙で固定する。
 * 状態語彙（ItemStatus）とは別物。案件の状態ではなく「前日と比べて何が動いたか」を表す。
 */
export type BriefingChange = 'new' | 'increased' | 'decreased' | 'flat' | 'scheduled_end' | 'resolved';

/** ヘッダーの指標カード。「新規全国オン資障害：確認なし」のように無かったことも書く。 */
export interface BriefingMetric {
  label: string;
  value: string;
  /** 注意を引く値かどうか。色ではなく記号と文字で区別する。 */
  alert?: boolean;
}

/** 「今朝の判断」1件。領域ごとに、確認できた事実と、そこからの判断を分けて書く。 */
export interface BriefingJudgment {
  /** 例：医療・システム／広報／セキュリティ */
  area: string;
  text: string;
}

/** 「前日からの差分」1行。 */
export interface BriefingDiff {
  change: BriefingChange;
  theme: string;
  /** その日に確認できた更新内容。 */
  update: string;
  /** その更新をどう読むか。 */
  judgment: string;
}

/** 「今日の優先ウォッチ」1件。 */
export interface BriefingWatch {
  theme: string;
  detail: string;
}

/** 定量情報の1行。「事案全体：総数未公表」のように、無いことも値として書く。 */
export interface BriefingFact {
  label: string;
  value: string;
}

/**
 * 事実関係の切り分け1行。
 * 世間で言われている論点に対して、どう扱うかを判定する。
 */
export interface BriefingClaim {
  claim: string;
  assessment: FactAssessment;
  note: string;
}

/**
 * 書き起こされたニュース1件。
 *
 * 収集した記事をそのまま並べるのではなく、材料を読んだうえで
 * 載せる価値のあるものだけを必須項目の形に書き起こしたもの。
 * 見出しも書き直す（元記事の表題ではなく、何が分かったかを書く）。
 */
export interface BriefingNewsItem {
  id: string;
  /** 書き直した見出し。 */
  headline: string;
  severity: Severity;
  /** ネガティブ／要注意 と ポジティブ／前進 のどちらの節に置くか。 */
  tone: 'negative' | 'positive';
  /** 論点タグ（要配慮個人情報、利用者体験など）。 */
  topicTags: string[];
  /** A. ニュース自体。段落ごとの配列。 */
  body: string[];
  /** A の定量テーブル。 */
  facts: BriefingFact[];
  /** B. 国民の声・現場の声。観測されたものだけ。 */
  publicVoice: string;
  /** 観測された声があったか。無い場合は画面に「確認できず」と出す。 */
  voiceObserved: boolean;
  /** C. 事実関係・補足。 */
  claims: BriefingClaim[];
  /** D. 出典・リンク。 */
  sources: Source[];
}

/**
 * 書き起こされた広報案件1件。
 *
 * 添付レポートの8項目に対応する。④は「予測される批判」であり、
 * 国民の声とは区別して広報上の確認ポイントとして扱う（要件どおり）。
 */
export interface BriefingPRItem {
  id: string;
  headline: string;
  /** 炎上度。判定条件を満たさないものを「炎上」と呼ばないため段階で持つ。 */
  heatLevel: Severity;
  /** 状態を表す短い札（掲載初日、既存批判あり など）。 */
  badges: string[];
  /** ①起点 */
  origin: string;
  /** ②訴求意図 */
  intent: string;
  /** ③現に確認できる批判 */
  observedCriticism: string;
  /** ④想定される論点。国民の声ではなく広報上の確認ポイント。 */
  potentialIssues: string;
  /** ⑤切り分け */
  separation: string;
  /** ⑥公式補足 */
  officialNote: string;
  /** ⑦二次拡散 */
  secondarySpread: string;
  /** ⑧広報上の注意 */
  communicationNote: string;
  sources: Source[];
}

/** 「世論・反応の傾向」1行。観測チャネルごとに、状況と読み方を分けて書く。 */
export interface BriefingSentimentRow {
  channel: string;
  situation: string;
  /** そのチャネルの結果をどう読むか（代表性の扱い）。 */
  reading: string;
}

/**
 * 毎朝の状況判断。機械収集（RSS・稼働状況ページ）とは別のレイヤーで、
 * 実際にページを確認した結果と、そこからの判断・留保を持つ。
 *
 * 生成物であり人手では編集しない。人の判断は curated.json 側に書く。
 */
export interface Briefing {
  /** 確認時点。「9月7日09:51 JST確認」の元。 */
  confirmedAt: string;
  /** 主対象期間の開始。通常は24時間前。 */
  windowFrom: string;
  windowTo: string;
  /** 生成に使ったモデル。何が書いたのかを画面に明示するために持つ。 */
  generatedBy: string;
  metrics: BriefingMetric[];
  /** 総括の本文。段落ごとに配列で持つ。 */
  overview: string[];
  /** 総括の下に並べる要点チップ。 */
  highlights: string[];
  judgments: BriefingJudgment[];
  diffs: BriefingDiff[];
  /**
   * 書き起こされたニュース。収集した記事をそのまま並べたものではない。
   * 材料の大半は捨て、載せる価値のあるものだけがここに来る。
   */
  newsItems: BriefingNewsItem[];
  /** 書き起こされた広報案件。 */
  prItems: BriefingPRItem[];
  /** 世論・反応の傾向。チャネルごとの状況と読み方。 */
  sentimentRows: BriefingSentimentRow[];
  watchlist: BriefingWatch[];
  /** 代表性の留保など、読み方の注意。省略不可。 */
  caveats: string[];
  /** 確認に使った一次情報。リンク契約を通ったものだけが入る。 */
  sources: Source[];
}

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
  /** 朝の状況判断。生成に失敗した日は undefined になり、画面はその旨を出す。 */
  briefing?: Briefing;
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
