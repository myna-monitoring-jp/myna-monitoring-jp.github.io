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
      env: { ...process.env, DATA_DIR: workDir, NEWS_FEED_URL: feedUrl, ...env },
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

  it('dataset は live、reportDate は当日になる', async () => {
    const { dataset } = await runPipeline();
    expect(dataset.dataset).toBe('live');
    expect(dataset.reportDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataset.dataUpdate.state).toBe('ok');
  });
});
