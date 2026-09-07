/**
 * 朝の状況判断（ブリーフィング）の生成
 *
 * 機械収集（RSS・稼働状況ページ）で取れるのは「何が公開されたか」までで、
 * 「公式ページが今どう表示しているか」「前日の数値と比べてどう動いたか」
 * 「確認できなかったこと」は取れない。ここが従来の抜けだった。
 *
 * OpenAI Responses API の web_search ツールで実際に検索・ページ確認をさせ、
 * その結果を厳格なJSONスキーマに整形して受け取る。2段に分ける理由：
 *
 *   step1（調査）… ツールを使わせ、自由記述で所見を出させる。ここは分量が要る
 *   step2（整形）… ツールなしで step1 の所見をスキーマに落とす
 *
 * 1回で両方やらせると、スキーマ順守のために調査が浅くなる。
 *
 * HTMLは生成させない。外部リンク契約（target/rel/空href禁止）と状態語彙の制約は
 * 生成HTMLでは検証できないため、描画は必ずアプリ側のコンポーネントで行う。
 *
 * 依存パッケージなし（Node 20+ の fetch を使用）。
 */

const API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-6-astra';

/** 調査は時間がかかる。web_search を何度も回すため長めに取る。 */
const RESEARCH_TIMEOUT_MS = 15 * 60 * 1000;
const FORMAT_TIMEOUT_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------ スキーマ定義 */

/**
 * strict モードの制約に合わせている：
 *  - すべてのプロパティを required に入れる
 *  - すべてのオブジェクトに additionalProperties: false
 *  - minItems / maxItems は使えないため、件数は指示文で伝える
 */
const BRIEFING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['metrics', 'overview', 'highlights', 'judgments', 'diffs', 'watchlist', 'caveats', 'sources'],
  properties: {
    metrics: {
      type: 'array',
      description: 'ヘッダーの指標カード。5件前後。確認できなかったことも「確認なし」として必ず含める。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value', 'alert'],
        properties: {
          label: { type: 'string', description: '例：新規全国オン資障害' },
          value: { type: 'string', description: '例：確認なし／中／マイナ救急。20字以内' },
          alert: { type: 'boolean', description: '注意を引くべき値なら true' },
        },
      },
    },
    overview: {
      type: 'array',
      description: '今朝の総括。1段落1要素で3〜4要素。断定できないことは断定しない。',
      items: { type: 'string' },
    },
    highlights: {
      type: 'array',
      description: '総括の要点チップ。「NEW：マイナ救急新聞広告」のような短い句で4〜6件。',
      items: { type: 'string' },
    },
    judgments: {
      type: 'array',
      description: '今朝の判断。医療・システム／広報／セキュリティの3領域を必ず含める。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'text'],
        properties: {
          area: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
    diffs: {
      type: 'array',
      description: '前日からの差分。動きがなかったものも「横ばい」として載せる。5〜8件。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['change', 'theme', 'update', 'judgment'],
        properties: {
          change: {
            type: 'string',
            enum: ['new', 'increased', 'decreased', 'flat', 'scheduled_end', 'resolved'],
          },
          theme: { type: 'string' },
          update: { type: 'string', description: 'その日に確認できた更新内容。日付と数値を入れる' },
          judgment: { type: 'string', description: 'その更新をどう読むか' },
        },
      },
    },
    watchlist: {
      type: 'array',
      description: '今日の優先ウォッチ。優先度の高い順に6〜8件。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['theme', 'detail'],
        properties: {
          theme: { type: 'string' },
          detail: { type: 'string', description: '具体的に何を見るか' },
        },
      },
    },
    caveats: {
      type: 'array',
      description: '読み方の注意。代表性の留保を必ず含める。2〜4件。',
      items: { type: 'string' },
    },
    sources: {
      type: 'array',
      description: '実際に開いて確認した一次情報のみ。開いていないURLを書かない。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'url', 'publisher'],
        properties: {
          label: { type: 'string' },
          url: { type: 'string', description: 'http(s) の絶対URL' },
          publisher: { type: 'string' },
        },
      },
    },
  },
};

/* ------------------------------------------------------------ プロンプト */

