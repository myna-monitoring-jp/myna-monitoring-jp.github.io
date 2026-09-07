import type {
  BriefingChange,
  FactAssessment,
  IncidentCategory,
  ItemStatus,
  PRClassification,
  Polarity,
  PublicVoiceChannel,
  PublicVoiceSentiment,
  Severity,
  SourceType,
  StableSubtype,
} from '@/types/monitoring';

/**
 * Every user-visible label lives here so the vocabulary stays consistent.
 * "WATCH" and "継続" must never appear.
 */

export interface StatusMeta {
  value: ItemStatus;
  label: string;
  /** CSS modifier appended to `.status` */
  tone: 'new' | 'alert' | 'follow' | 'done' | 'planned' | 'quiet' | 'archived';
  /** Non-colour cue, so meaning does not depend on colour alone. */
  symbol: string;
  description: string;
}

export const STATUS_META: Record<ItemStatus, StatusMeta> = {
  new: {
    value: 'new',
    label: '新着',
    tone: 'new',
    symbol: '◆',
    description: '原則48時間以内に新しく検知',
  },
  attention: {
    value: 'attention',
    label: '要注視',
    tone: 'alert',
    symbol: '▲',
    description: '影響・反応・報道が拡大中、または即時確認が必要',
  },
  follow_up: {
    value: 'follow_up',
    label: '続報待ち',
    tone: 'follow',
    symbol: '◐',
    description: '未解消のまま推移しているが、直近では新しい拡大がない',
  },
  resolved: {
    value: 'resolved',
    label: '解消済',
    tone: 'done',
    symbol: '●',
    description: '復旧、終了、訂正、回収等が確認できた',
  },
  planned_outage: {
    value: 'planned_outage',
    label: '計画停止',
    tone: 'planned',
    symbol: '■',
    description: '事前に公表されたメンテナンス',
  },
  quiet: {
    value: 'quiet',
    label: '沈静化',
    tone: 'quiet',
    symbol: '○',
    description: '最終重要更新から所定日数、新しい動きがない',
  },
  archived: {
    value: 'archived',
    label: 'アーカイブ',
    tone: 'archived',
    symbol: '▤',
    description: 'ダッシュボード非表示だが履歴として保持',
  },
};

/** Order used by every status <select>. */
export const STATUS_ORDER: ItemStatus[] = [
  'new',
  'attention',
  'follow_up',
  'resolved',
  'planned_outage',
  'quiet',
  'archived',
];

export function statusLabel(status: ItemStatus): string {
  return STATUS_META[status]?.label ?? status;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: '大',
  medium: '中',
  low: '小',
};

export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

/**
 * 解説記事欄の論調バッジ。
 * ポジティブ＝制度に肯定的で使い方などを解説、ネガティブ＝批判的な論調、
 * 中立＝方法や制度を中立的に説明しているだけ。
 */
export const COMMENTARY_TONE_META: Record<
  CommentaryTone,
  { label: string; tone: 'green' | 'gray' | 'red'; symbol: string; description: string }
> = {
  positive: {
    label: 'ポジティブ',
    tone: 'green',
    symbol: '＋',
    description: '制度に肯定的で、使い方やメリットを解説する論調',
  },
  neutral: {
    label: '中立',
    tone: 'gray',
    symbol: '＝',
    description: '方法や制度を中立的に説明しているだけの論調',
  },
  negative: {
    label: 'ネガティブ',
    tone: 'red',
    symbol: '－',
    description: '批判的・否定的な論調',
  },
};

export type CommentaryTone = 'positive' | 'neutral' | 'negative';

/** 解説記事の論調を Polarity から3値へ丸める。 */
export function commentaryTone(polarity?: Polarity): CommentaryTone {
  if (polarity === 'positive') return 'positive';
  if (polarity === 'negative' || polarity === 'negative_watch') return 'negative';
  return 'neutral';
}

export const POLARITY_LABEL: Record<Polarity, string> = {
  positive: 'ポジティブ',
  neutral: '中立',
  negative_watch: '批判の可能性あり',
  negative: 'ネガティブ',
};

export const INCIDENT_CATEGORY_META: Record<
  IncidentCategory,
  { label: string; short: string; description: string; tone: string }
> = {
  local_government_insurer: {
    label: '自治体・保険者関連',
    short: '自治体・保険者',
    description: '資格誤表示、負担割合、資格確認書、国保データ連携、誤送付、標準化移行、個人情報事故等。',
    tone: 'local',
  },
  common_system: {
    label: 'オン資・マイナポータル等の共通システム',
    short: 'オン資・マイナポータル等',
    description: 'オンライン資格確認、医療保険情報取得API、利用登録、マイナポータル、マイナアプリ、J-LIS、PMH、電子処方箋、計画メンテナンス。',
    tone: 'system',
  },
  medical_it_cyber: {
    label: '医療機関・周辺IT／サイバー',
    short: '医療IT・サイバー',
    description: '電子カルテ、院内ネットワーク、地域連携、医療ベンダー、クラウド、ランサムウェア、不正アクセス、Web改ざん、個人情報漏えい。',
    tone: 'cyber',
  },
};

