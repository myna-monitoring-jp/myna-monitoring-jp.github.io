/**
 * `collect-official.mjs` の型宣言。
 * パイプラインは依存パッケージなしの素の ESM で書いているため、
 * TypeScript から参照するテスト向けに宣言だけを別に置いている。
 */

/** 実体参照を戻す。二重エスケープ（`&amp;nbsp;`）にも対応する。 */
export function decodeEntities(text: unknown): string;

/** タグと実体参照を落として本文だけにする。 */
export function toPlainText(html: unknown): string;

/** Google News の「見出し - 媒体名」を分ける。 */
export function splitGoogleNewsTitle(raw: unknown): { title: string; publisher: string };

/** 概要が表題（＋媒体名）の焼き直しにすぎないか。 */
export function isEchoOfTitle(description: unknown, title: string, publisher: string): boolean;

export interface CollectedArticle {
  title: string;
  link: string;
  _resolved_url: string;
  pub_date: string | null;
  source: string;
  description: string;
  /** 収集器側で情報源ごとの期間を判定済み。後段の3日フィルタを飛ばす印。 */
  _ageChecked: true;
  _origin: string;
}

export interface CollectedStatusIncident {
  id: string;
  incidentCategory: string;
  entityName: string;
  systemName?: string;
  title: string;
  status: 'attention' | 'resolved';
  severity: 'high' | 'medium';
  symptoms: string;
  officialStatus: string;
  affectedCount: null;
  affectedCountNote: string;
  cyberAttack: boolean;
  summary: string;
  whatIsNew: string;
  reviewState: 'unreviewed';
  tags: string[];
  publicVoices: unknown[];
  factChecks: { claim: string; assessment: string; explanation: string }[];
  sources: {
    type: string;
    label: string;
    url: string;
    linkText: string;
    publisher?: string;
    verifiedAt: string;
    active: boolean;
  }[];
  _origin: string;
}

export interface CollectResult {
  articles: CollectedArticle[];
  statusIncidents: CollectedStatusIncident[];
  errors: string[];
  state: Record<string, unknown>;
}

export function collectOfficialSources(options: {
  sourcesPath: string;
  statePath: string;
  now: Date;
  maxAgeDays?: number;
}): Promise<CollectResult>;