const RESEARCH_INSTRUCTIONS = `あなたは厚生労働省のマイナ保険証広報を担当するチームの調査担当です。
毎朝、担当者が業務を始める前に読む「朝の動向レポート」の材料を作ります。

## 調査対象（5系統すべてを必ず確認する）
1. トップニュース・世論（マイナ保険証、マイナンバー制度）
2. 自治体・保険者の不具合（資格無効表示、負担割合誤り、資格確認書の誤送付等）
3. 共通システムの障害（オンライン資格確認、マイナポータル、マイナポータルAPI、マイナアプリ、旅券オンライン申請）
4. 医療機関・周辺IT・サイバー（病院の情報事故、電子カルテ障害、委託先の情報漏えい）
5. 行政広報・広告の動向（新規掲載、炎上、批判の継続、安定してポジティブなもの）

## 守ること（これを外すとレポートは使えません）
- **検索結果の見出しで済ませず、公式ページを実際に開いて今の表示を確認する。**
  例：マイナポータルの旅券申請ページが申請開始の導線を出しているか、
  デジタル庁のマイナポータルAPI稼働状況ページが何と表示しているか。
  「◯◯と表示している」と書くときは、必ずそのページを開いてから書く。
- **数値は数値で取る。** App Storeの評価は「2.3/5・509件」のように星と件数を取る。
  前日の値が渡されている場合は必ず差分を計算する。
- **無かったことは「確認できず」と書く。** 「障害はなかった」と断定してはいけません。
  「公開情報・主要報道・確認できた公式情報の範囲では新規の全国規模障害を確認できなかった」と書く。
- **記事の日付を必ず本文で確認する。** 検索で上位に来る記事が1年前のものであることは頻繁にあります。
  24時間以内でないものを「本日の新規」として扱ってはいけません。
- **予測される批判を「国民の声」として書かない。** 実際に観測された声だけを声として扱い、
  予測は「広報上のリスク」として区別する。
- **代表性を混同しない。** SNS・Yahoo!コメント・App Storeレビューは全国世論ではありません。
  世論調査を引くときは主体・標本数・方法を確認する。
- 「炎上」と判定するときは、批判の存在だけでなく、反応量・二次転載・主要媒体への波及・
  公式対応の有無を確認する。1件の批判投稿を炎上と呼ばない。

## 出力
調査した所見を日本語で詳しく書いてください。この段階では書式は自由です。
確認した各URLと、そのページで実際に何を確認したかを必ず併記してください。
確認できなかった項目は、確認できなかったと明記してください。`;

const FORMAT_INSTRUCTIONS = `渡された調査所見を、指定されたJSONスキーマに整形してください。

## 守ること
- **所見に書かれていない事実を足さない。** 整形だけを行い、推測で埋めない。
- **sources には、所見の中で実際に開いて確認したと書かれているURLだけを入れる。**
  http または https で始まる絶対URLのみ。短縮URLや検索結果ページは入れない。
- metrics には「確認なし」の項目も必ず含める。無かったことの記録が要る。
- diffs の change は次の意味で使う：
  new=新規に出てきた / increased=数値が増えた / decreased=数値が減った /
  flat=前日から動いていない / scheduled_end=予定されていた停止・メンテが終了 /
  resolved=障害・事案が解消した
- diffs の update には日付と数値を入れる。「増えた」ではなく「466件→509件」と書く。
- caveats には代表性の留保を必ず入れる。
- **「WATCH」「継続」という語をラベルとして使わない。** 文章中の説明語としてなら可。
- 日本語で書く。断定できないことは断定しない書き方を保つ。`;

/* ------------------------------------------------------------ 受け入れ検査 */

const BRIEFING_CHANGES = new Set(['new', 'increased', 'decreased', 'flat', 'scheduled_end', 'resolved']);

/**
 * 生成物をそのまま信用しないための受け入れ検査。
 *
 * モデルの出力は、JSONスキーマを通っていても内容の約束は守らない。
 * ここで落とすもの：
 *  - http(s) の絶対URLでない出典（リンク契約を満たせない）
 *  - 列挙外の差分ラベル
 *  - 禁止語（WATCH／継続）をラベルとして使っているもの
 *  - 件数の暴走（1画面に載らない量を出してくることがある）
 */
