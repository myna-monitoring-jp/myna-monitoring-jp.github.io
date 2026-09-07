import { Link } from 'react-router-dom';
import type { Incident, MonitoringDataset, NewsItem, PRItem } from '@/types/monitoring';
import { MorningBriefing } from '@/components/briefing/MorningBriefing';
import { DailyReportLink } from '@/components/common/DailyReportLink';
import { NewsCard } from '@/components/news/NewsCard';
import { ReferenceTiles } from '@/components/news/ReferenceTiles';
import { PRItemCard } from '@/components/pr/PRItemCard';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState, SectionTitle } from '@/components/common/Primitives';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { selectDashboardItems, effectiveStatus } from '@/lib/dashboardRules';
import { computeDashboardCounts } from '@/lib/teamsSummary';
import { matchesQuery } from '@/lib/filters';
import { formatDate } from '@/lib/format';
import { INCIDENT_CATEGORY_META, INCIDENT_CATEGORY_ORDER, STATUS_ORDER, STATUS_META } from '@/lib/statusLabels';
import { SNS_DISCLAIMER } from '@/config/appConfig';

interface DashboardPageProps {
  dataset: MonitoringDataset;
  now: Date;
  query: string;
}

/**
 * 「今日の全体像」.
 *
 * Only items that pass the N-day rule appear here. Everything else stays
 * reachable from the detail pages and the archive.
 */
