import type { BriefingPRItem } from '@/types/monitoring';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { SEVERITY_LABEL } from '@/lib/statusLabels';
import { partitionSources } from '@/lib/links';

interface BriefingPRCardProps {
  item: BriefingPRItem;
}

/**
 * 書き起こされた広報案件1件。8項目で構成する。
 *
 * ④想定される論点は「予測される批判」であって国民の声ではない。
 * 画面上でもそう読めるように、③現に確認できる批判とは別の欄にし、
 * 「広報上の確認ポイント」と明示する。
 */
export function BriefingPRCard({ item }: BriefingPRCardProps) {
  const { linkable } = partitionSources(item.sources);

  /** ①〜⑧の並び。定義順を画面の順序と一致させておく。 */
  const rows: { no: string; label: string; text: string; kind?: 'risk' }[] = [
    { no: '①', label: '起点', text: item.origin },
    { no: '②', label: '訴求意図', text: item.intent },
    { no: '③', label: '現に確認できる批判', text: item.observedCriticism },
    { no: '④', label: '想定される論点（広報上の確認ポイント）', text: item.potentialIssues, kind: 'risk' },
    { no: '⑤', label: '切り分け', text: item.separation },
    { no: '⑥', label: '公式補足', text: item.officialNote },
    { no: '⑦', label: '二次拡散', text: item.secondarySpread },
    { no: '⑧', label: '広報上の注意', text: item.communicationNote },
  ];

  return (
    <article className="bpr" data-testid="briefing-pr" data-item-id={item.id}>
      <header className="bpr-head">
        <h4>{item.headline}</h4>
        <ul className="bpr-badges">
          <li className={`bpr-heat bpr-heat-${item.heatLevel}`}>炎上度：{SEVERITY_LABEL[item.heatLevel]}</li>
          {item.badges.map((badge) => (
            <li className="bpr-badge" key={badge}>
              {badge}
            </li>
          ))}
        </ul>
      </header>

      <dl className="bpr-rows">
        {rows
          .filter((row) => row.text)
          .map((row) => (
            <div className={`bpr-row${row.kind === 'risk' ? ' bpr-row-risk' : ''}`} key={row.no}>
              <dt>
                <span aria-hidden="true">{row.no}</span>
                {row.label}
              </dt>
              <dd>{row.text}</dd>
            </div>
          ))}
      </dl>

      {row0Note(item)}

      {linkable.length > 0 ? (
        <div className="actionrow">
          {linkable.map((source) => (
            <ExternalLinkButton key={source.url} source={source} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * ④が埋まっているときだけ、そこが国民の声ではないことを明記する。
 * 要件で「予測される批判は国民の声に入れない」と決めているため、
 * 画面でも取り違えられないようにする。
 */
function row0Note(item: BriefingPRItem) {
  if (!item.potentialIssues) return null;
  return (
    <p className="note" data-testid="briefing-pr-risk-note">
      ④は実際に観測された声ではなく、広報上の確認ポイントです。観測された批判は③に記載しています。
    </p>
  );
}
