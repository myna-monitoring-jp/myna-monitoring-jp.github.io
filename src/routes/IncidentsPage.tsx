import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  Incident,
  IncidentCategory,
  ItemStatus,
  MonitoringDataset,
  Severity,
} from '@/types/monitoring';
import { CategoryTabs } from '@/components/incidents/CategoryTabs';
import { IncidentTable } from '@/components/incidents/IncidentTable';
import { FilterToolbar, Field } from '@/components/common/FilterToolbar';
import { SectionTitle } from '@/components/common/Primitives';
import { effectiveStatus } from '@/lib/dashboardRules';
import { distinctValues, filterIncidents, sortItems, type SortKey } from '@/lib/filters';
import { INCIDENT_CATEGORY_META, INCIDENT_CATEGORY_ORDER } from '@/lib/statusLabels';

interface IncidentsPageProps {
  dataset: MonitoringDataset;
  now: Date;
  query: string;
}

const TABLE_VARIANT: Record<IncidentCategory, 'entity' | 'system' | 'medical'> = {
  local_government_insurer: 'entity',
  common_system: 'system',
  medical_it_cyber: 'medical',
};

function isCategory(value: string | null): value is IncidentCategory {
  return !!value && (INCIDENT_CATEGORY_ORDER as string[]).includes(value);
}

/**
 * 不具合・エラー詳細.
 *
 * The active tab lives in the URL (`#/incidents?category=common_system`) so a
 * specific lane can be shared as a deep link.
 */
export function IncidentsPage({ dataset, now, query }: IncidentsPageProps) {
  const { settings } = dataset;
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const category: IncidentCategory = isCategory(categoryParam)
    ? categoryParam
    : 'local_government_insurer';

  const [localQuery, setLocalQuery] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [region, setRegion] = useState('');
  const [cyber, setCyber] = useState<'' | 'cyber' | 'non_cyber'>('');
  const [recovery, setRecovery] = useState<'' | 'recovered' | 'not_recovered'>('');
  const [sort, setSort] = useState<SortKey>('severity');

  const effectiveQuery = [query, localQuery].filter(Boolean).join(' ');
  const resolveStatus = (incident: Incident) => effectiveStatus(incident, settings, now);

  const counts = useMemo(() => {
    const base = {
      local_government_insurer: 0,
      common_system: 0,
      medical_it_cyber: 0,
    } as Record<IncidentCategory, number>;
    for (const incident of dataset.incidents) base[incident.incidentCategory] += 1;
    return base;
  }, [dataset.incidents]);

  const regions = useMemo(
    () => distinctValues(dataset.incidents, (incident) => incident.region),
    [dataset.incidents],
  );

  const visible = useMemo(() => {
    const filtered = filterIncidents(
      dataset.incidents,
      {
        category,
        query: effectiveQuery,
        statuses: status ? [status] : [],
        severities: severity ? [severity] : [],
        region,
        cyber,
        recovery,
      },
      resolveStatus,
    );
    return sortItems(filtered, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.incidents, category, effectiveQuery, status, severity, region, cyber, recovery, sort, settings, now]);

  const changeCategory = (next: IncidentCategory) => {
    const params = new URLSearchParams(searchParams);
    params.set('category', next);
    setSearchParams(params, { replace: true });
  };

  const reset = () => {
    setLocalQuery('');
    setStatus('');
    setSeverity('');
    setRegion('');
    setCyber('');
    setRecovery('');
    setSort('severity');
  };

  const meta = INCIDENT_CATEGORY_META[category];

  return (
    <>
      <SectionTitle
        title="不具合・エラー詳細"
        description="自治体・保険者／オン資・マイナポータル等の共通システム／医療機関・周辺IT・サイバー に分離して監視します。"
      />

      <CategoryTabs active={category} counts={counts} onChange={changeCategory} />

      <FilterToolbar
        searchLabel="キーワード検索"
        searchPlaceholder="自治体・システム・病院・原因・影響を検索"
        query={localQuery}
        onQueryChange={setLocalQuery}
        status={status}
        onStatusChange={setStatus}
        severity={severity}
        onSeverityChange={setSeverity}
        sort={sort}
        onSortChange={setSort}
        onReset={reset}
        resultCount={visible.length}
      >
        <Field label="地域">
          <select aria-label="地域で絞り込む" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">全地域</option>
            {regions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="種別">
          <select
            aria-label="サイバー/非サイバーで絞り込む"
            value={cyber}
            onChange={(e) => setCyber(e.target.value as '' | 'cyber' | 'non_cyber')}
          >
            <option value="">全種別</option>
            <option value="cyber">サイバー攻撃</option>
            <option value="non_cyber">サイバー以外</option>
          </select>
        </Field>
        <Field label="復旧">
          <select
            aria-label="復旧有無で絞り込む"
            value={recovery}
            onChange={(e) => setRecovery(e.target.value as '' | 'recovered' | 'not_recovered')}
          >
            <option value="">全件</option>
            <option value="recovered">復旧済</option>
            <option value="not_recovered">未復旧</option>
          </select>
        </Field>
      </FilterToolbar>

      <div
        role="tabpanel"
        id={`panel-${category}`}
        aria-labelledby={`tab-${category}`}
        data-testid="incident-panel"
        data-category={category}
      >
        <div className="group-header">
          <div>
            <h3>{meta.label}</h3>
            <p>{meta.description}</p>
          </div>
        </div>
        <IncidentTable
          incidents={visible}
          settings={settings}
          now={now}
          caption={meta.label}
          variant={TABLE_VARIANT[category]}
        />
      </div>

      {category === 'medical_it_cyber' && (
        <div className="rulebox">
          <b>対象範囲</b>
          <br />
          サイバー攻撃だけでなく、電子カルテ停止、院内ネットワーク、検査結果連携、クラウド／データセンター、医療ベンダー、個人情報漏えい等も含みます。
        </div>
      )}
      {category === 'common_system' && (
        <div className="rulebox">
          <b>切り分けの注意</b>
          <br />
          マイナアプリやマイナポータルの個別障害と、オンライン資格確認の全国障害は別事象として扱います。計画メンテナンスは
          <b>計画停止</b>として障害と区別します。
        </div>
      )}
    </>
  );
}
