import type { MonitoringDataset } from '@/types/monitoring';
import type { NormalizeIssue } from '@/data/normalize';
import { Banner } from '@/components/common/Primitives';
import { formatDateTime } from '@/lib/format';

interface DataStatusBannersProps {
  dataset: MonitoringDataset;
  issues: readonly NormalizeIssue[];
  loadError?: string;
}

/**
 * Trust indicators (要件 10「信頼性」/ 受入条件 16, 18):
 * - sample vs production dataset
 * - update failure, with the last successful update time
 * - records dropped or downgraded while parsing
 */
export function DataStatusBanners({ dataset, issues, loadError }: DataStatusBannersProps) {
  const { dataUpdate } = dataset;

  return (
    <>
      {dataset.dataset === 'sample' && (
        <Banner tone="sample" title="サンプルデータを表示しています。">
          本番データではありません。本番表示に切り替えるには <code>VITE_DATA_SOURCE=live</code> でビルドし、
          <code>data/current.json</code> を配置してください。
        </Banner>
      )}

      {dataUpdate.state === 'failed' && (
        <Banner tone="error" title="データ更新に失敗しています。" role="alert">
          最終正常更新：{formatDateTime(dataUpdate.lastSuccessfulUpdateAt, '記録なし')}
          {dataUpdate.message ? `／${dataUpdate.message}` : ''}
          {loadError ? `／${loadError}` : ''}
          <br />
          表示中の内容は最新ではない可能性があります。
        </Banner>
      )}

      {dataUpdate.state === 'stale' && (
        <Banner tone="warn" title="データが一定時間更新されていません。">
          最終正常更新：{formatDateTime(dataUpdate.lastSuccessfulUpdateAt, '記録なし')}
          {dataUpdate.message ? `／${dataUpdate.message}` : ''}
        </Banner>
      )}

      {dataUpdate.state === 'never_updated' && (
        <Banner tone="warn" title="データがまだ投入されていません。">
          日次更新フローを実行し、<code>current.json</code> を配置してください。
        </Banner>
      )}

      {issues.length > 0 && (
        <Banner tone="warn" title={`データ品質の注意が${issues.length}件あります。`}>
          <details>
            <summary>内容を表示</summary>
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <code>{issue.path}</code>：{issue.message}
                </li>
              ))}
            </ul>
          </details>
        </Banner>
      )}
    </>
  );
}
