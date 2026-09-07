import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Briefing } from '@/types/monitoring';
import { MorningBriefing } from '@/components/briefing/MorningBriefing';
import { normalizeDataset } from '@/data/normalize';

/**
 * 朝の状況判断の表示のテスト。
 *
 * ここで守らせたいこと：
 *  - 「確認できなかったこと」が画面に出る（無かったことの記録）
 *  - 前日差分に「継続」「WATCH」を使わない
 *  - 出典がリンク契約（target/rel/実href）を満たす
 *  - 生成物であることが画面に明示される
 *  - 節が欠けた生成物は表示せず、前日分で埋めない
 */

const BRIEFING: Briefing = {
  confirmedAt: '2026-09-07T00:51:00.000Z',
  windowFrom: '2026-09-06T00:51:00.000Z',
  windowTo: '2026-09-07T00:51:00.000Z',
  generatedBy: 'gpt-6-astra',
  metrics: [
    { label: '今朝のニュース規模', value: '中' },
    { label: '新規全国オン資障害', value: '確認なし' },
    { label: '新規広報', value: 'マイナ救急', alert: true },
  ],
  overview: ['新たな全国規模の重大障害は確認できませんでした。', 'マイナ救急の新聞広告が開始しました。'],
  highlights: ['NEW：マイナ救急新聞広告', '全国オン資：新規重大障害なし'],
  judgments: [
    { area: '医療・システム', text: '公式ページは「正常に稼働」と表示。' },
    { area: '広報', text: '広告を起点とする有意な批判集中は確認できません。' },
  ],
  diffs: [
    { change: 'new', theme: 'マイナ救急広報', update: '9/7に新聞広告を公開。', judgment: '反応集積前。' },
    {
      change: 'increased',
      theme: 'マイナアプリ',
      update: '2.3/5・509件。前日466件から43件増。',
      judgment: '評価値は横ばい。増加理由は断定しない。',
    },
    { change: 'flat', theme: '公金受取口座広告', update: '新規の大規模炎上を確認できず。', judgment: '既存批判と分離。' },
    { change: 'scheduled_end', theme: '旅券オンライン申請', update: '予定終了時刻を経過。', judgment: '延長告知なし。' },
  ],
  watchlist: [
    { theme: 'マイナ救急広告', detail: '掲載後のX転載と引用反応。' },
    { theme: '旅券オンライン申請', detail: '再開直後のアクセス集中。' },
  ],
  caveats: ['SNS・App Storeレビューは全国世論を代表しません。'],
  sources: [
    {
      type: 'primary',
      label: 'マイナポータルAPI 稼働状況',
      url: 'https://developers.digital.go.jp/documents/mynaportal-api/maintenance/',
      linkText: '一次情報を開く',
      publisher: 'デジタル庁',
      active: true,
    },
  ],
  newsItems: [
    {
      id: 'briefing-news-1',
      headline: '健保の特定保健指導データが外部生成AIへ誤アップロード―事案全体の対象人数はなお未公表',
      severity: 'high',
      tone: 'negative',
      topicTags: ['要配慮個人情報', '委託先管理'],
      body: ['対象者は210名と公表されていますが、事案全体の対象人数は明らかになっていません。'],
      facts: [
        { label: '健保組合分', value: '210名' },
        { label: '事案全体', value: '総数未公表' },
      ],
      publicVoice: 'セキュリティ専門媒体では委託先管理が論点。業界上の問題提起であり全国世論とは区別します。',
      voiceObserved: true,
      claims: [
        { claim: '210名が事案全体の人数である', assessment: 'misunderstanding', note: '健保組合分のみです。' },
        { claim: 'AIモデルの学習に利用された', assessment: 'unconfirmed', note: '第三者による確認はありません。' },
      ],
      sources: [
        {
          type: 'primary',
          label: '事案に関する公表',
          url: 'https://www.ppc.go.jp/',
          linkText: '一次情報を開く',
          publisher: '個人情報保護委員会',
          active: true,
        },
      ],
    },
    {
      id: 'briefing-news-2',
      headline: '政府広報「マイナ救急」新聞広告を開始―朝日・読売から全国紙へ展開',
      severity: 'high',
      tone: 'positive',
      topicTags: ['新規広報'],
      body: ['政府広報・消防庁は9月7日、救急時の情報伝達を主題とする新聞広告を開始しました。'],
      facts: [{ label: '9/7', value: '朝日・読売' }],
      publicVoice: '',
      voiceObserved: false,
      claims: [
        {
          claim: 'マイナ保険証がなければ救急搬送されない',
          assessment: 'misunderstanding',
          note: 'カード不所持を理由に搬送を拒むものではありません。',
        },
      ],
      sources: [
        {
          type: 'primary',
          label: 'マイナ救急 新聞広告',
          url: 'https://www.gov-online.go.jp/',
          linkText: '一次情報を開く',
          publisher: '政府広報オンライン',
          active: true,
        },
      ],
    },
  ],
  prItems: [
    {
      id: 'briefing-pr-1',
      headline: 'マイナ救急新聞広告｜新規掲載・反応観測中',
      heatLevel: 'low',
      badges: ['掲載初日'],
      origin: '政府広報・消防庁の新聞突出し広告。',
      intent: '救急時の情報把握に役立てることと、日常的な携行を促す。',
      observedCriticism: '広告を起点とする有意な批判集中は確認できません。',
      potentialIssues: 'カード不所持者への扱い／常時携行への抵抗。現時点では広報上の確認ポイントです。',
      separation: 'カードがなくても救急搬送は行われます。',
      officialNote: '政府広報の解説ページに実施範囲を掲載。',
      secondarySpread: '主要報道の炎上記事化は未確認。',
      communicationNote: '強い表現と、カード不所持時も救急対応される事実を両立して伝える必要があります。',
      sources: [],
    },
  ],
  sentimentRows: [
    {
      channel: 'X / Yahoo!コメント',
      situation: '掲載初日で反応集積前。',
      reading: '非代表サンプルです。全国世論へ一般化しません。',
    },
  ],
};

