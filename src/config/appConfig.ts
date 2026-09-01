import type { AppSettings, DatasetKind } from '@/types/monitoring';

/**
 * Single place for every tunable value. Nothing here is a secret — the bundle is
 * public, so credentials must never be added to this file (see README, security).
 */

const env = import.meta.env as Record<string, string | undefined>;

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Which dataset directory is served.
 * - `sample` -> `sample-data/` : demo content, shows a persistent banner.
 * - `live`   -> `data/`        : production content produced by the daily pipeline.
 */
export const DATA_SOURCE: DatasetKind =
  env.VITE_DATA_SOURCE === 'live' ? 'live' : 'sample';

/** Directory (relative to the site root) the JSON files are fetched from. */
export const DATA_DIR = DATA_SOURCE === 'live' ? 'data' : 'sample-data';

/**
 * Defaults applied when `settings` is missing from the JSON file.
 * The JSON file always wins, so operations can change the N-day rule without a rebuild.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  dashboardQuietDays: readNumber(env.VITE_DASHBOARD_QUIET_DAYS, 7),
  newItemHours: readNumber(env.VITE_NEW_ITEM_HOURS, 48),
  timezone: env.VITE_TIMEZONE ?? 'Asia/Tokyo',
  organizationLabel: env.VITE_ORGANIZATION_LABEL ?? '行政・マイナ関連モニタリング',
};

/**
 * How stale `generatedAt` may be before the UI warns, even when the file itself
 * reports `state: "ok"`. Guards against a silently frozen pipeline.
 */
export const STALE_DATA_HOURS = readNumber(env.VITE_STALE_DATA_HOURS, 26);

export const SITE_TITLE = '行政・マイナ関連 モニタリングポータル';

/**
 * 改修要望の投稿先リポジトリ（`owner/repo`）。
 * 静的サイトには投稿を受けるサーバがないため、GitHub Issue を受け皿にしている。
 */
export const FEEDBACK_REPO =
  env.VITE_FEEDBACK_REPO ?? 'myna-monitoring-jp/myna-monitoring-jp.github.io';

/** Notice repeated wherever SNS reactions are displayed. */
export const SNS_DISCLAIMER =
  'SNSは全国世論を代表するものではありません。目立つ論点と拡散規模を測る非代表サンプルとして表示しています。';
