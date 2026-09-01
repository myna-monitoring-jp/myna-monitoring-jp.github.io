import type { PublicVoice } from '@/types/monitoring';
import {
  NO_REACTION_TEXT,
  VOICE_CHANNEL_LABEL,
  VOICE_SENTIMENT_META,
} from '@/lib/statusLabels';
import { formatNumber } from '@/lib/format';
import { Tag } from '@/components/common/Primitives';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { SNS_DISCLAIMER } from '@/config/appConfig';

interface PublicVoiceListProps {
  voices?: readonly PublicVoice[];
  /** Predicted (not yet observed) criticism. Displayed separately, never as a voice. */
  communicationRisks?: readonly string[];
}

function metricsLine(voice: PublicVoice): string | null {
  const parts: string[] = [];
  if (voice.replyCount !== undefined) parts.push(`返信 ${formatNumber(voice.replyCount)}`);
  if (voice.repostCount !== undefined) parts.push(`RP ${formatNumber(voice.repostCount)}`);
  if (voice.likeCount !== undefined) parts.push(`いいね ${formatNumber(voice.likeCount)}`);
  if (voice.commentCount !== undefined) parts.push(`コメント ${formatNumber(voice.commentCount)}`);
  if (voice.impressionCount !== undefined) parts.push(`表示 ${formatNumber(voice.impressionCount)}`);
  return parts.length > 0 ? parts.join('｜') : null;
}

/**
 * 国民の声・現場の声 (要件 5.B).
 *
 * Only *observed* reactions belong here. When nothing was observed the card must
 * say 「新規の有意な反応は確認できず」 rather than showing an empty list.
 * Predicted criticism is rendered under 「広報上のリスク」.
 */
export function PublicVoiceList({ voices = [], communicationRisks = [] }: PublicVoiceListProps) {
  return (
    <>
      {voices.length === 0 ? (
        <p className="note" data-testid="no-reaction">
          {NO_REACTION_TEXT}
        </p>
      ) : (
        <ul>
          {voices.map((voice, index) => {
            const metrics = metricsLine(voice);
            const sentiment = voice.sentiment ? VOICE_SENTIMENT_META[voice.sentiment] : null;
            return (
              <li className="voice" key={voice.id ?? `${voice.channel}-${index}`}>
                <div className="voice-head">
                  <Tag tone="gray">{VOICE_CHANNEL_LABEL[voice.channel]}</Tag>
                  {sentiment && <Tag tone={sentiment.tone}>{sentiment.label}</Tag>}
                  {voice.representative && <Tag tone="purple">代表投稿</Tag>}
                </div>
                <p style={{ margin: 0 }}>{voice.summary}</p>
                {metrics && <p className="voice-metrics">{metrics}</p>}
                {voice.url && (
                  <div className="actionrow">
                    <ExternalLinkButton
                      source={{
                        type: 'social',
                        label: VOICE_CHANNEL_LABEL[voice.channel],
                        url: voice.url,
                        linkText: voice.channel === 'x' ? 'X投稿を開く' : '投稿を開く',
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {voices.length > 0 && <p className="note">{SNS_DISCLAIMER}</p>}

      {communicationRisks.length > 0 && (
        <div className="rulebox" data-testid="communication-risks">
          <b>広報上のリスク（予測。実際に観測された反応ではありません）</b>
          <ul style={{ margin: '5px 0 0', paddingLeft: '1.1em' }}>
            {communicationRisks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