describe('朝の状況判断の表示', () => {
  it('確認時点と主対象期間を出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    expect(screen.getByTestId('briefing').textContent).toContain('確認');
    expect(screen.getByTestId('briefing').textContent).toContain('主対象');
  });

  it('「確認なし」の指標も画面に出す（無かったことの記録）', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const metrics = screen.getAllByTestId('briefing-metric').map((el) => el.textContent);
    expect(metrics.some((text) => text?.includes('新規全国オン資障害') && text?.includes('確認なし'))).toBe(true);
  });

  it('注意を引く指標は色だけでなく記号でも示す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const alert = screen
      .getAllByTestId('briefing-metric')
      .find((el) => el.textContent?.includes('マイナ救急'));
    expect(alert?.className).toContain('briefing-metric-alert');
    expect(alert?.textContent).toContain('▲');
  });

  it('総括と要点チップを出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    expect(screen.getByText('今朝の総括')).toBeInTheDocument();
    expect(screen.getByTestId('briefing-highlights').textContent).toContain('NEW：マイナ救急新聞広告');
  });

  it('今朝の判断を領域ごとに出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const judgments = screen.getAllByTestId('briefing-judgment');
    expect(judgments).toHaveLength(2);
    expect(judgments[0].textContent).toContain('医療・システム');
  });

  it('前日差分を表で出し、更新内容と判断を分けて示す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const rows = screen.getAllByTestId('briefing-diff');
    expect(rows).toHaveLength(4);
    const increased = rows.find((row) => row.textContent?.includes('マイナアプリ'));
    expect(increased?.textContent).toContain('466件');
    expect(increased?.textContent).toContain('断定しない');
  });

  it('差分ラベルに「継続」「WATCH」を使わない', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const labels = Array.from(document.querySelectorAll('.briefing-change')).map((el) => el.textContent ?? '');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/WATCH/i);
      expect(label).not.toContain('継続');
    }
    expect(labels.join(' ')).toContain('横ばい');
  });

  it('差分ラベルは色だけでなく記号でも区別する', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const symbols = Array.from(document.querySelectorAll('.briefing-change span[aria-hidden="true"]')).map(
      (el) => el.textContent,
    );
    expect(symbols).toEqual(['＋', '↑', '＝', '■']);
  });

  it('優先ウォッチを順位付きで出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const items = screen.getAllByTestId('briefing-watch');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('1');
    expect(items[0].textContent).toContain('マイナ救急広告');
  });

  it('出典はリンク契約を満たす（実href・別タブ・rel）', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const links = screen.getByTestId('briefing-sources').querySelectorAll('a');
    expect(links).toHaveLength(1);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https?:\/\//);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.textContent).toContain('を開く');
    }
  });

  it('読み方の注意（代表性の留保）を必ず出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    expect(screen.getByTestId('briefing-caveats').textContent).toContain('代表しません');
  });

  it('何が生成したかを画面に明示する', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    expect(screen.getByTestId('briefing-provenance').textContent).toContain('gpt-6-astra');
  });

  it('ネガティブ／要注意を先に、ポジティブ／前進を後に並べる', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const headings = Array.from(document.querySelectorAll('.briefing-subhead')).map((el) => el.textContent);
    const negativeAt = headings.findIndex((text) => text?.includes('ネガティブ'));
    const positiveAt = headings.findIndex((text) => text?.includes('ポジティブ'));
    expect(negativeAt).toBeGreaterThanOrEqual(0);
    expect(positiveAt).toBeGreaterThan(negativeAt);
  });

  it('書き起こしの見出しは元記事の表題ではなく、何が分かったかを出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const cards = screen.getAllByTestId('briefing-news');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('事案全体の対象人数はなお未公表');
  });

  it('定量情報に「未公表」も値として出す（無いことの記録）', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const facts = screen.getAllByTestId('briefing-news-facts')[0];
    expect(facts.textContent).toContain('事案全体');
    expect(facts.textContent).toContain('総数未公表');
  });

  it('事実関係の切り分けを表で出し、「確認されず」を断定と区別する', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const claims = screen.getAllByTestId('briefing-news-claims')[0];
    expect(claims.textContent).toContain('誤解');
    expect(claims.textContent).toContain('確認されず');
  });

  it('観測された声が無い項目は「確認できませんでした」と出し、無かったと断定しない', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const novoice = screen.getAllByTestId('briefing-news-novoice');
    expect(novoice).toHaveLength(1);
    expect(novoice[0].textContent).toContain('確認できませんでした');
  });

  it('広報案件は8項目で出し、④が国民の声ではないことを明示する', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const pr = screen.getByTestId('briefing-pr');
    for (const marker of ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']) {
      expect(pr.textContent).toContain(marker);
    }
    expect(pr.textContent).toContain('広報上の確認ポイント');
    expect(screen.getByTestId('briefing-pr-risk-note').textContent).toContain('観測された声ではなく');
  });

  it('炎上度は批判の存在だけで「大」にしない（低い案件は小と出る）', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    expect(screen.getByTestId('briefing-pr').textContent).toContain('炎上度：小');
  });

  it('世論・反応の傾向を、状況と読み方を分けて出す', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const row = screen.getByTestId('briefing-sentiment-row');
    expect(row.textContent).toContain('反応集積前');
    expect(row.textContent).toContain('一般化しません');
  });

  it('書き起こしの出典もリンク契約を満たす', () => {
    render(<MorningBriefing briefing={BRIEFING} />);
    const links = screen.getAllByTestId('briefing-news')[0].querySelectorAll('a');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https?:\/\//);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('生成できなかった日は、前日分を流用せずその旨を出す', () => {
    render(<MorningBriefing briefing={undefined} />);
    expect(screen.queryByTestId('briefing')).toBeNull();
    const missing = screen.getByTestId('briefing-missing');
    expect(missing.textContent).toContain('生成できませんでした');
    expect(missing.textContent).toContain('流用していません');
  });
});

