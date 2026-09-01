import { useCallback } from 'react';
import { useToast } from '@/components/common/Toast';
import { copyToClipboard, currentShareUrl } from '@/lib/share';
import { buildTeamsSummary, type ViewKey } from '@/lib/teamsSummary';
import { createNotificationGateway } from '@/integrations/notifier';
import type { MonitoringDataset } from '@/types/monitoring';

interface ShareActionsProps {
  dataset: MonitoringDataset;
  now: Date;
  view: ViewKey;
}

/**
 * 「共有URLをコピー」/「Teams投稿文をコピー」.
 *
 * The Teams text is also handed to the `NotificationGateway`, which is a mock in
 * the MVP: the gateway records the message but never posts it, so the UI can be
 * wired to an approved workflow later without touching this component.
 */
export function ShareActions({ dataset, now, view }: ShareActionsProps) {
  const { showToast } = useToast();

  const handleCopyUrl = useCallback(async () => {
    const url = currentShareUrl();
    const result = await copyToClipboard(url);
    showToast(
      result === 'copied'
        ? 'この画面の共有URLをコピーしました'
        : 'コピーできませんでした。アドレスバーのURLを手動でコピーしてください',
    );
  }, [showToast]);

  const handleCopyTeams = useCallback(async () => {
    const shareUrl = currentShareUrl();
    const summary = buildTeamsSummary({ dataset, now, shareUrl, view });
    const result = await copyToClipboard(summary);

    const gateway = createNotificationGateway();
    await gateway.send({
      title: 'モニタリング日次サマリ',
      body: summary,
      url: shareUrl,
      kind: 'daily',
    });

    showToast(
      result === 'copied'
        ? 'Teams投稿文をコピーしました（自動投稿は行いません）'
        : 'コピーできませんでした。画面のテキストを手動でコピーしてください',
    );
  }, [dataset, now, showToast, view]);

  return (
    <div className="top-actions">
      <button type="button" className="top-action" onClick={handleCopyUrl}>
        共有URLをコピー
      </button>
      <button type="button" className="top-action primary" onClick={handleCopyTeams}>
        Teams投稿文をコピー
      </button>
    </div>
  );
}
