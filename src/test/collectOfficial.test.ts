// @vitest-environment node
// HTTPサーバとファイルI/Oを扱うため jsdom ではなく node 環境で実行する。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectOfficialSources } from '../../scripts/collect-official.mjs';

/**
 * 公式情報源の直接収集のテスト。
 *
 * 外部ネットワークには出ず、ローカルのHTTPサーバで官公庁ページを模す。
 */

let server: Server;
let base: string;
let routes: Record<string, { body: string; type?: string; status?: number }>;
let workDir: string;

const NOW = new Date('2026-09-03T13:00:00+09:00');

/** 実際のマイナポータルAPI稼働状況ページと同じ構造（タイトルにも「稼働状況」が入る） */
const STATUS_PAGE_HTML = `<!doctype html><html><head>
<title>マイナポータルAPI 稼働状況・メンテナンス情報 | デジタル庁 開発者サイト</title></head><body>
<nav>ホーム サービス ドキュメント 稼働状況</nav>
<main>
<p>メンテナンス情報や稼働状況を掲載しています。</p>
<h2>稼働状況</h2>
<p>【解消済】自己情報取得APIで情報取得ができない事象が発生していました
詳細：2026/8/31(月)17:00頃〜18:40頃にデジタル庁所管の公共サービスメッシュの障害に伴い、
自己情報取得APIの情報が取得できない事象が発生していました。現在は解消しております。</p>
<h2>メンテナンス情報</h2>
<p>自己情報取得API 9月5日(土) 0:00 〜 9月7日(月) 0:00</p>
</main></body></html>`;

const RSS = (items: { title: string; link: string; date: string; desc?: string }[]) => `<?xml version="1.0"?>
<rss version="2.0"><channel>${items
  .map(
    (i) =>
      `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate><description>${i.desc ?? ''}</description></item>`,
  )
  .join('')}</channel></rss>`;

function writeSources(config: Record<string, unknown>) {
  const path = join(workDir, 'sources.json');
  writeFileSync(path, JSON.stringify(config), 'utf8');
  return path;
}

const run = (config: Record<string, unknown>, maxAgeDays = 3) =>
  collectOfficialSources({
    sourcesPath: writeSources(config),
    statePath: join(workDir, 'source-state.json'),
    now: NOW,
    maxAgeDays,
  });

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'myna-official-'));
  routes = {};
  server = createServer((req, res) => {
    const route = routes[(req.url ?? '').split('?')[0]];
    if (!route) {
      res.writeHead(404, { connection: 'close' });
      res.end('not found');
      return;
    }
    res.writeHead(route.status ?? 200, {
      'content-type': route.type ?? 'text/html; charset=utf-8',
      connection: 'close',
    });
    res.end(route.body);
  });
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(workDir, { recursive: true, force: true });
});

