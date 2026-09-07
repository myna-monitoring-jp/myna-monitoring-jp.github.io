// @vitest-environment node
// HTTPサーバを扱うため jsdom ではなく node 環境で実行する。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { collectBriefing, extractText, sanitizeBriefing } from '../../scripts/collect-briefing.mjs';

/**
 * 朝の状況判断の生成のテスト。
 *
 * OpenAI には出ず、ローカルのHTTPサーバで Responses API を模す。
 * 確認したいのは「呼び方が仕様どおりか」と「失敗しても落ちないか」。
 */

let server: Server;
let base: string;
/** サーバが受け取ったリクエストボディ。呼び方を検査するために積む。 */
let received: Record<string, unknown>[];
/** 応答の作り方。テストごとに差し替える。 */
let respond: (body: Record<string, unknown>, index: number) => { status: number; payload: unknown };

const NOW = new Date('2026-09-07T00:51:00Z'); // 09:51 JST

const textResponse = (text: string) => ({
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 10, output_tokens: 20 },
});

const VALID_BRIEFING = {
  metrics: [
    { label: '今朝のニュース規模', value: '中', alert: false },
    { label: '新規全国オン資障害', value: '確認なし', alert: false },
  ],
  overview: ['直近24時間で新たな全国規模の重大障害は確認できませんでした。'],
  highlights: ['NEW：マイナ救急新聞広告'],
  judgments: [{ area: '医療・システム', text: '公式ページは正常に稼働と表示。' }],
  diffs: [
    {
      change: 'increased',
      theme: 'マイナアプリ',
      update: 'App Storeは2.3/5・509件。前日466件から43件増。',
      judgment: '評価は横ばい。増加理由は断定しない。',
    },
  ],
  watchlist: [{ theme: 'マイナ救急広告', detail: '掲載後のX転載と引用反応。' }],
  caveats: ['SNS・App Storeレビューは全国世論を代表しません。'],
  sources: [
    {
      label: 'マイナポータルAPI 稼働状況',
      url: 'https://developers.digital.go.jp/x',
      publisher: 'デジタル庁',
      kind: 'primary',
    },
  ],
  newsItems: [],
  prItems: [],
  sentimentRows: [],
};

beforeEach(async () => {
  received = [];
  respond = (_body, index) =>
    index === 0
      ? { status: 200, payload: textResponse('調査所見。旅券申請ページを開いて確認しました。') }
      : { status: 200, payload: textResponse(JSON.stringify(VALID_BRIEFING)) };

  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const index = received.length;
      received.push({ ...body, _authorization: req.headers.authorization });
      const { status, payload } = respond(body, index);
      res.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
  });
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const run = (options: Record<string, unknown> = {}) =>
  collectBriefing({
    apiKey: 'test-key-must-not-leak',
    model: 'gpt-6-astra',
    now: NOW,
    apiUrlOverride: base,
    ...options,
  });

