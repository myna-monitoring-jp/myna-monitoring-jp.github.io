import type { Briefing } from '@/types/monitoring';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { BRIEFING_CHANGE_META } from '@/lib/statusLabels';
import { formatDateTime } from '@/lib/format';
import { partitionSources } from '@/lib/links';

interface MorningBriefingProps {
  briefing?: Briefing;
}

/**
 * 朝の状況判断。
 *
 * 機械収集（RSS・稼働状況ページ）では取れない層をここに置く：
 *  - 公式ページを実際に開いて確認した現在の表示
 *  - 前日の数値との差分
 *  - 確認できなかったこと（「新規全国オン資障害：確認なし」）
 *  - 今日の優先ウォッチと、読み方の留保
 *
 * 生成物なので「何が書いたか」を必ず画面に出す。人の判断は curated.json 側にある。
 */
export function MorningBriefing({ briefing }: MorningBriefingProps) {
  if (!briefing) {
    return (
      <section className="briefing briefing-missing" data-testid="briefing-missing">
        <p className="note">
          今朝の状況判断は生成できませんでした。以下の機械収集の結果のみを表示しています。前日の判断は、古い内容を今朝のものとして示すことになるため流用していません。
        </p>
      </section>
    );
  }

  const { linkable } = partitionSources(briefing.sources);

  return (
    <section className="briefing" data-testid="briefing" aria-labelledby="briefing-heading">
      <header className="briefing-head">
        <p className="briefing-kicker">DAILY MONITORING / MY NUMBER &amp; MYNA INSURANCE CARD</p>
        <h2 id="briefing-heading">マイナ関連 朝の動向レポート</h2>
        <p className="briefing-window">
          {formatDateTime(briefing.confirmedAt, '確認時点不明')} 確認｜主対象：
          {formatDateTime(briefing.windowFrom, '不明')} 〜 {formatDateTime(briefing.windowTo, '不明')}
        </p>

        <ul className="briefing-metrics" data-testid="briefing-metrics">
          {briefing.metrics.map((metric) => (
            <li
              className={`briefing-metric${metric.alert ? ' briefing-metric-alert' : ''}`}
              key={metric.label}
              data-testid="briefing-metric"
            >
              <span className="briefing-metric-label">{metric.label}</span>
              <strong className="briefing-metric-value">
                {metric.alert ? <span aria-hidden="true">▲ </span> : null}
                {metric.value}
              </strong>
            </li>
          ))}
        </ul>
      </header>

      <div className="briefing-grid">
        <article className="briefing-card">
          <h3>今朝の総括</h3>
          {briefing.overview.map((paragraph, index) => (
            // 段落の並びは生成順に意味があるため index をキーにする
            <p key={`overview-${index}`}>{paragraph}</p>
          ))}

          {briefing.highlights.length > 0 ? (
            <ul className="briefing-chips" data-testid="briefing-highlights">
              {briefing.highlights.map((chip) => (
                <li className="briefing-chip" key={chip}>
                  {chip}
                </li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="briefing-card briefing-judgments">
          <h3>今朝の判断</h3>
          {briefing.judgments.map((judgment) => (
            <div className="briefing-judgment" key={judgment.area} data-testid="briefing-judgment">
              <p className="briefing-judgment-area">{judgment.area}</p>
              <p className="briefing-judgment-text">{judgment.text}</p>
            </div>
          ))}
        </article>
      </div>

      <h3 className="briefing-subhead">前日からの差分</h3>
      <div className="tablewrap">
        <table className="briefing-diffs" data-testid="briefing-diffs">
          <caption className="visually-hidden">前日から動いた項目と、その読み方</caption>
          <thead>
            <tr>
              <th scope="col">差分</th>
              <th scope="col">テーマ</th>
              <th scope="col">今朝の更新</th>
              <th scope="col">判断</th>
            </tr>
          </thead>
          <tbody>
            {briefing.diffs.map((diff) => {
              const meta = BRIEFING_CHANGE_META[diff.change];
              return (
                <tr key={`${diff.change}-${diff.theme}`} data-testid="briefing-diff">
                  <td>
                    <span className={`briefing-change briefing-change-${meta.tone}`}>
                      <span aria-hidden="true">{meta.symbol}</span>
                      {meta.label}
                    </span>
                  </td>
                  <th scope="row">{diff.theme}</th>
                  <td>{diff.update}</td>
                  <td>{diff.judgment}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="briefing-subhead">今日の優先ウォッチ</h3>
      <ol className="briefing-watchlist" data-testid="briefing-watchlist">
        {briefing.watchlist.map((watch, index) => (
          <li className="briefing-watch" key={watch.theme} data-testid="briefing-watch">
            <p className="briefing-watch-theme">
              <span className="briefing-watch-rank" aria-hidden="true">
                {index + 1}
              </span>
              {watch.theme}
            </p>
            <p className="briefing-watch-detail">{watch.detail}</p>
          </li>
        ))}
      </ol>

      {linkable.length > 0 ? (
        <>
          <h3 className="briefing-subhead">確認した一次情報</h3>
          <ul className="briefing-sources" data-testid="briefing-sources">
            {linkable.map((source) => (
              <li key={source.url}>
                <ExternalLinkButton source={source} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="briefing-caveats" data-testid="briefing-caveats">
        <p className="briefing-caveats-title">読み方の注意</p>
        <ul>
          {briefing.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>

      <p className="note" data-testid="briefing-provenance">
        この節は {briefing.generatedBy} が検索と公式ページの確認を行って生成したものです。人が確認した案件は下の一覧に分けて表示しています。
      </p>
    </section>
  );
}