export function DashboardPage({ dataset, now, query }: DashboardPageProps) {
  const { settings } = dataset;
  const counts = computeDashboardCounts(dataset, now);

  // 「要注視」を先頭に寄せる。次に新着、続報待ち、その他。
  const statusRank = (item: NewsItem): number => {
    const status = effectiveStatus(item, settings, now);
    if (status === 'attention') return 0;
    if (status === 'new') return 1;
    if (status === 'follow_up') return 2;
    return 3;
  };

  const dashboardNews = selectDashboardItems<NewsItem>(dataset.news, settings, now).filter((item) =>
    matchesQuery(item, query),
  );

  const news = dashboardNews
    // 解説記事はトップニュース画面の下部、参考情報はこの画面の下部にまとめる
    .filter((item) => item.category !== 'commentary' && item.category !== 'reference')
    /*
     * 機械収集した見出しは本線の一覧に出さない。
     *
     * 見出しをそのまま並べたカードは表題以上の情報を持たず、書き起こされた
     * 案件と同じ見た目で並ぶと報告の質が見分けられなくなる。
     * 全量は「収集一覧」画面に置き、朝の状況判断がそこから選んで書き起こす。
     *
     * 解説記事欄と参考情報欄はここでは除かない。小タイルの別枠であり、
     * 本線と混ざらないことが分かる形で置いてある。
     */
    .filter((item) => item.reviewState !== 'unreviewed')
    .sort((a, b) => statusRank(a) - statusRank(b));

  // 参考情報：一次情報だが監視対象の事象ではないもの。不具合の下に小さく置く。
  const reference = dashboardNews.filter((item) => item.category === 'reference');
  const incidents = selectDashboardItems<Incident>(dataset.incidents, settings, now);
  const prItems = selectDashboardItems<PRItem>(dataset.prItems, settings, now).filter((item) =>
    matchesQuery(item, query),
  );

  const incidentCounts: Record<string, number> = {
    local_government_insurer: counts.localGovernment,
    common_system: counts.commonSystem,
    medical_it_cyber: counts.medicalItCyber,
  };

  const attentionIncidents = incidents
    .filter((incident) => effectiveStatus(incident, settings, now) === 'attention')
    .filter((incident) => matchesQuery(incident, query));

  return (
    <>
      <section className="hero">
        <small>DAILY OVERVIEW / {formatDate(dataset.reportDate, '日付未設定')}</small>
        <h1>{dataset.headline?.title ?? '今日の全体像'}</h1>
        <p>
          {dataset.headline?.description ??
            'トップニュース・世論、自治体／共通システム／医療機関の不具合、行政広報の炎上・掲載中・好反応を一つの固定URLで共有します。'}
        </p>
        <ul className="kpis">
          <li className="kpi">
            <small>掲載中トップニュース</small>
            <b>{counts.news}件</b>
          </li>
          <li className="kpi">
            <small>自治体・保険者</small>
            <b>{counts.localGovernment}件</b>
          </li>
          <li className="kpi">
            <small>共通システム</small>
            <b>{counts.commonSystem}件</b>
          </li>
          <li className="kpi">
            <small>医療IT・サイバー</small>
            <b>{counts.medicalItCyber}件</b>
          </li>
          <li className="kpi">
            <small>掲載中広報 要注視</small>
            <b>{counts.prWatch}件</b>
          </li>
        </ul>
      </section>

      {/*
        朝の状況判断。機械収集で取れない層（公式ページの現在の表示、前日との数値差分、
        確認できなかったこと）を持つため、一覧より先に置く。
      */}
      <MorningBriefing briefing={dataset.briefing} />

      {/*
        日別レポートへの導線。
        調査パイプラインが生成する単一HTMLで、A/B/C/Dブロックと検索ログの件数を持つ。
        Vite の管理外に置いているため、SPA内リンクではなく通常のリンクで開く。
      */}
      <DailyReportLink reportDate={dataset.reportDate} />

      <ul className="legend" aria-label="状態ラベルの説明">
        {STATUS_ORDER.map((status) => (
          <li key={status}>
            <StatusBadge status={status} />
            {STATUS_META[status].description}
          </li>
        ))}
      </ul>

      <SectionTitle
        title="今日のトップニュース"
        description="状態ラベルは押せません。押せる箇所は「○○を開く」と明記したボタンです。"
      />
      {news.length === 0 ? (
        <EmptyState>
          ダッシュボード掲載中のトップニュースはありません。
          {query ? '検索条件を解除するか、' : ''}
          <Link to="/news">トップニュース・世論</Link>で全件を確認してください。
        </EmptyState>
      ) : (
        <div className="grid-3">
          {news.map((item) => (
            <NewsCard key={item.id} item={item} settings={settings} now={now} compact />
          ))}
        </div>
      )}

      <div className="rulebox">
        <b>「要注視」と「続報待ち」の違い</b>
        <br />
        <b>要注視</b>＝今日も能動的に確認する理由がある状態。影響拡大、反応増加、追加報道、公式対応待ちなど。
        <br />
        <b>続報待ち</b>＝未解消のまま推移しているものの、直近では新しい拡大が出ていない状態。最後の重要更新から
        {settings.dashboardQuietDays}日たてばダッシュボードから外し、
        <b>沈静化</b>として詳細・アーカイブに保持します。
      </div>

      <SectionTitle title="不具合・エラー速報" description="3系統に分けて監視" />
      <div className="incident-summary">
        {INCIDENT_CATEGORY_ORDER.map((category) => {
          const meta = INCIDENT_CATEGORY_META[category];
          return (
            <article className={`bucket ${meta.tone}`} key={category}>
              <h3>{meta.label}</h3>
              <div className="count">{incidentCounts[category]}</div>
              <p>{meta.description}</p>
              <div className="actionrow">
                <Link className="action" to={`/incidents?category=${category}`}>
                  詳細を見る
                  <span className="external-mark" aria-hidden="true">
                    →
                  </span>
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {attentionIncidents.length > 0 && (
        <>
          <SectionTitle title="要注視の不具合" description="今日、能動的に確認する案件" />
          <div className="grid-3">
            {attentionIncidents.map((incident) => (
              <NewsCard
                key={incident.id}
                item={incident}
                settings={settings}
                now={now}
                compact
                extraDetails={[
                  { label: '主体', value: incident.entityName },
                  { label: '系統', value: INCIDENT_CATEGORY_META[incident.incidentCategory].short },
                ]}
              />
            ))}
          </div>
        </>
      )}

      {reference.length > 0 && (
        <>
          <SectionTitle
            title={`参考情報（${reference.length}件）`}
            description="官公庁・自治体の一次情報のうち、不具合・炎上ではないもの。押さえておくと役に立つ動き。"
          />
          <ReferenceTiles items={reference} />
        </>
      )}

      <SectionTitle title="世論・SNSの論点" description="代表性のある世論調査とは分離" />
      <div className="grid-2">
        <div className="panel">
          {dataset.pulses.length === 0 ? (
            <EmptyState>直近で目立つ論点は検知していません。</EmptyState>
          ) : (
            <ul className="pulse">
              {dataset.pulses.map((pulse) => (
                <li className="pulse-item" key={pulse.id}>
                  <b>{pulse.title}</b>
                  <p>{pulse.description}</p>
                  {pulse.scaleNote && <p className="note">拡散規模：{pulse.scaleNote}</p>}
                  {(pulse.sources?.length ?? 0) > 0 && (
                    <div className="actionrow">
                      {pulse.sources!.map((source, index) => (
                        <ExternalLinkButton key={`${source.url}-${index}`} source={source} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="note">{SNS_DISCLAIMER}</p>
        </div>

        <div className="panel">
          <h3>全国代表性のある新規世論調査</h3>
          {dataset.surveys.length === 0 ? (
            <EmptyState>直近24時間：新規調査を確認できず</EmptyState>
          ) : (
            <ul className="pulse">
              {dataset.surveys.map((survey) => (
                <li className="pulse-item" key={survey.id}>
                  <b>{survey.title}</b>
                  <p>{survey.summary}</p>
                  <p className="note">
                    {survey.organization}／{survey.method}／有効回答 {survey.sampleSize}／
                    {survey.fieldworkPeriod}
                  </p>
                  <p className="note">設問文：「{survey.questionText}」</p>
                  <div className="actionrow">
                    {survey.sources.map((source, index) => (
                      <ExternalLinkButton key={`${source.url}-${index}`} source={source} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="note">新規調査時は調査主体、標本数、調査方法、設問文を併記します。</p>
        </div>
      </div>

      <SectionTitle title="広報・広告ウォッチ" description="ダッシュボードは現在動いている案件だけ" />
      {prItems.length === 0 ? (
        <EmptyState>
          ダッシュボード掲載中の広報案件はありません。<Link to="/pr">広報・広告ウォッチ</Link>で3分類の全件を確認できます。
        </EmptyState>
      ) : (
        <div className="grid-3">
          {prItems.map((item) => (
            <div className="card" key={item.id}>
              <PRItemCard item={item} settings={settings} now={now} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