export function sanitizeBriefing(briefing) {
  const text = (value) => String(value ?? '').trim();
  const cap = (list, max) => (Array.isArray(list) ? list.slice(0, max) : []);

  // 状態語彙の禁止語。ラベルとして使われた場合だけ落とす（文章中の説明語は可）。
  const bannedLabel = (value) => /^(WATCH|継続|継続中|watch)$/i.test(text(value));

  const usableUrl = (url) => {
    try {
      const parsed = new URL(text(url));
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  return {
    confirmedAt: briefing.confirmedAt,
    windowFrom: briefing.windowFrom,
    windowTo: briefing.windowTo,
    generatedBy: text(briefing.generatedBy),
    metrics: cap(briefing.metrics, 6)
      .filter((m) => text(m.label) && text(m.value) && !bannedLabel(m.value))
      .map((m) => ({ label: text(m.label), value: text(m.value), alert: Boolean(m.alert) })),
    overview: cap(briefing.overview, 5).map(text).filter(Boolean),
    highlights: cap(briefing.highlights, 8).map(text).filter(Boolean),
    judgments: cap(briefing.judgments, 6)
      .filter((j) => text(j.area) && text(j.text))
      .map((j) => ({ area: text(j.area), text: text(j.text) })),
    diffs: cap(briefing.diffs, 10)
      .filter((d) => BRIEFING_CHANGES.has(d.change) && text(d.theme))
      .map((d) => ({
        change: d.change,
        theme: text(d.theme),
        update: text(d.update),
        judgment: text(d.judgment),
      })),
    watchlist: cap(briefing.watchlist, 10)
      .filter((w) => text(w.theme))
      .map((w) => ({ theme: text(w.theme), detail: text(w.detail) })),
    caveats: cap(briefing.caveats, 5).map(text).filter(Boolean),
    sources: cap(briefing.sources, 15).filter((s) => usableUrl(s.url) && text(s.label)),
  };
}

/* -------------------------------------------------------------- 小道具 */

async function callResponses({ apiKey, model, instructions, input, tools, schema, timeoutMs, apiUrl = API_URL }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = { model, instructions, input };
    if (tools) body.tools = tools;
    if (schema) {
      body.text = { format: { type: 'json_schema', name: 'briefing', schema, strict: true } };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      // APIキーそのものは絶対にログへ出さない
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Responses API のレスポンスから本文を取り出す。
 * output[].content[] を歩く。安全上の拒否（refusal）は例外にして上に伝える。
 */
export function extractText(payload) {
  const parts = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'refusal') {
        throw new Error(`モデルが応答を拒否しました: ${content.refusal}`);
      }
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

/** 前日のブリーフィングを、差分計算のための材料として短く渡す。 */
function previousContext(previous) {
  if (!previous) return '前日のブリーフィングはありません。差分は「前日の値が不明」として扱ってください。';
  const metrics = (previous.metrics ?? []).map((m) => `${m.label}=${m.value}`).join(' / ');
  const diffs = (previous.diffs ?? []).map((d) => `${d.theme}: ${d.update}`).join('\n');
  return [
    `前日（${previous.confirmedAt}）の指標: ${metrics}`,
    '前日に記録した更新内容:',
    diffs,
    '',
    'これらと比べて何が動いたかを diffs に書いてください。数値は差分を明示してください。',
  ].join('\n');
}

/* ---------------------------------------------------------------- 本体 */

/**
 * @returns {{briefing: object|null, errors: string[], usage: object|null}}
 *   キーが無い・APIが落ちている場合も例外は投げず briefing: null を返す。
 *   ブリーフィングが作れなくても、機械収集の結果は公開できるようにするため。
 */
export async function collectBriefing({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.BRIEFING_MODEL || DEFAULT_MODEL,
  now,
  previous = null,
  apiUrlOverride,
} = {}) {
  const result = { briefing: null, errors: [], usage: null };

  if (!apiKey) {
    result.errors.push(
      'OPENAI_API_KEY が設定されていないため、朝の状況判断を生成しませんでした（機械収集は実行済み）。',
    );
    return result;
  }

  const windowTo = now;
  const windowFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const jst = (d) => new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16);

  // apiUrlOverride はテストでローカルサーバに向けるためのもの。本番では渡さない。
  const call = (options) => callResponses({ apiKey, model, apiUrl: apiUrlOverride ?? API_URL, ...options });

  try {
    /* --- step1: 検索とページ確認 --- */
    const research = await call({
      instructions: RESEARCH_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [
            `現在時刻は ${jst(now)} JST です。`,
            `主対象期間は ${jst(windowFrom)} 〜 ${jst(windowTo)} JST（直近24時間）です。`,
            '',
            previousContext(previous),
            '',
            '上記の期間について、5系統すべてを調査してください。公式ページは実際に開いて表示を確認してください。',
          ].join('\n'),
        },
      ],
      tools: [{ type: 'web_search' }],
      timeoutMs: RESEARCH_TIMEOUT_MS,
    });

    const findings = extractText(research);
    if (!findings) throw new Error('調査結果が空でした。');

    /* --- step2: スキーマへ整形 --- */
    const formatted = await call({
      instructions: FORMAT_INSTRUCTIONS,
      input: [{ role: 'user', content: `以下が調査所見です。\n\n${findings}` }],
      schema: BRIEFING_SCHEMA,
      timeoutMs: FORMAT_TIMEOUT_MS,
    });

    const raw = JSON.parse(extractText(formatted));

    // 受け入れ検査を通したものだけを返す。呼び出し側で再検査は不要。
    result.briefing = sanitizeBriefing({
      confirmedAt: now.toISOString(),
      windowFrom: windowFrom.toISOString(),
      windowTo: windowTo.toISOString(),
      generatedBy: model,
      metrics: raw.metrics ?? [],
      overview: raw.overview ?? [],
      highlights: raw.highlights ?? [],
      judgments: raw.judgments ?? [],
      diffs: raw.diffs ?? [],
      watchlist: raw.watchlist ?? [],
      caveats: raw.caveats ?? [],
      sources: (raw.sources ?? []).map((s) => ({
        type: 'primary',
        label: s.label,
        url: s.url,
        linkText: '一次情報を開く',
        publisher: s.publisher,
        verifiedAt: now.toISOString(),
        active: true,
      })),
    });

    result.usage = {
      research: research?.usage ?? null,
      format: formatted?.usage ?? null,
    };
  } catch (error) {
    result.errors.push(`朝の状況判断の生成に失敗しました: ${error.message}`);
  }

  return result;
}

export const __internal = { BRIEFING_SCHEMA, previousContext };