describe('朝の状況判断の正規化', () => {
  const base = {
    dataset: 'live',
    generatedAt: '2026-09-07T00:51:00.000Z',
    reportDate: '2026-09-07',
    settings: { dashboardQuietDays: 7, newItemHours: 48, timezone: 'Asia/Tokyo' },
    dataUpdate: { state: 'ok' },
    news: [],
    incidents: [],
    prItems: [],
  };

  it('正しいブリーフィングはそのまま読み込む', () => {
    const { dataset } = normalizeDataset({ ...base, briefing: BRIEFING });
    expect(dataset.briefing?.diffs).toHaveLength(4);
    expect(dataset.briefing?.generatedBy).toBe('gpt-6-astra');
  });

  it('列挙外の差分ラベルは落として問題として記録する', () => {
    const { dataset, issues } = normalizeDataset({
      ...base,
      briefing: {
        ...BRIEFING,
        diffs: [...BRIEFING.diffs, { change: '継続', theme: '不正なラベル', update: '', judgment: '' }],
      },
    });
    expect(dataset.briefing?.diffs).toHaveLength(4);
    expect(issues.some((issue) => issue.message.includes('差分ラベルが不正'))).toBe(true);
  });

  it('節が空のブリーフィングは表示しない（空の枠を出さない）', () => {
    const { dataset, issues } = normalizeDataset({ ...base, briefing: { ...BRIEFING, caveats: [] } });
    expect(dataset.briefing).toBeUndefined();
    expect(issues.some((issue) => issue.message.includes('空の節'))).toBe(true);
  });

  it('出典のURLが使えない場合はリンクにしない', () => {
    const { dataset } = normalizeDataset({
      ...base,
      briefing: {
        ...BRIEFING,
        sources: [{ type: 'primary', label: '出典なし', url: 'javascript:void(0)', active: true }],
      },
    });
    expect(dataset.briefing?.sources[0].active).toBe(false);
  });

  it('出典が無い書き起こしは表示しない（裏の取れていないものを出さない）', () => {
    const { dataset, issues } = normalizeDataset({
      ...base,
      briefing: {
        ...BRIEFING,
        newsItems: [{ ...BRIEFING.newsItems[0], sources: [] }],
      },
    });
    expect(dataset.briefing?.newsItems).toHaveLength(0);
    expect(issues.some((issue) => issue.message.includes('有効な出典'))).toBe(true);
  });

  it('本文が空の書き起こしは表示しない', () => {
    const { dataset } = normalizeDataset({
      ...base,
      briefing: { ...BRIEFING, newsItems: [{ ...BRIEFING.newsItems[0], body: [] }] },
    });
    expect(dataset.briefing?.newsItems).toHaveLength(0);
  });

  it('声の文章が空なら観測済みとは扱わない', () => {
    const { dataset } = normalizeDataset({
      ...base,
      briefing: {
        ...BRIEFING,
        newsItems: [{ ...BRIEFING.newsItems[0], publicVoice: '', voiceObserved: true }],
      },
    });
    expect(dataset.briefing?.newsItems[0].voiceObserved).toBe(false);
  });

  it('列挙外の判定は落とす', () => {
    const { dataset } = normalizeDataset({
      ...base,
      briefing: {
        ...BRIEFING,
        newsItems: [
          {
            ...BRIEFING.newsItems[0],
            claims: [
              { claim: '正しい', assessment: 'fact', note: '' },
              { claim: '不正なラベル', assessment: 'たぶん本当', note: '' },
            ],
          },
        ],
      },
    });
    expect(dataset.briefing?.newsItems[0].claims.map((c) => c.claim)).toEqual(['正しい']);
  });

  it('briefing が無いデータも読み込める（生成前・生成失敗時）', () => {
    const { dataset } = normalizeDataset(base);
    expect(dataset.briefing).toBeUndefined();
    expect(dataset.dataUpdate.state).toBe('ok');
  });
});
