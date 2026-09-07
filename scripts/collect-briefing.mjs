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
/** 出典の形。ニュース・広報・全体で同じものを使う。 */
const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'url', 'publisher', 'kind'],
  properties: {
    label: { type: 'string' },
    url: { type: 'string', description: 'http(s) の絶対URL。実際に開いたものだけ' },
    publisher: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['primary', 'media', 'social', 'survey'],
      description: 'primary=一次情報（官公庁・当事者）/ media=報道 / social=SNS / survey=世論調査',
    },
  },
};

const BRIEFING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'metrics',
    'overview',
    'highlights',
    'judgments',
    'diffs',
    'watchlist',
    'caveats',
    'sources',
    'newsItems',
    'prItems',
    'sentimentRows',
  ],
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
      items: SOURCE_SCHEMA,
    },
    newsItems: {
      type: 'array',
      description:
        '書き起こすニュース。材料をそのまま並べるのではなく、載せる価値のあるものだけを選ぶ。' +
        'ネガティブ／要注意を先に、ポジティブ／前進を後に。合計で3〜6件。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'headline',
          'severity',
          'tone',
          'topicTags',
          'body',
          'facts',
          'publicVoice',
          'voiceObserved',
          'claims',
          'sources',
        ],
        properties: {
          headline: {
            type: 'string',
            description:
              '書き直した見出し。元記事の表題を写さない。何が分かったかを書く。' +
              '例：「RIZAPの特定保健指導データ誤アップロード―事案全体の対象人数はなお未公表」',
          },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          tone: {
            type: 'string',
            enum: ['negative', 'positive'],
            description: 'negative=ネガティブ／要注意、positive=制度・運用の前進',
          },
          topicTags: {
            type: 'array',
            description: '論点タグ。例：要配慮個人情報／利用者体験／救急・医療情報。2〜3件',
            items: { type: 'string' },
          },
          body: {
            type: 'array',
            description: 'A. ニュース自体。何が起きたかを書く。1段落1要素で1〜3要素',
            items: { type: 'string' },
          },
          facts: {
            type: 'array',
            description:
              'A の定量テーブル。数値と、公表されていないことも書く。' +
              '例：{label:"事案全体", value:"総数未公表"}。2〜4件',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'value'],
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
            },
          },
          publicVoice: {
            type: 'string',
            description:
              'B. 国民の声・現場の声。実際に観測された声だけを書く。予測は書かない。' +
              '無い場合は「直近24時間で新規の有意な反応は確認できませんでした」と書き、' +
              '業界の問題提起と全国世論を区別する。',
          },
          voiceObserved: {
            type: 'boolean',
            description: '観測された声があったか。無ければ false',
          },
          claims: {
            type: 'array',
            description: 'C. 事実関係・補足。世間の論点に対する判定。2〜4件',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['claim', 'assessment', 'note'],
              properties: {
                claim: { type: 'string', description: '世間で言われている内容' },
                assessment: {
                  type: 'string',
                  enum: [
                    'fact',
                    'misunderstanding',
                    'overstatement',
                    'legitimate_debate',
                    'scope_separation',
                    'unconfirmed',
                  ],
                  description:
                    'fact=事実 / misunderstanding=誤解 / overstatement=言い過ぎ / ' +
                    'legitimate_debate=正当な制度論点 / scope_separation=別事象・影響範囲の切り分け / ' +
                    'unconfirmed=確認されず（否定できたのではなく確認できていない）',
                },
                note: { type: 'string', description: '判定の根拠と補足' },
              },
            },
          },
          sources: { type: 'array', items: SOURCE_SCHEMA },
        },
      },
    },
    prItems: {
      type: 'array',
      description: '書き起こす広報案件。掲載中・炎上・批判動向。1〜4件',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'headline',
          'heatLevel',
          'badges',
          'origin',
          'intent',
          'observedCriticism',
          'potentialIssues',
          'separation',
          'officialNote',
          'secondarySpread',
          'communicationNote',
          'sources',
        ],
        properties: {
          headline: { type: 'string', description: '例：「マイナ救急新聞広告｜新規掲載・反応観測中」' },
          heatLevel: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description:
              '炎上度。批判の存在だけで high にしない。反応量・二次転載・主要媒体への波及・' +
              '公式対応の複数条件を満たす場合のみ high',
          },
          badges: {
            type: 'array',
            description: '状態の短い札。例：掲載初日／既存批判あり／大型案件なし。1〜3件',
            items: { type: 'string' },
          },
          origin: { type: 'string', description: '①起点。誰が何を出したか' },
          intent: { type: 'string', description: '②訴求意図' },
          observedCriticism: {
            type: 'string',
            description: '③現に確認できる批判。無ければ「確認できません」と書く',
          },
          potentialIssues: {
            type: 'string',
            description:
              '④想定される論点。これは国民の声ではなく広報上の確認ポイントである。' +
              'そう読めるように書くこと',
          },
          separation: { type: 'string', description: '⑤切り分け。誤解と事実の線引き' },
          officialNote: { type: 'string', description: '⑥公式補足。公式がどこで何を説明しているか' },
          secondarySpread: { type: 'string', description: '⑦二次拡散。転載・記事化の状況' },
          communicationNote: { type: 'string', description: '⑧広報上の注意。表現と事実の両立点' },
          sources: { type: 'array', items: SOURCE_SCHEMA },
        },
      },
    },
    sentimentRows: {
      type: 'array',
      description:
        '世論・反応の傾向。観測チャネルごとに状況と読み方を分けて書く。' +
        '全国世論調査／X・Yahoo!コメント／App Store／現場報告など3〜5件',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['channel', 'situation', 'reading'],
        properties: {
          channel: { type: 'string' },
          situation: { type: 'string', description: '今朝の状況。無ければ確認できずと書く' },
          reading: { type: 'string', description: 'その結果をどう読むか。代表性の扱いを書く' },
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

## 収集済みの材料の扱い
機械収集した記事の一覧を渡します。これは**材料であって成果物ではありません**。

- 全件に目を通してください。ただし**大半は捨てます。**
- 材料は見出しだけなので、載せる価値がありそうなものは web_search で裏を取り、
  一次情報のページを開いて中身を確認してください。
- 材料に無い重要な動きも、検索で見つけたら取り上げてください。材料は網羅ではありません。
- 解説記事・ハウツー記事・二次転載は取り上げません。

## 取り上げるものの書き方
取り上げると決めたものは、次を揃えて書いてください。**元記事の表題を写して終わりにしないこと。**

ニュース：
- 見出しを書き直す。「何が分かったか」を書く。
  良い例：「RIZAPの特定保健指導データ誤アップロード―事案全体の対象人数はなお未公表」
  悪い例：「マイナ救急（令和8年9月掲載）」（元の表題の写し。何も伝わらない）
- 何が起きたかの本文
- 定量情報。数値と、**公表されていないこと**（例「事案全体：総数未公表」）
- 国民の声。観測されたものだけ。無ければ無いと書く
- 世間の論点への判定（事実／誤解／言い過ぎ／正当な制度論点／別事象／確認されず）
- 出典。一次情報と報道を区別する

広報：起点／訴求意図／現に確認できる批判／想定される論点／切り分け／公式補足／
二次拡散／広報上の注意 の8点。

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
- 日本語で書く。断定できないことは断定しない書き方を保つ。

## newsItems / prItems の整形で特に守ること
- **headline は所見に書かれた書き直し後の見出しを使う。** 元記事の表題を写さない。
  表題の写しにしかならないなら、その項目は取り上げない（載せないという選択が正しい）。
- facts には「未公表」「確認されず」も値として入れる。空欄にしない。
- voiceObserved は、所見に実際の反応が書かれている場合のみ true。
  「反応は確認できなかった」なら false にし、publicVoice にその旨を書く。
- claims の assessment は所見の判断に従う。迷ったら断定側ではなく unconfirmed を選ぶ。
- prItems の potentialIssues は「予測される批判」であり国民の声ではない。
  広報上の確認ポイントとして読めるように書く。
- heatLevel は、反応量・二次転載・主要媒体への波及・公式対応の複数条件を
  満たす場合のみ high。批判が1件あるだけで high にしない。
- sources の kind は、官公庁・当事者の発表なら primary、報道なら media。
  news.google.com のリダイレクトURLは出典にしない（元の媒体のURLを書く）。`;

/* ------------------------------------------------------------ 受け入れ検査 */

const BRIEFING_CHANGES = new Set(['new', 'increased', 'decreased', 'flat', 'scheduled_end', 'resolved']);

/**
 * 書き起こすニュースの上限。
 * 増やすほど月額が上がるので設定値にしている（既定6件で月 $40〜80 の想定）。
 */
const MAX_WRITEUPS = Number(process.env.MAX_BRIEFING_WRITEUPS ?? 6);

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
    // 出典は種別・リンク文言まで整えたものにする（画面がそのままリンクにする）
    sources: sanitizeSources(briefing.sources, briefing.confirmedAt, 15),
    newsItems: cap(briefing.newsItems, MAX_WRITEUPS)
      .map((item, index) => sanitizeNewsItem(item, index, briefing.confirmedAt))
      .filter(Boolean),
    prItems: cap(briefing.prItems, 5)
      .map((item, index) => sanitizePRItem(item, index))
      .filter(Boolean),
    sentimentRows: cap(briefing.sentimentRows, 6)
      .filter((row) => text(row.channel) && text(row.situation))
      .map((row) => ({
        channel: text(row.channel),
        situation: text(row.situation),
        reading: text(row.reading),
      })),
  };
}

/** 書き起こしの共通の下ごしらえ。 */
const trimText = (value) => String(value ?? '').trim();

/** 出典。リンク契約を満たすものだけを残し、種別を正規化する。 */
function sanitizeSources(sources, verifiedAt, limit = 6) {
  const KINDS = new Set(['primary', 'media', 'social', 'survey']);
  const LINK_TEXT = {
    primary: '一次情報を開く',
    media: '報道記事を開く',
    social: 'X投稿を開く',
    survey: '調査結果を開く',
  };
  return (Array.isArray(sources) ? sources : [])
    .slice(0, limit)
    .filter((s) => {
      if (!trimText(s?.label)) return false;
      try {
        const url = new URL(trimText(s.url));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        /*
         * Google News のリダイレクトURLは出典にしない。
         * 押しても中間ページに飛ぶだけで一次情報に到達しない。
         */
        return url.hostname !== 'news.google.com';
      } catch {
        return false;
      }
    })
    .map((s) => {
      const kind = KINDS.has(s.kind) ? s.kind : 'media';
      return {
        type: kind,
        label: trimText(s.label),
        url: trimText(s.url),
        linkText: LINK_TEXT[kind],
        publisher: trimText(s.publisher) || undefined,
        verifiedAt,
        active: true,
      };
    });
}

/**
 * 書き起こされたニュース1件の受け入れ検査。
 *
 * 出典が1件も残らない項目は落とす。裏の取れていない記事を
 * 「書き起こし」として公開する方が、載せないより有害。
 */
function sanitizeNewsItem(item, index, verifiedAt) {
  const ASSESSMENTS = new Set([
    'fact',
    'misunderstanding',
    'overstatement',
    'legitimate_debate',
    'scope_separation',
    'unconfirmed',
  ]);

  const headline = trimText(item?.headline);
  const body = (Array.isArray(item?.body) ? item.body : []).map(trimText).filter(Boolean);
  const sources = sanitizeSources(item?.sources, verifiedAt);

  if (!headline || body.length === 0 || sources.length === 0) return null;

  return {
    id: `briefing-news-${index + 1}`,
    headline,
    severity: ['high', 'medium', 'low'].includes(item.severity) ? item.severity : 'medium',
    tone: item.tone === 'positive' ? 'positive' : 'negative',
    topicTags: (Array.isArray(item.topicTags) ? item.topicTags : []).slice(0, 4).map(trimText).filter(Boolean),
    body: body.slice(0, 4),
    facts: (Array.isArray(item.facts) ? item.facts : [])
      .slice(0, 6)
      .filter((f) => trimText(f?.label) && trimText(f?.value))
      .map((f) => ({ label: trimText(f.label), value: trimText(f.value) })),
    publicVoice: trimText(item.publicVoice),
    // 声が無いのに観測済みと言わせない。文章が空なら必ず未観測扱い。
    voiceObserved: item.voiceObserved === true && Boolean(trimText(item.publicVoice)),
    claims: (Array.isArray(item.claims) ? item.claims : [])
      .slice(0, 6)
      .filter((c) => trimText(c?.claim) && ASSESSMENTS.has(c?.assessment))
      .map((c) => ({ claim: trimText(c.claim), assessment: c.assessment, note: trimText(c.note) })),
    sources,
  };
}

/** 書き起こされた広報案件1件の受け入れ検査。 */
function sanitizePRItem(item, index) {
  const headline = trimText(item?.headline);
  const origin = trimText(item?.origin);
  if (!headline || !origin) return null;

  return {
    id: `briefing-pr-${index + 1}`,
    headline,
    heatLevel: ['high', 'medium', 'low'].includes(item.heatLevel) ? item.heatLevel : 'low',
    badges: (Array.isArray(item.badges) ? item.badges : []).slice(0, 3).map(trimText).filter(Boolean),
    origin,
    intent: trimText(item.intent),
    observedCriticism: trimText(item.observedCriticism),
    potentialIssues: trimText(item.potentialIssues),
    separation: trimText(item.separation),
    officialNote: trimText(item.officialNote),
    secondarySpread: trimText(item.secondarySpread),
    communicationNote: trimText(item.communicationNote),
    // 広報案件は出典が無くても載せる（掲載物そのものが対象で、URLが無い媒体もある）
    sources: sanitizeSources(item.sources, undefined),
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

/**
 * 機械収集した記事を材料として渡す。
 *
 * 見出しだけを渡す。本文は持っていないし、渡せたとしてもトークンを食うだけで、
 * 裏取りは web_search でやらせる方が確実（記事の日付を本文で確認させるため）。
 */
export function materialsBlock(articles, limit = 80) {
  const list = (Array.isArray(articles) ? articles : []).slice(0, limit);
  if (list.length === 0) return '機械収集の材料はありません。検索だけで調査してください。';

  const lines = list.map((a, index) => {
    const date = a.pub_date ? String(a.pub_date).slice(0, 10) : '日付不明';
    const publisher = a.source ?? '媒体不明';
    return `${index + 1}. [${date}] ${publisher}｜${a.title ?? ''}`;
  });

  return [
    `機械収集した見出し ${list.length}件（材料。成果物ではありません）:`,
    ...lines,
    '',
    'この一覧は網羅ではなく、また大半は取り上げる価値がありません。',
    '全件に目を通し、取り上げるものだけを選び、裏を取って書き起こしてください。',
  ].join('\n');
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
  /** 機械収集した記事。材料として渡す。 */
  materials = [],
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
            materialsBlock(materials),
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
      sources: raw.sources ?? [],
      newsItems: raw.newsItems ?? [],
      prItems: raw.prItems ?? [],
      sentimentRows: raw.sentimentRows ?? [],
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
