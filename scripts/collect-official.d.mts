/**
 * `collect-official.mjs` の型宣言。
 * パイプラインは依存パッケージなしの素の ESM で書いているため、
 * TypeScript から参照するテスト向けに宣言だけを別に置いている。
 */

export interface CollectedArticle {
  title: string;
  link: string;
  _resolved_url: string;
  pub_date: string | null;
  source: string;
  description: string;
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