describe('朝の状況判断の生成', () => {
  it('調査と整形の2回に分けて呼ぶ', async () => {
    const result = await run();
    expect(result.errors).toEqual([]);
    expect(received).toHaveLength(2);
  });

  it('1回目は web_search を渡し、2回目は渡さない（整形に検索は不要）', async () => {
    await run();
    expect(received[0].tools).toEqual([{ type: 'web_search' }]);
    expect(received[1].tools).toBeUndefined();
  });

  it('2回目は strict な json_schema を指定する', async () => {
    await run();
    const format = (received[1].text as { format: Record<string, unknown> }).format;
    expect(format.type).toBe('json_schema');
    expect(format.strict).toBe(true);
    expect(format.schema).toBeTruthy();
  });

  it('スキーマは strict の制約を満たす（全プロパティ required・追加禁止）', async () => {
    await run();
    const format = (received[1].text as { format: { schema: Record<string, unknown> } }).format;
    const walk = (node: Record<string, unknown>, path: string) => {
      if (node.type === 'object') {
        expect(node.additionalProperties, `${path} は additionalProperties: false が必要`).toBe(false);
        const props = Object.keys((node.properties ?? {}) as Record<string, unknown>);
        expect((node.required as string[]) ?? [], `${path} は全プロパティを required にする`).toEqual(props);
        for (const key of props) {
          walk((node.properties as Record<string, Record<string, unknown>>)[key], `${path}.${key}`);
        }
      }
      if (node.type === 'array' && node.items) walk(node.items as Record<string, unknown>, `${path}[]`);
    };
    walk(format.schema, '$');
  });

  it('モデルとAPIキーを指定どおり送る', async () => {
    await run();
    expect(received[0].model).toBe('gpt-6-astra');
    expect(received[0]._authorization).toBe('Bearer test-key-must-not-leak');
  });

  it('前日のブリーフィングを渡すと差分計算の材料としてプロンプトに含める', async () => {
    await run({
      previous: {
        confirmedAt: '2026-09-06T00:51:00Z',
        metrics: [{ label: 'マイナアプリ', value: '2.3/5・466件' }],
        diffs: [{ change: 'flat', theme: 'マイナアプリ', update: '466件', judgment: '横ばい' }],
      },
    });
    const input = JSON.stringify(received[0].input);
    expect(input).toContain('466件');
    expect(input).toContain('2026-09-06');
  });

  it('前日分がなければ「前日の値が不明」として扱わせる', async () => {
    await run({ previous: null });
    expect(JSON.stringify(received[0].input)).toContain('前日のブリーフィングはありません');
  });

  it('確認時点と主対象期間（24時間）を記録する', async () => {
    const { briefing } = await run();
    expect(briefing?.confirmedAt).toBe(NOW.toISOString());
    const from = new Date(briefing!.windowFrom).getTime();
    expect(NOW.getTime() - from).toBe(24 * 60 * 60 * 1000);
  });

  it('出典に一次情報としてのリンク属性を付ける', async () => {
    const { briefing } = await run();
    expect(briefing?.sources[0]).toMatchObject({
      type: 'primary',
      url: 'https://developers.digital.go.jp/x',
      linkText: '一次情報を開く',
      active: true,
    });
  });

  it('何が生成したかを残す（画面に出すため）', async () => {
    const { briefing } = await run();
    expect(briefing?.generatedBy).toBe('gpt-6-astra');
  });

  it('APIキーが無ければ生成せず、例外も投げない', async () => {
    const result = await collectBriefing({ apiKey: '', now: NOW, apiUrlOverride: base });
    expect(result.briefing).toBeNull();
    expect(result.errors[0]).toContain('OPENAI_API_KEY');
    expect(received).toHaveLength(0);
  });

  it('APIが落ちていても例外を投げず、キーをエラーに含めない', async () => {
    respond = () => ({ status: 500, payload: { error: { message: 'boom' } } });
    const result = await run();
    expect(result.briefing).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).not.toContain('test-key-must-not-leak');
  });

  it('モデルが応答を拒否した場合もエラーとして返す', async () => {
    respond = () => ({
      status: 200,
      payload: { output: [{ type: 'message', content: [{ type: 'refusal', refusal: '安全上の理由' }] }] },
    });
    const result = await run();
    expect(result.briefing).toBeNull();
    expect(result.errors[0]).toContain('拒否');
  });

  it('整形結果がJSONとして壊れていてもエラーとして返す', async () => {
    respond = (_body, index) =>
      index === 0
        ? { status: 200, payload: textResponse('所見') }
        : { status: 200, payload: textResponse('これはJSONではありません') };
    const result = await run();
    expect(result.briefing).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  it('調査結果が空なら整形へ進まない', async () => {
    respond = () => ({ status: 200, payload: textResponse('') });
    const result = await run();
    expect(result.briefing).toBeNull();
    expect(received).toHaveLength(1);
  });
});

describe('生成物の受け入れ検査', () => {
  const full = {
    ...VALID_BRIEFING,
    confirmedAt: NOW.toISOString(),
    windowFrom: NOW.toISOString(),
    windowTo: NOW.toISOString(),
    generatedBy: 'gpt-6-astra',
  };

  it('http(s) でない出典を落とす（リンク契約を満たせないため）', () => {
    const result = sanitizeBriefing({
      ...full,
      sources: [
        { label: '正しい', url: 'https://www.digital.go.jp/a' },
        { label: 'スクリプト', url: 'javascript:void(0)' },
        { label: '空', url: '' },
        { label: '相対', url: '/news/1' },
        { label: 'アンカー', url: '#' },
      ],
    });
    expect(result.sources.map((s: { label: string }) => s.label)).toEqual(['正しい']);
  });

  it('列挙外の差分ラベルを落とす', () => {
    const result = sanitizeBriefing({
      ...full,
      diffs: [
        { change: 'new', theme: '正しい', update: '', judgment: '' },
        { change: 'continued', theme: '不正', update: '', judgment: '' },
        { change: '継続', theme: '禁止語', update: '', judgment: '' },
      ],
    });
    expect(result.diffs.map((d: { theme: string }) => d.theme)).toEqual(['正しい']);
  });

  it('禁止語を指標の値に使っている項目を落とす', () => {
    const result = sanitizeBriefing({
      ...full,
      metrics: [
        { label: '規模', value: '中' },
        { label: '広報', value: '継続' },
        { label: '障害', value: 'WATCH' },
      ],
    });
    expect(result.metrics.map((m: { label: string }) => m.label)).toEqual(['規模']);
  });

  it('説明文の中の「継続」は落とさない（ラベルとしての使用だけを禁じる）', () => {
    const result = sanitizeBriefing({
      ...full,
      judgments: [{ area: 'セキュリティ', text: '事案全体の人数が未公表のため継続して監視します。' }],
    });
    expect(result.judgments[0].text).toContain('継続');
  });

  it('件数が暴走しても1画面に収まる量に抑える', () => {
    const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));
    const result = sanitizeBriefing({
      ...full,
      metrics: many(20, (i) => ({ label: `指標${i}`, value: '値' })),
      diffs: many(30, (i) => ({ change: 'flat', theme: `差分${i}`, update: '', judgment: '' })),
      watchlist: many(30, (i) => ({ theme: `監視${i}`, detail: '' })),
      sources: many(40, (i) => ({ label: `出典${i}`, url: `https://example.go.jp/${i}` })),
    });
    expect(result.metrics).toHaveLength(6);
    expect(result.diffs).toHaveLength(10);
    expect(result.watchlist).toHaveLength(10);
    expect(result.sources).toHaveLength(15);
  });

  it('空白だけの文章を落とす', () => {
    const result = sanitizeBriefing({ ...full, overview: ['   ', '本文', ''] });
    expect(result.overview).toEqual(['本文']);
  });

  it('collectBriefing の戻り値は検査済みである', async () => {
    respond = (_body, index) =>
      index === 0
        ? { status: 200, payload: textResponse('所見') }
        : {
            status: 200,
            payload: textResponse(
              JSON.stringify({
                ...VALID_BRIEFING,
                sources: [{ label: 'だめなURL', url: 'javascript:void(0)', publisher: 'x' }],
              }),
            ),
          };
    const { briefing } = await run();
    expect(briefing?.sources).toEqual([]);
  });
});

describe('レスポンスからの本文取り出し', () => {
  it('複数の output_text を連結する', () => {
    expect(
      extractText({
        output: [
          { content: [{ type: 'output_text', text: '前半' }] },
          { content: [{ type: 'output_text', text: '後半' }] },
        ],
      }),
    ).toBe('前半\n後半');
  });

  it('web_search の呼び出し記録は本文として扱わない', () => {
    expect(
      extractText({
        output: [
          { type: 'web_search_call', status: 'completed' },
          { type: 'message', content: [{ type: 'output_text', text: '所見' }] },
        ],
      }),
    ).toBe('所見');
  });

  it('拒否は例外にする', () => {
    expect(() =>
      extractText({ output: [{ content: [{ type: 'refusal', refusal: 'だめです' }] }] }),
    ).toThrow('だめです');
  });
});
