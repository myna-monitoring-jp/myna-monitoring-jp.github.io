interface DailyReportLinkProps {
  reportDate: string;
}

/**
 * その日の日別レポートへの導線。
 *
 * レポートは `public/reports/myna_news_YYYY-MM-DD.html` に置かれる単一HTMLで、
 * 調査パイプライン（scripts/run-research.mjs）が生成する。
 * Vite のルーティング外なので、SPA内リンクではなく通常のリンクで開く。
 *
 * 生成に失敗した日はファイルが無く404になる。存在確認をビルド時にはできないため、
 * 押す前に「その日のレポート」であることと、無い場合があることを明示している。
 */
export function DailyReportLink({ reportDate }: DailyReportLinkProps) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;

  /*
   * ベースパスは Vite の `import.meta.env.BASE_URL` を使う。
   * ルート配信なら "/"、プロジェクトページなら "/<repo>/" になる。
   * 絶対パスを書くとサブディレクトリ配信で壊れる。
   */
  const base = import.meta.env.BASE_URL || '/';
  const href = `${base.endsWith('/') ? base : `${base}/`}reports/myna_news_${reportDate}.html`;

  return (
    <section className="reportlink" data-testid="daily-report-link">
      <div>
        <p className="reportlink-title">{reportDate} の日別レポート</p>
        <p className="note">
          各案件を A. ニュース自体／B. 国民の声・現場の声／C. 事実関係・補足／D. 出典・リンク の4ブロックで記載した単一HTMLです。印刷・添付にも使えます。調査が実施されなかった日は開けません。
        </p>
      </div>
      <a className="action source" href={href} target="_blank" rel="noopener noreferrer">
        日別レポートを開く
        <span aria-hidden="true">↗</span>
      </a>
    </section>
  );
}
