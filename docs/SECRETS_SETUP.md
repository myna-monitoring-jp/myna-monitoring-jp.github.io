# Secrets と環境変数

**このサイトは Secrets が1つも設定されていなくてもビルド・公開できます。**
公式RSS・定点観測URL・Google News RSS はいずれもキーを必要としません。

Secrets は品質を上げるための任意の追加であり、必須ではありません。

---

## 1. 任意の Secrets

| 名前 | 場所 | 用途 | 未設定時の挙動 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Settings → Secrets → Actions | 抽出・要約の品質向上 | 決定論的抽出で動く。日付・数値・システム層の判定はキーの有無に関わらず機械抽出 |

`OPENAI_API_KEY` は**不要になりました**。OpenAI 路線は中止し、
朝の状況判断は調査パイプライン（`scripts/run-research.mjs`）が担っています。
古い Secret が残っている場合は削除してください。

## 2. 任意の Variables

| 名前 | 場所 | 既定値 | 用途 |
|---|---|---|---|
| `DATA_SOURCE` | Settings → Variables → Actions | `live` | `sample` にするとデモデータで公開する |

## 3. ローカル実行

```bash
npm ci
npm run research          # 調査パイプライン
npm run validate:events   # event_schema.json に対する検証
npm run validate:data     # 表示用データの検証
npm test
```

環境変数で挙動を変えられます。

| 変数 | 既定 | 用途 |
|---|---|---|
| `DRY_RUN=1` | – | ファイルを書かずに結果だけ表示 |
| `MAX_FETCH=n` | 80 | 本文を取得するページ数の上限 |
| `RESEARCH_OUT_DIR` | `.` | 出力先の基点 |
| `CONFIG_DIR` | `config` | 設定の場所 |

## 4. 秘密情報の扱い

- APIキーはフロントエンドへ埋め込みません。`src/pipeline/*.mjs` はアプリのエントリから
  import されないため、Vite のバンドルに入りません
- キーをログ・JSON・HTMLへ出力しません
- `scripts/verify-openai-key.mjs` は形式と接頭辞4文字までしか出力しません
  （過去に GitHub のトークンが誤って登録され、気づくのが遅れたため残しています）

## 5. Teams 共有

MVPでは自動投稿しません。サイト上の「Teams投稿文をコピー」「共有URLをコピー」を使います。

自動投稿する場合は組織で承認された Webhook が必要です。未設定でもサイト公開は失敗させません。
