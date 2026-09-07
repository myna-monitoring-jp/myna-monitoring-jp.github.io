// @vitest-environment node
// 子プロセスと HTTP サーバを扱うため jsdom ではなく node 環境で実行する。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 日次自動更新パイプライン (`scripts/update-data.mjs`) のテスト。
 *
 * 収集元はローカルのHTTPサーバでモックし、外部ネットワークには出ない。
 * スクリプトを実際に実行して出力JSONを検証する。
 */

let server: Server;
let feedUrl: string;
let feedPayload: unknown;
let workDir: string;

const CURATED = {
  settings: {
    dashboardQuietDays: 7,
    newItemHours: 48,
    timezone: 'Asia/Tokyo',
    organizationLabel: 'テスト',
  },
  headline: { title: 'テスト', description: 'テスト' },
  news: [
    {
      id: 'curated-news',
      title: '人が書いたニュース',
      status: 'attention',
      severity: 'high',
      lastMaterialUpdateAt: '2026-08-20T10:00:00+09:00',
      summary: '人の判断が入った要約。',
      matchKeywords: ['公金受取口座'],
      factChecks: [{ claim: '誤解の例', assessment: 'misunderstanding', explanation: '説明。' }],
      sources: [
        {
          type: 'primary',
          label: '既存の出典',
          url: 'https://example.com/original',
          publisher: '政府広報',
          active: true,
        },
      ],
    },
  ],
  incidents: [
    {
      id: 'curated-incident',
      title: '人が検証した不具合',
      incidentCategory: 'local_government_insurer',
      entityName: 'テスト市',
      status: 'resolved',
      severity: 'high',
      lastMaterialUpdateAt: '2026-08-20T10:00:00+09:00',
      summary: '検証済み。',
      sources: [{ type: 'primary', label: '市公式', url: 'https://example.com/city', active: true }],
    },
  ],
  prItems: [
    {
      id: 'curated-pr',
      title: '人が検証した広報',
      ministry: '省庁',
      campaignName: 'キャンペーン',
      prClassification: 'active_stable',
      stableSubtype: 'positive',
      status: 'attention',
      severity: 'low',
      lastMaterialUpdateAt: '2026-08-20T10:00:00+09:00',
      summary: '検証済み。',
      sources: [{ type: 'primary', label: '公式', url: 'https://example.com/pr', active: true }],
    },
  ],
  surveys: [],
  pulses: [],
  timeline: [],
  corrections: [],
};

function article(overrides: Record<string, unknown> = {}) {
  return {
    title: '新しい記事のタイトル - どこかの媒体',
    link: 'https://example.com/news/1',
    _resolved_url: 'https://example.com/news/1',
    pub_date: new Date().toISOString(),
    source: 'テスト媒体',
    description: '記事の概要。',
    category: '一般',
    topic: 'mynumber',
    ...overrides,
  };
}

const execFileAsync = promisify(execFile);

/**
 * スクリプトを子プロセスで実行する。
 *
 * 同期版 (`execFileSync`) は使えない。モックHTTPサーバがこのプロセス内で
 * 動いているため、同期実行でイベントループを止めると応答できずデッドロックする。
 */
async function runPipeline(env: Record<string, string> = {}) {
  let exitCode = 0;
  let stdout = '';
  try {
    const result = await execFileAsync(process.execPath, ['scripts/update-data.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        DATA_DIR: workDir,
        NEWS_FEED_URL: feedUrl,
        // テストは外部ネットワークに出ない。公式情報源の直接収集は無効化する。
        OFFICIAL_SOURCES: '',
        ...env,
      },
    });
    stdout = result.stdout;
  } catch (error) {
    const err = error as { code?: number; stdout?: string };
    exitCode = typeof err.code === 'number' ? err.code : 1;
    stdout = err.stdout ?? '';
  }

  const currentPath = join(workDir, 'current.json');
  return {
    exitCode,
    stdout,
    dataset: existsSync(currentPath)
      ? JSON.parse(readFileSync(currentPath, 'utf8'))
      : null,
  };
}

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'myna-pipeline-'));
  mkdirSync(join(workDir, 'archive'), { recursive: true });
  writeFileSync(join(workDir, 'curated.json'), JSON.stringify(CURATED), 'utf8');

  feedPayload = { updated: new Date().toISOString(), total: 1, articles: [article()] };

  server = createServer((_req, res) => {
    // keep-alive を無効にして、テスト終了時にサーバが確実に閉じるようにする
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    res.end(JSON.stringify(feedPayload));
  });
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  feedUrl = `http://127.0.0.1:${port}/news_latest.json`;
});

