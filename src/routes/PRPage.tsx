import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  ItemStatus,
  MonitoringDataset,
  PRClassification,
  PRItem,
  Severity,
  StableSubtype,
} from '@/types/monitoring';
import { PRColumn } from '@/components/pr/PRColumn';
import { FilterToolbar, Field } from '@/components/common/FilterToolbar';
import { SectionTitle } from '@/components/common/Primitives';
import { effectiveStatus } from '@/lib/dashboardRules';
import { distinctValues, filterPRItems, sortItems, type SortKey } from '@/lib/filters';
import { PR_CLASSIFICATION_META, PR_CLASSIFICATION_ORDER } from '@/lib/statusLabels';

interface PRPageProps {
  dataset: MonitoringDataset;
  now: Date;
  query: string;
}

function isClassification(value: string | null): value is PRClassification {
  return !!value && (PR_CLASSIFICATION_ORDER as string[]).includes(value);
}

/**
 * 広報・広告ウォッチ.
 *
 * Three fixed columns. `?classification=` narrows to one lane for deep links;
 * `?stable=positive` further splits 安定 into 反応未検知 / 好意的・効果あり.
 */
export function PRPage({ dataset, now, query }: PRPageProps) {
  const { settings } = dataset;
  const [searchParams, setSearchParams] = useSearchParams();
  const classificationParam = searchParams.get('classification');
  const classification: PRClassification | '' = isClassification(classificationParam)
    ? classificationParam
    : '';

  const [localQuery, setLocalQuery] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [ministry, setMinistry] = useState('');
  const [stableSubtype, setStableSubtype] = useState<StableSubtype | ''>('');
  const [officialAction, setOfficialAction] = useState<'' | 'acted' | 'none'>('');
  const [sort, setSort] = useState<SortKey>('lastUpdate');

  const effectiveQuery = [query, localQuery].filter(Boolean).join(' ');
  const ministries = useMemo(
    () => distinctValues(dataset.prItems, (item) => item.ministry),
    [dataset.prItems],
  );

  const visible = useMemo(() => {
    const filtered = filterPRItems(
      dataset.prItems,
      {
        classification,
        query: effectiveQuery,
        statuses: status ? [status] : [],
        severities: severity ? [severity] : [],
        ministry,
        stableSubtype,
        officialAction,
      },
      (item: PRItem) => effectiveStatus(item, settings, now),
    );
    return sortItems(filtered, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataset.prItems,
    classification,
    effectiveQuery,
    status,
    severity,
    ministry,
    stableSubtype,
    officialAction,
    sort,
    settings,
    now,
  ]);

  const columns = PR_CLASSIFICATION_ORDER.filter(
    (value) => !classification || value === classification,
  );

  const setClassification = (next: PRClassification | '') => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('classification', next);
    else params.delete('classification');
    setSearchParams(params, { replace: true });
  };

  const reset = () => {
    setLocalQuery('');
    setStatus('');
    setSeverity('');
    setMinistry('');
    setStableSubtype('');
    setOfficialAction('');
    setSort('lastUpdate');
    setClassification('');
  };

  return (
    <>
      <SectionTitle
        title="広報・広告ウォッチ"
        description="報道化炎上／掲載中・要注視／掲載中・安定（反応未検知・ポジティブ）の3分類"
      />

      <FilterToolbar
        searchLabel="キーワード検索"
        searchPlaceholder="省庁・キャンペーン・媒体・論点を検索"
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
        <Field label="分類">
          <select
            aria-label="広報分類で絞り込む"
            value={classification}
            onChange={(e) => setClassification(e.target.value as PRClassification | '')}
          >
            <option value="">全分類</option>
            {PR_CLASSIFICATION_ORDER.map((value) => (
              <option key={value} value={value}>
                {PR_CLASSIFICATION_META[value].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="省庁">
          <select aria-label="省庁で絞り込む" value={ministry} onChange={(e) => setMinistry(e.target.value)}>
            <option value="">全省庁</option>
            {ministries.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="安定の内訳">
          <select
            aria-label="安定案件の内訳で絞り込む"
            value={stableSubtype}
            onChange={(e) => setStableSubtype(e.target.value as StableSubtype | '')}
          >
            <option value="">指定なし</option>
            <option value="quiet">反応未検知</option>
            <option value="positive">好意的反応・効果を確認</option>
          </select>
        </Field>
        <Field label="公式対応">
          <select
            aria-label="公式対応の有無で絞り込む"
            value={officialAction}
            onChange={(e) => setOfficialAction(e.target.value as '' | 'acted' | 'none')}
          >
            <option value="">全件</option>
            <option value="acted">公式対応あり</option>
            <option value="none">公式対応なし</option>
          </select>
        </Field>
      </FilterToolbar>

      <div className="pr-columns" id="prBoard">
        {columns.map((value) => (
          <PRColumn
            key={value}
            classification={value}
            items={visible.filter((item) => item.prClassification === value)}
            settings={settings}
            now={now}
          />
        ))}
      </div>

      <div className="rulebox">
        <b>炎上欄への掲載基準</b>
        <br />
        単に批判投稿があるだけでは入れません。①批判量が大きい、②二次転載が複数発生、③主要メディア/Yahoo!等で記事化、④公式側が補足・謝罪・削除・中止等を実施
        — の複数条件を満たす案件を優先します。同一通信社・系列の転載は独立媒体数として重複計上しません。
      </div>
      <div className="rulebox">
        <b>「反応未検知」と「ポジティブ」の区別</b>
        <br />
        大きな批判が確認できないだけの案件は<b>反応未検知</b>です。好意的反応または利用・検索・申請・認知等の効果が定量的に確認できた場合にのみ
        <b>好意的反応・効果を確認</b>と判定します。
      </div>
    </>
  );
}
