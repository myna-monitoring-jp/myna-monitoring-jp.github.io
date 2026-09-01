import type { FactCheck } from '@/types/monitoring';
import { FACT_ASSESSMENT_META } from '@/lib/statusLabels';
import { Tag } from '@/components/common/Primitives';

/**
 * 事実関係・誤解の切り分け (要件 5.C).
 *
 * Separates 事実 / 誤解 / 言い過ぎ / 正当な制度論点 / 影響範囲の切り分け
 * (e.g. マイナアプリ障害 ≠ オンライン資格確認の全国障害).
 */
export function FactCheckList({ factChecks = [] }: { factChecks?: readonly FactCheck[] }) {
  if (factChecks.length === 0) {
    return <p className="note">切り分けが必要な誤解・論点は現時点で確認していません。</p>;
  }
  return (
    <ul>
      {factChecks.map((check, index) => {
        const meta = FACT_ASSESSMENT_META[check.assessment];
        return (
          <li className="fact" key={`${check.claim}-${index}`}>
            <div className="voice-head">
              <Tag tone={meta.tone}>{meta.label}</Tag>
            </div>
            <p className="fact-claim" style={{ margin: 0 }}>
              「{check.claim}」
            </p>
            <p style={{ margin: '3px 0 0' }}>{check.explanation}</p>
          </li>
        );
      })}
    </ul>
  );
}
