import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { MonitoringDataset } from '@/types/monitoring';
import { ShareActions } from '@/components/common/ShareActions';
import { FeedbackButton } from '@/components/common/FeedbackButton';
import { SITE_TITLE, SNS_DISCLAIMER } from '@/config/appConfig';
import { formatDateTime } from '@/lib/format';
import type { ViewKey } from '@/lib/teamsSummary';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'ダッシュボード', icon: '⌂' },
  { to: '/news', label: 'トップニュース・世論', icon: '◎' },
  { to: '/incidents', label: '不具合・エラー詳細', icon: '⚠' },
  { to: '/pr', label: '広報・広告ウォッチ', icon: '◉' },
  // 材料置き場。報告ではないため本線の後ろに置く。
  { to: '/collected', label: '収集一覧', icon: '≡' },
  { to: '/archive', label: 'アーカイブ', icon: '▤' },
];

interface LayoutProps {
  dataset: MonitoringDataset;
  now: Date;
  view: ViewKey;
  query: string;
  onQueryChange: (value: string) => void;
  children: ReactNode;
}

/** Sidebar + topbar shell, ported from the mock. */
export function Layout({ dataset, now, view, query, onQueryChange, children }: LayoutProps) {
  const quietDays = dataset.settings.dashboardQuietDays;

  return (
    <>
      <a className="skip-link" href="#main-content">
        本文へスキップ
      </a>

      <nav className="mobile-nav" aria-label="画面切り替え（モバイル）">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <small>PUBLIC COMMUNICATION INTELLIGENCE</small>
            <strong>
              行政・マイナ関連
              <br />
              モニタリング
            </strong>
          </div>
          <nav className="nav" aria-label="画面切り替え">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="side-rule">
            <b>ダッシュボード掲載ルール</b>
            <br />
            最後の重要更新から{quietDays}日間、新しい反応・追加報道・公式対応がない案件はダッシュボードから外します。詳細ページとアーカイブには保持します。
          </div>
        </aside>

        <div className="content">
          <header className="topbar">
            <div className="topbar-in">
              <div className="top-title">{SITE_TITLE}</div>
              <div className="search">
                <span aria-hidden="true">⌕</span>
                <label className="visually-hidden" htmlFor="globalSearch">
                  サイト内検索
                </label>
                <input
                  id="globalSearch"
                  type="search"
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="ニュース・自治体・システム・省庁・広報を横断検索"
                />
              </div>
              <ShareActions dataset={dataset} now={now} view={view} />
              <div className="updated">
                最終更新：{formatDateTime(dataset.generatedAt, '未取得')}
              </div>
            </div>
          </header>

          <main className="main" id="main-content">
            {children}
          </main>

          <footer className="footer">
            {SITE_TITLE}｜データ基準 {formatDateTime(dataset.generatedAt, '未取得')}
            <br />
            {SNS_DISCLAIMER}
          </footer>
        </div>
      </div>

      {/* 左下固定。トースト（右下）と重ならない位置に置く。 */}
      <FeedbackButton generatedAt={dataset.generatedAt} />
    </>
  );
}