afterEach(async () => {
  // fetch が keep-alive 接続を残すため、明示的に切らないと close() が返らない。
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workDir, { recursive: true, force: true });
});

describe('日次自動更新パイプライン', () => {
  it('curated の内容を保持したまま新着記事を追加する', async () => {
    const { dataset } = await runPipeline();

    const curatedNews = dataset.news.find((n: { id: string }) => n.id === 'curated-news');
    expect(curatedNews.summary).toBe('人の判断が入った要約。');
    expect(curatedNews.factChecks).toHaveLength(1);
    expect(curatedNews.reviewState).toBe('reviewed');

    const auto = dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toHaveLength(1);
    expect(auto[0].title).toBe('新しい記事のタイトル');
  });

  it('curated.json を書き換えない', async () => {
    const before = readFileSync(join(workDir, 'curated.json'), 'utf8');
    await runPipeline();
    expect(readFileSync(join(workDir, 'curated.json'), 'utf8')).toBe(before);
  });

  it('自動項目は不具合・広報レーンに入れない（誤掲載を防ぐ）', async () => {
    feedPayload = {
      articles: [
        article({
          title: '○○市で資格が無効と誤表示 システム障害 - 報道',
          _resolved_url: 'https://example.com/news/incident',
          description: '国民健康保険の資格が誤表示された。漏えいの可能性。',
        }),
        article({
          title: '厚労省が新しい広報キャンペーンのポスターを公開 - 報道',
          _resolved_url: 'https://example.com/news/pr',
          description: 'タイアップ広告を開始。',
        }),
      ],
    };

    const { dataset } = await runPipeline();

    expect(dataset.incidents.filter((i: { reviewState: string }) => i.reviewState === 'unreviewed')).toHaveLength(0);
    expect(dataset.prItems.filter((i: { reviewState: string }) => i.reviewState === 'unreviewed')).toHaveLength(0);

    const auto = dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toHaveLength(2);
    expect(auto[0].tags).toContain('不具合候補（自治体・保険者）');
    expect(auto[1].tags).toContain('広報候補');
  });

  it('解説記事には候補タグを付けない', async () => {
    feedPayload = {
      articles: [
        article({
          title: '【後期高齢者】「資格確認書」の交付ルールはどう違う? - 解説媒体',
          _resolved_url: 'https://example.com/news/explainer',
          description: '国保・後期高齢者の資格確認書について解説します。',
        }),
      ],
    };

    const { dataset } = await runPipeline();
    const auto = dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto.tags).toEqual(['自動収集']);
  });

  it('自動項目の状態は「新着」、重要度は最大でも「中」', async () => {
    feedPayload = {
      articles: [
        article({
          title: '全国で重大な漏えい 謝罪と回収 - 報道',
          _resolved_url: 'https://example.com/news/severe',
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto.status).toBe('new');
    expect(auto.severity).toBe('medium');
  });

  it('matchKeywords に一致した記事を出典に追記し、独立媒体なら重要更新にする', async () => {
    feedPayload = {
      articles: [
        article({
          title: '公金受取口座の広告に批判 - 別の媒体',
          _resolved_url: 'https://example.com/news/coverage',
          source: '別の媒体',
          description: '公金受取口座について報じた。',
        }),
      ],
    };

    const { dataset } = await runPipeline();
    const curatedNews = dataset.news.find((n: { id: string }) => n.id === 'curated-news');

    expect(curatedNews.sources).toHaveLength(2);
    expect(curatedNews.sources[1].url).toBe('https://example.com/news/coverage');
    // 既存出典に無い媒体なので lastMaterialUpdateAt が進む
    expect(curatedNews.lastMaterialUpdateAt).not.toBe('2026-08-20T10:00:00+09:00');
    expect(curatedNews.dailyDiff).toContain('追加報道');
  });

  it('同じ媒体の記事が増えても lastMaterialUpdateAt は進めない', async () => {
    feedPayload = {
      articles: [
        article({
          title: '公金受取口座の続報 - 政府広報',
          _resolved_url: 'https://example.com/news/same-outlet',
          source: '政府広報',
          description: '公金受取口座の話。',
        }),
      ],
    };

    const { dataset } = await runPipeline();
    const curatedNews = dataset.news.find((n: { id: string }) => n.id === 'curated-news');
    expect(curatedNews.sources).toHaveLength(2);
    expect(curatedNews.lastMaterialUpdateAt).toBe('2026-08-20T10:00:00+09:00');
  });

  it('同じ記事を2回実行しても重複追加しない', async () => {
    const first = (await runPipeline()).dataset;
    const second = (await runPipeline()).dataset;
    expect(second.news.length).toBe(first.news.length);
  });

  it('古い記事は追加しない', async () => {
    feedPayload = {
      articles: [
        article({
          title: '10日前の記事 - 媒体',
          _resolved_url: 'https://example.com/news/old',
          pub_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ],
    };
    const { dataset } = await runPipeline();
    expect(dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed')).toHaveLength(0);
  });

  it('収集器が期間を判定済みの記事は3日を超えていても追加する（自治体の周知は索引が遅い）', async () => {
    feedPayload = {
      articles: [
        article({
          title: '資格確認書の交付についてのお知らせ - 〇〇市',
          _resolved_url: 'https://www.city.example.lg.jp/kokuho/shikaku.html',
          pub_date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
          _ageChecked: true,
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const added = [...dataset.news].filter((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(added).toHaveLength(1);
    expect(added[0].title).toContain('資格確認書の交付');
  });

  it('追加件数の上限を守る', async () => {
    feedPayload = {
      articles: Array.from({ length: 30 }, (_, index) =>
        article({
          title: `記事${index} - 媒体`,
          _resolved_url: `https://example.com/news/bulk-${index}`,
        }),
      ),
    };
    const { dataset } = await runPipeline({ MAX_AUTO_ITEMS: '3' });
    expect(dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed')).toHaveLength(3);
  });

  it('収集元が落ちていても current.json を生成し、更新失敗として記録する', async () => {
    const { exitCode, dataset } = await runPipeline({
      NEWS_FEED_URL: 'http://127.0.0.1:1/none.json',
    });

    // 収集失敗は終了コード1（サイトは生成するが失敗をログに残す）
    expect(exitCode).toBe(1);
    expect(dataset).not.toBeNull();
    expect(dataset.dataUpdate.state).toBe('failed');
    expect(dataset.dataUpdate.message).toContain('取得できませんでした');
    // 収集に失敗しても curated の内容は残る（画面が空にならない）
    expect(dataset.news.length).toBeGreaterThan(0);
    expect(dataset.incidents.length).toBeGreaterThan(0);
  });

  it('前日分をアーカイブへ退避し、archive[] に載せる', async () => {
    const yesterday = { ...CURATED, dataset: 'live', generatedAt: '2026-08-31T07:00:00+09:00', reportDate: '2026-08-31' };
    writeFileSync(join(workDir, 'current.json'), JSON.stringify(yesterday), 'utf8');

    const { dataset } = await runPipeline();

    expect(existsSync(join(workDir, 'archive', '2026-08-31.json'))).toBe(true);
    expect(dataset.archive.some((a: { date: string }) => a.date === '2026-08-31')).toBe(true);
  });

  it('curated.json に同じ id で書き起こすと未レビュー版が消える（昇格）', async () => {
    // 1回目：自動収集で未レビュー項目ができる
    const first = await runPipeline();
    const auto = first.dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toBeDefined();

    // その id で curated.json に書き起こす
    const curated = JSON.parse(readFileSync(join(workDir, 'curated.json'), 'utf8'));
    curated.news.push({
      id: auto.id,
      title: '人が判断を書いた版',
      status: 'attention',
      severity: 'high',
      lastMaterialUpdateAt: new Date().toISOString(),
      summary: '検証済み。',
      sources: [{ type: 'primary', label: '公式', url: 'https://example.com/verified', active: true }],
    });
    writeFileSync(join(workDir, 'curated.json'), JSON.stringify(curated), 'utf8');

    const second = await runPipeline();
    const same = second.dataset.news.filter((n: { id: string }) => n.id === auto.id);
    expect(same).toHaveLength(1);
    expect(same[0].reviewState).toBe('reviewed');
    expect(same[0].title).toBe('人が判断を書いた版');
  });

  it('dismissedIds に入れた項目は表示されず、再収集でも復活しない', async () => {
    const first = await runPipeline();
    const auto = first.dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');

    const curated = JSON.parse(readFileSync(join(workDir, 'curated.json'), 'utf8'));
    curated.dismissedIds = [auto.id];
    writeFileSync(join(workDir, 'curated.json'), JSON.stringify(curated), 'utf8');

    const second = await runPipeline();
    expect(second.dataset.news.some((n: { id: string }) => n.id === auto.id)).toBe(false);

    // 同じ記事が収集元に残っていても再追加しない
    const third = await runPipeline();
    expect(third.dataset.news.some((n: { id: string }) => n.id === auto.id)).toBe(false);
  });

  it('未レビューのまま保持期間を過ぎた項目は落とす', async () => {
    const first = await runPipeline();
    const auto = first.dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toBeDefined();

    // 保持期間を0日にすると、次回実行で落ちる
    // （収集元からも消えた状態にして、再追加ではなく引き継ぎ判定を見る）
    feedPayload = { articles: [] };
    const second = await runPipeline({ AUTO_ITEM_RETENTION_DAYS: '0' });
    expect(second.dataset.news.some((n: { id: string }) => n.id === auto.id)).toBe(false);
    // curated 由来の項目は落ちない
    expect(second.dataset.news.some((n: { id: string }) => n.id === 'curated-news')).toBe(true);
  });

  it('保持期間内なら未レビューのまま引き継ぐ', async () => {
    const first = await runPipeline();
    const auto = first.dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');

    feedPayload = { articles: [] };
    const second = await runPipeline({ AUTO_ITEM_RETENTION_DAYS: '14' });
    expect(second.dataset.news.some((n: { id: string }) => n.id === auto.id)).toBe(true);
  });

  it('dataset は live、reportDate は当日になる', async () => {
    const { dataset } = await runPipeline();
    expect(dataset.dataset).toBe('live');
    expect(dataset.reportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataset.dataUpdate.state).toBe('ok');
  });

  it('公式ソース（go.jp / lg.jp / 省庁名）で監視対象外なら参考情報にする', async () => {
    feedPayload = {
      articles: [
        article({
          title: 'デジタル庁設立5年 その歩み - デジタル庁',
          _resolved_url: 'https://www.digital.go.jp/news/anniversary',
          source: 'デジタル庁',
        }),
        article({
          title: 'ミートアップを開催しました - 佐野市',
          _resolved_url: 'https://www.city.sano.lg.jp/news/1.html',
          source: '佐野市',
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toHaveLength(2);
    expect(auto.every((n: { category: string }) => n.category === 'reference')).toBe(true);
    // 参考情報に論調は付けない
    expect(auto.every((n: { polarity?: string }) => n.polarity === undefined)).toBe(true);
  });

  it('政府広報の掲載物は媒体名から広報候補と判定し、参考情報に埋もれさせない', async () => {
    feedPayload = {
      articles: [
        article({
          // 表題に「広報」「広告」の語が無い。媒体名を見ないと拾えない
          title: 'マイナ救急（令和8年（2026年）9月掲載） - 政府広報オンライン',
          _resolved_url: 'https://news.google.com/rss/articles/CBMiZ2Fk',
          source: '政府広報オンライン',
          _ageChecked: true,
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toHaveLength(1);
    expect(auto[0].tags).toContain('広報候補');
    // 官公庁ドメインだが、候補タグが付くので参考情報ではなく本文の一覧に残る
    expect(auto[0].category).toBe('other');
    // 自動では広報レーンに入れない（判断は人が curated.json で行う）
    expect(dataset.prItems.some((p: { title: string }) => p.title.includes('マイナ救急'))).toBe(false);
  });

  it('Google News 経由でも自治体の周知は参考情報にする（lg.jp を持たない自治体を含む）', async () => {
    feedPayload = {
      articles: [
        article({
          // リンクは Google News のリダイレクト。ホスト名では公式と判定できない
          title: 'マイナンバーカード・電子証明書の有効期限通知書について - city.tokorozawa.saitama.jp',
          _resolved_url: 'https://news.google.com/rss/articles/CBMiaAFo',
          source: 'city.tokorozawa.saitama.jp',
          _ageChecked: true,
        }),
        article({
          title: 'マイナンバーカードセンター予約ページ - city.kakogawa.lg.jp',
          _resolved_url: 'https://news.google.com/rss/articles/CBMiaAFq',
          source: 'city.kakogawa.lg.jp',
          _ageChecked: true,
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.filter((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto).toHaveLength(2);
    expect(auto.map((n: { category: string }) => n.category)).toEqual(['reference', 'reference']);
  });

  it('二次転載・解説記事は解説記事欄（commentary）へ回す', async () => {
    feedPayload = {
      articles: [
        article({
          title: 'マイナ保険証の使い方をやさしく解説 - どこかの経済メディア',
          _resolved_url: 'https://example.com/media/explainer',
          source: 'どこかの経済メディア',
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto.category).toBe('commentary');
  });

  it('論調を自動判定する（ネガティブ／ポジティブ／中立）', async () => {
    feedPayload = {
      articles: [
        article({
          title: 'マイナポータル連携は絶対やめた方がいい - FP系メディア',
          _resolved_url: 'https://example.com/media/neg',
          source: 'FP系メディア',
          description: 'デメリットが大きい。',
        }),
        article({
          title: 'マイナ保険証はこんなに便利 メリットまとめ - 生活メディア',
          _resolved_url: 'https://example.com/media/pos',
          source: '生活メディア',
          description: 'おすすめの活用法。',
        }),
        article({
          title: '資格確認書の交付ルールを整理 - 解説メディア',
          _resolved_url: 'https://example.com/media/neu',
          source: '解説メディア',
          description: '制度の内容を説明します。',
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const byUrl = (u: string) =>
      dataset.news.find((n: { sources: { url: string }[] }) => n.sources[0].url === u);

    expect(byUrl('https://example.com/media/neg').polarity).toBe('negative');
    expect(byUrl('https://example.com/media/pos').polarity).toBe('positive');
    expect(byUrl('https://example.com/media/neu').polarity).toBe('neutral');
  });

  it('「廃止」など制度上の事実語だけではネガティブ判定にしない', async () => {
    feedPayload = {
      articles: [
        article({
          title: '紙の保険証廃止後はどう受診する? - 解説メディア',
          _resolved_url: 'https://example.com/media/abolish',
          source: '解説メディア',
          description: '資格確認書の交付ルールを説明します。',
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto.polarity).toBe('neutral');
  });

  it('引き継いだ項目にも分類ルールを再適用する', async () => {
    feedPayload = {
      articles: [
        article({
          title: 'マイナ保険証の使い方を解説 - 一般メディア',
          _resolved_url: 'https://example.com/media/carry',
          source: '一般メディア',
        }),
      ],
    };
    const first = await runPipeline();
    const id = first.dataset.news.find(
      (n: { reviewState: string }) => n.reviewState === 'unreviewed',
    ).id;
    expect(first.dataset.news.find((n: { id: string }) => n.id === id).category).toBe('commentary');

    // 収集元が空になっても、引き継ぎ時に再分類されて commentary のまま
    feedPayload = { articles: [] };
    const second = await runPipeline();
    expect(second.dataset.news.find((n: { id: string }) => n.id === id).category).toBe('commentary');
  });

  it('不具合候補タグが付く記事は解説記事欄に落とさない', async () => {
    feedPayload = {
      articles: [
        article({
          title: '○○市で資格が無効と誤表示 - 地方紙',
          _resolved_url: 'https://example.com/media/incident',
          source: '地方紙',
          description: '国民健康保険の資格が誤表示された。',
        }),
      ],
    };
    const { dataset } = await runPipeline();
    const auto = dataset.news.find((n: { reviewState: string }) => n.reviewState === 'unreviewed');
    expect(auto.category).not.toBe('commentary');
    expect(auto.tags).toContain('不具合候補（自治体・保険者）');
  });
});
