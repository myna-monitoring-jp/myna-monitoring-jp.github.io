import { DATA_DIR, DATA_SOURCE, STALE_DATA_HOURS } from '@/config/appConfig';
import { hoursSince } from '@/lib/format';
import type { MonitoringDataset } from '@/types/monitoring';
import { emptyDataset, normalizeDataset, type NormalizeIssue } from '@/data/normalize';

/**
 * Fetches `current.json` / `archive/<date>.json` from the configured data
 * directory. A failed fetch never blanks the screen: the loader returns an empty
 * dataset carrying `dataUpdate.state = 'failed'` so the UI can show the last
 * known good update time (要件 11-18).
 */

export interface LoadResult {
  dataset: MonitoringDataset;
  issues: NormalizeIssue[];
  /** Set when the fetch or the parse failed outright. */
  error?: string;
}

/** Resolves a data path against the deployed base path (supports sub-directory hosting). */
export function dataUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  // Collapse accidental double slashes without touching the "https://" prefix.
  return `${normalizedBase}${DATA_DIR}/${relativePath}`.replace(/([^:])\/{2,}/g, '$1/');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function failureResult(message: string): LoadResult {
  return {
    dataset: emptyDataset({
      dataset: DATA_SOURCE,
      dataUpdate: {
        state: 'failed',
        attemptedAt: new Date().toISOString(),
        message,
      },
    }),
    issues: [],
    error: message,
  };
}

/**
 * Marks a dataset as stale when `generatedAt` is older than `STALE_DATA_HOURS`,
 * even if the file claims success — a frozen pipeline must be visible.
 */
function applyStaleness(dataset: MonitoringDataset, now: Date): MonitoringDataset {
  if (dataset.dataUpdate.state !== 'ok') return dataset;
  if (hoursSince(dataset.generatedAt, now) <= STALE_DATA_HOURS) return dataset;
  return {
    ...dataset,
    dataUpdate: {
      ...dataset.dataUpdate,
      state: 'stale',
      lastSuccessfulUpdateAt: dataset.dataUpdate.lastSuccessfulUpdateAt ?? dataset.generatedAt,
      message: `データが${STALE_DATA_HOURS}時間以上更新されていません。更新処理を確認してください。`,
    },
  };
}

export async function loadCurrentDataset(now: Date = new Date()): Promise<LoadResult> {
  try {
    const raw = await fetchJson(dataUrl('current.json'));
    const { dataset, issues } = normalizeDataset(raw);
    return { dataset: applyStaleness(dataset, now), issues };
  } catch (error) {
    return failureResult(
      `最新データ（${DATA_DIR}/current.json）を取得できませんでした：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function loadArchiveDataset(date: string, now: Date = new Date()): Promise<LoadResult> {
  // Guard against path traversal in a user-supplied hash parameter.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return failureResult(`日付の指定が不正です：${date}`);
  }
  try {
    const raw = await fetchJson(dataUrl(`archive/${date}.json`));
    const { dataset, issues } = normalizeDataset(raw);
    return { dataset: applyStaleness(dataset, now), issues };
  } catch (error) {
    return failureResult(
      `アーカイブ（${DATA_DIR}/archive/${date}.json）を取得できませんでした：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
