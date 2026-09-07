import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { MonitoringDataset } from '@/types/monitoring';
import type { NormalizeIssue } from '@/data/normalize';
import { loadCurrentDataset } from '@/data/loadMonitoringData';
import { Layout } from '@/components/layout/Layout';
import { DataStatusBanners } from '@/components/common/DataStatusBanners';
import { ToastProvider } from '@/components/common/Toast';
import { DashboardPage } from '@/routes/DashboardPage';
import { NewsPage } from '@/routes/NewsPage';
import { IncidentsPage } from '@/routes/IncidentsPage';
import { PRPage } from '@/routes/PRPage';
import { CollectedPage } from '@/routes/CollectedPage';
import { ArchivePage } from '@/routes/ArchivePage';
import { NotFoundPage } from '@/routes/NotFoundPage';
import type { ViewKey } from '@/lib/teamsSummary';

interface AppProps {
  /** Injected by tests to avoid a network round-trip and to freeze the clock. */
  initialDataset?: MonitoringDataset;
  initialIssues?: NormalizeIssue[];
  now?: Date;
}

const VIEW_BY_PATH: Record<string, ViewKey> = {
  '/': 'dashboard',
  '/news': 'news',
  '/incidents': 'incidents',
  '/pr': 'pr',
  '/archive': 'archive',
};

export function App({ initialDataset, initialIssues = [], now: fixedNow }: AppProps) {
  const [dataset, setDataset] = useState<MonitoringDataset | null>(initialDataset ?? null);
  const [issues, setIssues] = useState<NormalizeIssue[]>(initialIssues);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const location = useLocation();

  useEffect(() => {
    if (initialDataset) return;
    let cancelled = false;
    loadCurrentDataset().then((result) => {
      if (cancelled) return;
      setDataset(result.dataset);
      setIssues(result.issues);
      setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [initialDataset]);

  // `now` is fixed per mount so the N-day rule cannot flip mid-render.
  const now = useMemo(() => fixedNow ?? new Date(), [fixedNow]);
  const view = VIEW_BY_PATH[location.pathname] ?? 'dashboard';

  useEffect(() => {
    const titles: Record<ViewKey, string> = {
      dashboard: 'ダッシュボード',
      news: 'トップニュース・世論',
      incidents: '不具合・エラー詳細',
      pr: '広報・広告ウォッチ',
      archive: 'アーカイブ',
    };
    document.title = `${titles[view]}｜行政・マイナ関連 モニタリングポータル`;
  }, [view]);

  if (!dataset) {
    return (
      <ToastProvider>
        <p className="loading" role="status">
          データを読み込んでいます…
        </p>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <Layout dataset={dataset} now={now} view={view} query={query} onQueryChange={setQuery}>
        <DataStatusBanners dataset={dataset} issues={issues} loadError={loadError} />
        <Routes>
          <Route path="/" element={<DashboardPage dataset={dataset} now={now} query={query} />} />
          <Route path="/news" element={<NewsPage dataset={dataset} now={now} query={query} />} />
          <Route path="/incidents" element={<IncidentsPage dataset={dataset} now={now} query={query} />} />
          <Route path="/pr" element={<PRPage dataset={dataset} now={now} query={query} />} />
          <Route path="/collected" element={<CollectedPage dataset={dataset} query={query} />} />
          <Route path="/archive" element={<ArchivePage dataset={dataset} now={now} query={query} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
