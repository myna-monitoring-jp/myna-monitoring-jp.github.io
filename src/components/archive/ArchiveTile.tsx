import type { AppSettings, BaseItem, Incident, PRItem } from '@/types/monitoring';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { effectiveStatus } from '@/lib/dashboardRules';
import { describeLifecycle } from '@/lib/lifecycle';
import { partitionSources } from '@/lib/links';
import { INCIDENT_CATEGORY_META, PR_CLASSIFICATION_META } from '@/lib/statusLabels';

interface ArchiveTileProps {
  item: BaseItem;
  settings: AppSettings;
  now: Date;
}

/** タイル左上に出す系統名。どの画面から落ちてきた案件かを1語で示す。 */
function laneLabel(item: BaseItem): string {
  const incident = item as Partial<Incident>;
  if (incident.incidentCategory) {
    return INCIDENT_CATEGORY_META[incident.incidentCategory].short;
  }
  const pr = item as Partial<PRItem>;
  if (pr.prClassification) {
    return PR_CLASSIFICATION_META[pr.prClassification].label;
  }
  return 'トップニュース';
}

/**
 * アーカイブ用のタイル。
 *
 * 「リンク・タイトル・発覚から沈静化までの流れ」だけを載せる。詳細ページの
 * カードと違い、国民の声・事実確認・定量情報は出さない。一覧性を優先する。
 */
export function ArchiveTile({ item, settings, now }: ArchiveTileProps) {
  const status = effectiveStatus(item, settings, now);
  const { linkable } = partitionSources(item.sources);
  // 出典は先頭2件まで。タイルが縦に伸びるのを防ぐ。
  const shown = linkable.slice(0, 2);

  return (
    <li className="archive-tile" data-testid="archive-tile" data-item-id={item.id}>
      <div className="archive-tile-head">
        <span className="tag gray">{laneLabel(item)}</span>
        <StatusBadge status={status} withDescription />
      </div>

      <h3>{item.title}</h3>

      <p className="archive-tile-flow" data-testid="archive-flow">
        {describeLifecycle(item, settings, now)}
      </p>

      {shown.length > 0 ? (
        <div className="actionrow">
          {shown.map((source, index) => (
            <ExternalLinkButton key={`${source.url}-${index}`} source={source} />
          ))}
        </div>
      ) : (
        <p className="note">参照できる出典がありません。</p>
      )}
    </li>
  );
}
