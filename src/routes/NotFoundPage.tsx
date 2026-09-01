import { Link, useLocation } from 'react-router-dom';
import { SectionTitle } from '@/components/common/Primitives';

/** Fallback route. Keeps navigation available instead of showing a blank page. */
export function NotFoundPage() {
  const location = useLocation();
  return (
    <>
      <SectionTitle title="ページが見つかりません" description="URLが変更されたか、リンクが古い可能性があります。" />
      <div className="panel">
        <p className="summary">
          指定されたパス <code>{location.pathname}</code> に対応する画面はありません。
        </p>
        <ul className="tagrow" style={{ gap: 8 }}>
          <li>
            <Link className="action" to="/">
              ダッシュボードへ戻る
            </Link>
          </li>
          <li>
            <Link className="action" to="/archive">
              アーカイブを開く
            </Link>
          </li>
        </ul>
        <p className="note">
          共有されたリンクが開けない場合は、リンクの発行元に最新の共有URLを確認してください。
        </p>
      </div>
    </>
  );
}
