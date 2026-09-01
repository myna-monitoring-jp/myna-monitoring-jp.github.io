import type { AppSettings, Incident } from '@/types/monitoring';
import { StatusBadge } from '@/components/common/StatusBadge';
import { SourceList } from '@/components/common/ExternalLinkButton';
import { EmptyState } from '@/components/common/Primitives';
import { effectiveStatus } from '@/lib/dashboardRules';
import { formatAffectedCount, formatDateTime, formatShortDate } from '@/lib/format';
import { SEVERITY_LABEL } from '@/lib/statusLabels';

interface IncidentTableProps {
  incidents: readonly Incident[];
  settings: AppSettings;
  now: Date;
  caption: string;
  /** Header wording differs slightly for the medical / cyber lane. */
  variant: 'entity' | 'system' | 'medical';
}

const HEADERS: Record<IncidentTableProps['variant'], string[]> = {
  entity: ['自治体/主体', '発生日・公表日', '事象', '規模', '原因/論点', '状態', '影響', '出典'],
  system: ['主体/システム', '発生日・公表日', '事象', '規模', '原因/論点', '状態', '影響', '出典'],
  medical: ['医療機関/主体', '発生日・公表日', '事象', '規模', '原因/攻撃', '状態', '診療・情報影響', '出典'],
};

function dateCell(incident: Incident): string {
  const parts = [
    incident.occurredAt ? `${formatShortDate(incident.occurredAt)}発生` : null,
    incident.publishedAt ? `${formatShortDate(incident.publishedAt)}公表` : null,
    incident.recoveryAt ? `${formatShortDate(incident.recoveryAt)}復旧` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '日付未公表';
}

/** Tabular incident view. One table per category — the lanes are never merged. */
export function IncidentTable({ incidents, settings, now, caption, variant }: IncidentTableProps) {
  if (incidents.length === 0) {
    return <EmptyState>条件に一致する案件はありません。検索語・状態・地域の絞り込みを解除してください。</EmptyState>;
  }

  return (
    <div className="tablewrap">
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {HEADERS[variant].map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id} data-testid="incident-row" data-item-id={incident.id}>
              <th scope="row" style={{ background: 'transparent', position: 'static' }}>
                <b>{incident.entityName}</b>
                {incident.systemName && (
                  <>
                    <br />
                    {incident.systemName}
                  </>
                )}
                {incident.region && <div className="note">{incident.region}</div>}
              </th>
              <td>{dateCell(incident)}</td>
              <td>
                {incident.title}
                {incident.symptoms && <div className="note">{incident.symptoms}</div>}
              </td>
              <td>
                {formatAffectedCount(incident.affectedCount, incident.affectedCountNote)}
                <div className="note">重要度 {SEVERITY_LABEL[incident.severity]}</div>
              </td>
              <td>
                {incident.cause ?? '原因未公表'}
                {incident.cyberAttack && <div className="note">サイバー攻撃として公表</div>}
                {incident.workaround && <div className="note">回避策：{incident.workaround}</div>}
              </td>
              <td>
                <StatusBadge status={effectiveStatus(incident, settings, now)} withDescription />
                <div className="note">最終重要更新 {formatDateTime(incident.lastMaterialUpdateAt, '未設定')}</div>
              </td>
              <td>
                {incident.medicalImpact ?? '影響情報なし'}
                {incident.personalDataImpact && (
                  <div className="note">個人情報：{incident.personalDataImpact}</div>
                )}
                {incident.officialStatus && <div className="note">公式：{incident.officialStatus}</div>}
              </td>
              <td>
                <SourceList sources={incident.sources} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