describe('公式情報源の直接収集', () => {
  it('稼働状況ページの【】記載から障害を抽出する（ページタイトルの「稼働状況」に惑わされない）', async () => {
    routes['/status'] = { body: STATUS_PAGE_HTML };

    const result = await run({
      statusPages: [
        {
          id: 'test-api',
          label: 'テストAPI 稼働状況',
          url: `${base}/status`,
          publisher: 'デジタル庁',
          entityName: 'デジタル庁',
          systemName: 'テストAPI',
          incidentCategory: 'common_system',
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.statusIncidents).toHaveLength(1);

    const incident = result.statusIncidents[0];
    expect(incident.symptoms).toContain('自己情報取得API');
    expect(incident.symptoms).toContain('公共サービスメッシュ');
    // ナビゲーションやページタイトルを拾っていないこと
    expect(incident.symptoms).not.toContain('ドキュメント');
    expect(incident.incidentCategory).toBe('common_system');
    expect(incident.sources[0].url).toBe(`${base}/status`);
  });

  it('解消済の記載は resolved、継続中は attention にする', async () => {
    routes['/resolved'] = { body: STATUS_PAGE_HTML };
    routes['/ongoing'] = {
      body: '<html><body><p>【障害】医療保険情報取得APIで情報を取得できない事象が発生しています。調査中です。</p></body></html>',
    };

    const resolved = await run({
      statusPages: [{ id: 'r', label: 'R', url: `${base}/resolved`, incidentCategory: 'common_system' }],
    });
    expect(resolved.statusIncidents[0].status).toBe('resolved');
    expect(resolved.statusIncidents[0].severity).toBe('medium');

    const ongoing = await run({
      statusPages: [{ id: 'o', label: 'O', url: `${base}/ongoing`, incidentCategory: 'common_system' }],
    });
    expect(ongoing.statusIncidents[0].status).toBe('attention');
    expect(ongoing.statusIncidents[0].severity).toBe('high');
  });

  it('障害の記載がなければ項目を作らない（正常稼働を載せない）', async () => {
    routes['/ok'] = {
      body: '<html><body><h2>稼働状況</h2><p>【お知らせ】仕様書を更新しました。</p></body></html>',
    };
    const result = await run({
      statusPages: [{ id: 'ok', label: 'OK', url: `${base}/ok`, incidentCategory: 'common_system' }],
    });
    expect(result.statusIncidents).toHaveLength(0);
  });

  it('障害項目には「オンライン資格確認の全国停止とは別」の切り分けを必ず付ける', async () => {
    routes['/status'] = { body: STATUS_PAGE_HTML };
    const result = await run({
      statusPages: [{ id: 't', label: 'T', url: `${base}/status`, incidentCategory: 'common_system' }],
    });
    const check = result.statusIncidents[0].factChecks[0];
    expect(check.assessment).toBe('scope_separation');
    expect(check.explanation).toContain('別事象');
  });

  it('官公庁RSSをキーワードで絞り込む', async () => {
    routes['/rss'] = {
      body: RSS([
        { title: 'マイナンバーカードの利用シーン拡大について', link: 'https://www.digital.go.jp/a', date: NOW.toUTCString() },
        { title: '職員採用のお知らせ', link: 'https://www.digital.go.jp/b', date: NOW.toUTCString() },
      ]),
      type: 'application/rss+xml',
    };

    const result = await run({
      keywordFilter: 'マイナ|保険証',
      rss: [{ id: 'da', label: 'デジタル庁', url: `${base}/rss`, publisher: 'デジタル庁' }],
    });

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].title).toContain('利用シーン拡大');
    expect(result.articles[0].source).toBe('デジタル庁');
  });

  it('保持期間より古い記事は落とす', async () => {
    const old = new Date(NOW.getTime() - 30 * 86400000).toUTCString();
    routes['/rss'] = {
      body: RSS([{ title: 'マイナンバーカードの古い記事', link: 'https://www.digital.go.jp/old', date: old }]),
      type: 'application/rss+xml',
    };
    const result = await run({
      keywordFilter: 'マイナ',
      rss: [{ id: 'da', label: 'デジタル庁', url: `${base}/rss` }],
    });
    expect(result.articles).toHaveLength(0);
  });

  it('1つの情報源が落ちても他を止めない', async () => {
    routes['/rss'] = {
      body: RSS([{ title: 'マイナンバーカードの新着', link: 'https://www.digital.go.jp/a', date: NOW.toUTCString() }]),
      type: 'application/rss+xml',
    };
    routes['/broken'] = { body: 'error', status: 500 };

    const result = await run({
      keywordFilter: 'マイナ',
      rss: [
        { id: 'broken', label: '落ちている情報源', url: `${base}/broken` },
        { id: 'ok', label: '生きている情報源', url: `${base}/rss` },
      ],
    });

    expect(result.articles).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('落ちている情報源');
  });

  it('定義ファイルが無ければエラーを返し、例外は投げない', async () => {
    const result = await collectOfficialSources({
      sourcesPath: join(workDir, 'missing.json'),
      statePath: join(workDir, 'state.json'),
      now: NOW,
    });
    expect(result.articles).toEqual([]);
    expect(result.errors[0]).toContain('見つかりません');
  });

  it('確認結果を状態ファイルに記録する', async () => {
    routes['/status'] = { body: STATUS_PAGE_HTML };
    await run({
      statusPages: [{ id: 'test-api', label: 'T', url: `${base}/status`, incidentCategory: 'common_system' }],
    });
    const state = JSON.parse(readFileSync(join(workDir, 'source-state.json'), 'utf8'));
    expect(state['statusPage:test-api'].checkedAt).toBe(NOW.toISOString());
    expect(state['statusPage:test-api'].fingerprint).toBeTruthy();
  });
});
