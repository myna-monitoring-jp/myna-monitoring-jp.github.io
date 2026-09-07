import type { BriefingNewsItem } from '@/types/monitoring';
import { ExternalLinkButton } from '@/components/common/ExternalLinkButton';
import { FACT_ASSESSMENT_META, SEVERITY_LABEL } from '@/lib/statusLabels';
import { partitionSources } from '@/lib/links';

interface BriefingNewsCardProps {
  item: BriefingNewsItem;
  /** 節の中での通し番号。 */
  index: number;
}

/**
 * 書き起こされたニュース1件。
 *
 * 収集した記事をそのまま並べたカードではない。材料を読んだうえで
 * 載せると決めたものを、要件の必須項目に沿って書き起こしたもの。
 *
 *   A. ニュース自体（本文＋定量情報）
 *   B. 国民の声・現場の声（観測されたものだけ。無ければ確認できずと出す）
 *   C. 事実関係・補足（世間の論点への判定）
 *   D. 出典・リンク（一次情報と報道を区別）
 */
export function BriefingNewsCard({ item, index }: BriefingNewsCardProps) {
  const { linkable, broken } = partitionSources(item.sources);

  return (
    <article className="bnews" data-testid="briefing-news" data-item-id={item.id}>
      <header className="bnews-head">
        <span className="bnews-index" aria-hidden="true">
          {index}
        </span>
        <div>
          <h4>{item.headline}</h4>
          <ul className="bnews-tags">
            <li className={`bnews-sev bnews-sev-${item.severity}`}>重要度：{SEVERITY_LABEL[item.severity]}</li>
            {item.topicTags.map((tag) => (
              <li className="bnews-tag" key={tag}>
                {tag}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <section className="bnews-block">
        <h5>A. ニュース自体</h5>
        {item.body.map((paragraph, i) => (
          // 段落の並びに意味があるため index をキーにする
          <p key={`body-${i}`}>{paragraph}</p>
        ))}

        {item.facts.length > 0 ? (
          <ul className="bnews-facts" data-testid="briefing-news-facts">
            {item.facts.map((fact) => (
              <li key={fact.label}>
                <span className="bnews-fact-label">{fact.label}</span>
                <strong className="bnews-fact-value">{fact.value}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="bnews-block">
        <h5>B. 国民の声・現場の声</h5>
        {item.voiceObserved ? (
          <p data-testid="briefing-news-voice">{item.publicVoice}</p>
        ) : (
          /*
            観測されていない場合は「無かった」と断定せず、確認できなかったと出す。
            予測される批判をここに書かせない（それは広報上のリスク側の扱い）。
          */
          <p className="bnews-novoice" data-testid="briefing-news-novoice">
            {item.publicVoice || '直近24時間で新規の有意な反応は確認できませんでした。'}
          </p>
        )}
      </section>

      {item.claims.length > 0 ? (
        <section className="bnews-block">
          <h5>C. 事実関係・補足</h5>
          <div className="tablewrap">
            <table className="bnews-claims" data-testid="briefing-news-claims">
              <thead>
                <tr>
                  <th scope="col">論点</th>
                  <th scope="col">判定</th>
                  <th scope="col">補足</th>
                </tr>
              </thead>
              <tbody>
                {item.claims.map((claim) => {
                  const meta = FACT_ASSESSMENT_META[claim.assessment];
                  return (
                    <tr key={claim.claim}>
                      <th scope="row">{claim.claim}</th>
                      <td>
                        <span className={`bnews-assess bnews-assess-${meta.tone}`}>{meta.label}</span>
                      </td>
                      <td>{claim.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="bnews-block">
        <h5>D. 出典・リンク</h5>
        <div className="actionrow">
          {linkable.map((source) => (
            <ExternalLinkButton key={source.url} source={source} />
          ))}
        </div>
        {broken.map((source) => (
          <p className="note" key={`${source.label}-${source.url}`}>
            {source.label}：URLが無効なため、リンクではなく注記として表示しています。
          </p>
        ))}
      </section>
    </article>
  );
}
