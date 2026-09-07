/**
 * `collect-briefing.mjs` の型宣言。
 * パイプラインは依存パッケージなしの素の ESM で書いているため、
 * TypeScript から参照するテスト向けに宣言だけを別に置いている。
 */

import type { Briefing } from '../src/types/monitoring';

export interface BriefingResult {
  briefing: Briefing | null;
  errors: string[];
  usage: { research: unknown; format: unknown } | null;
}

export function collectBriefing(options?: {
  apiKey?: string;
  model?: string;
  now: Date;
  previous?: Briefing | null;
  /** テストでローカルサーバに向けるための差し替え。本番では渡さない。 */
  apiUrlOverride?: string;
}): Promise<BriefingResult>;

export function extractText(payload: unknown): string;

/** 生成物の受け入れ検査。リンク契約・語彙・件数を強制する。 */
export function sanitizeBriefing(briefing: Record<string, unknown>): Briefing;

export const __internal: {
  BRIEFING_SCHEMA: Record<string, unknown>;
  previousContext(previous: Briefing | null): string;
};
