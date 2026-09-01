import { useCallback, useState } from 'react';
import { useToast } from '@/components/common/Toast';
import { CopyPanel } from '@/components/common/CopyPanel';
import { copyToClipboard, currentShareUrl } from '@/lib/share';
import { buildTeamsSummary, type ViewKey } from '@/lib/teamsSummary';
import { createNotificationGateway } from '@/integrations/notifier';
import type { MonitoringDataset } from '@/types/monitoring';

interface ShareActionsProps {
  dataset: MonitoringDataset;
  now: Date;
  view: ViewKey;
}

interface PanelState {
  title: string;
  description: string;
  text: string;
}

/**
 * 「共有URLをコピー」/「Teams投稿文をコピー」.
 *
 * Clipboard writes are blocked outright in many managed browsers, so a failed
 * copy is a normal outcome, not an error: the text is then shown in `CopyPanel`
 * where it can be selected and copied manually. The action always ends with the
 * user able to obtain the text.
 *
 * The Teams text is also handed to the `NotificationGateway`, which is a mock in
 * the MVP: it records the message but never posts it, so the UI can be wired to
 * an approved workflow later without touching this component.
 */
export function ShareActions({ dataset, now, view }: ShareActionsProps) {
  const { showToast } = useToast();
  const [panel, setPanel] = useState<PanelState | null>(null);

  const handleCopyUrl = useCallback(async () => {
    const url = currentShareUrl();
    const result = await copyToClipboard(url);
    if (result === 'copied') {
      showToast('この画面の共有URLをコピーしました');
      return;
    }
    setPanel({
      title: '共有URL',
      description:
        'お使いのブラウザではクリップボードへの書き込みが許可されていません。下のURLを選択してコピーしてください。',
      text: url,
    });
  }, [showToast]);

  const handleCopyTeams = useCallback(async () => {
    const shareUrl = currentShareUrl();
    let summary: string;
    try {
      summary = buildTeamsSummary({ dataset, now, shareUrl, view });
    } catch (error) {
      // 生成に失敗しても無反応にはしない。
      showToast(
        `Teams投稿文を生成できませんでした：${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const result = await copyToClipboard(summary);

    const gateway = createNotificationGateway();
    await gateway.send({
      title: 'モニタリング日次サマリ',
      body: summary,
      url: shareUrl,
      kind: 'daily',
    });

    if (result === 'copied') {
      showToast('Teams投稿文をコピーしました（自動投稿は行いません）');
      return;
    }
    setPanel({
      title: 'Teams投稿文',
      description:
        'お使いのブラウザではクリップボードへの書き込みが許可されていません。下の本文を選択してコピーし、Teamsに貼り付けてください。自動投稿は行いません。',
      text: summary,
    });
  }, [dataset, now, showToast, view]);

  return (
    <>
      <div className="top-actions">
        <button type="button" className="top-action" onClick={handleCopyUrl}>
          共有URLをコピー
        </button>
        <button type="button" className="top-action primary" onClick={handleCopyTeams}>
          Teams投稿文をコピー
        </button>
      </div>

      {panel && (
        <CopyPanel
          title={panel.title}
          description={panel.description}
          text={panel.text}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}