export const INCIDENT_CATEGORY_ORDER: IncidentCategory[] = [
  'local_government_insurer',
  'common_system',
  'medical_it_cyber',
];

export const PR_CLASSIFICATION_META: Record<
  PRClassification,
  { label: string; heading: string; description: string; tone: string }
> = {
  reported_backlash: {
    label: '報道化炎上',
    heading: '二次転載・報道化まで拡大した炎上',
    description:
      '①批判量が大きい、②二次転載が複数発生、③主要メディア/Yahoo!等で記事化、④公式が補足・謝罪・削除・中止等を実施 — の複数条件を満たす案件のみ。',
    tone: 'fire',
  },
  active_watch: {
    label: '掲載中・要注視',
    heading: '掲載中・要注視',
    description:
      '現在掲載・出稿・公開中で、既存の批判論点がある／反応が増加中／切り抜き・誤解のリスクが高い／公式対応待ちの案件。',
    tone: 'watch',
  },
  active_stable: {
    label: '掲載中・安定／ポジティブ',
    heading: '掲載中・安定／ポジティブ',
    description:
      '大きな批判が確認できない案件。「反応未検知」と「好意的反応・効果を確認」はバッジで区別します。',
    tone: 'stable',
  },
};

export const PR_CLASSIFICATION_ORDER: PRClassification[] = [
  'reported_backlash',
  'active_watch',
  'active_stable',
];

export const STABLE_SUBTYPE_META: Record<
  StableSubtype,
  { label: string; description: string; tone: 'gray' | 'green' }
> = {
  quiet: {
    label: '反応未検知',
    description: '大きな否定的反応を確認できていないだけの状態。ポジティブとは判定しません。',
    tone: 'gray',
  },
  positive: {
    label: '好意的反応・効果を確認',
    description: '好意的反応または利用・検索・申請・認知等の効果が定量的に確認できた状態。',
    tone: 'green',
  },
};

export const SOURCE_TYPE_META: Record<
  SourceType,
  { label: string; defaultLinkText: string; tone: 'source' | 'media' | 'social' | 'survey' }
> = {
  primary: { label: '一次情報', defaultLinkText: '一次情報を開く', tone: 'source' },
  media: { label: '報道', defaultLinkText: '報道記事を開く', tone: 'media' },
  social: { label: 'SNS', defaultLinkText: 'X投稿を開く', tone: 'social' },
  survey: { label: '世論調査', defaultLinkText: '調査結果を開く', tone: 'survey' },
};

export const VOICE_CHANNEL_LABEL: Record<PublicVoiceChannel, string> = {
  x: 'X（旧Twitter）',
  yahoo_comment: 'Yahoo!コメント',
  app_store: 'アプリストアレビュー',
  medical_professional: '医療関係者',
  social: 'SNS全般',
  other: 'その他',
};

export const VOICE_SENTIMENT_META: Record<
  PublicVoiceSentiment,
  { label: string; tone: 'green' | 'amber' | 'red' | 'purple' | 'blue' }
> = {
  supportive: { label: '肯定', tone: 'green' },
  concern: { label: '懸念', tone: 'amber' },
  complaint: { label: '不満', tone: 'red' },
  misunderstanding: { label: '誤解', tone: 'purple' },
  field_impact: { label: '現場影響', tone: 'blue' },
};

export const FACT_ASSESSMENT_META: Record<
  FactAssessment,
  { label: string; tone: 'green' | 'amber' | 'red' | 'purple' | 'blue' }
> = {
  fact: { label: '事実ベース', tone: 'green' },
  misunderstanding: { label: '誤解', tone: 'red' },
  overstatement: { label: '言い過ぎ', tone: 'amber' },
  legitimate_debate: { label: '正当な制度論点', tone: 'blue' },
  scope_separation: { label: '影響範囲の切り分け', tone: 'purple' },
};

/** Shown when an item has no observed reaction at all. */
export const NO_REACTION_TEXT = '新規の有意な反応は確認できず';

/**
 * 前日差分のラベル。案件の状態（ItemStatus）とは別の語彙で、
 * 「前日と比べて何が動いたか」だけを表す。ここも「継続」は使わない。
 */
export const BRIEFING_CHANGE_META: Record<
  BriefingChange,
  { label: string; tone: 'new' | 'up' | 'down' | 'flat' | 'done'; symbol: string }
> = {
  new: { label: '新規', tone: 'new', symbol: '＋' },
  increased: { label: '増加', tone: 'up', symbol: '↑' },
  decreased: { label: '減少', tone: 'down', symbol: '↓' },
  flat: { label: '横ばい', tone: 'flat', symbol: '＝' },
  scheduled_end: { label: '予定終了', tone: 'done', symbol: '■' },
  resolved: { label: '解消', tone: 'done', symbol: '●' },
};
