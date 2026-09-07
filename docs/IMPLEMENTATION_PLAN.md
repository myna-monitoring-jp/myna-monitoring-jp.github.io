# 実装計画

`docs/CURRENT_STATE_AUDIT.md` の差分一覧にもとづく移行計画。
既存構造を壊さず、段階的に置き換える。

---

## 0. 前提と制約

### 0.1 LLMは任意依存にする

仕様§3.3の指定どおり、`ANTHROPIC_API_KEY` があれば抽出に使い、
**無くても決定論的抽出で動く**構成にする。

理由：OpenAI 路線は中止になった。キーの有無で日次更新が止まる設計にはしない。
決定論的抽出でも、fetch した**本文**を根拠にできるため、
見出しだけを撫でていた現状より確実に良くなる（日付誤り・スニペット断定が消える）。

| 抽出内容 | キーなし（既定） | キーあり |
|---|---|---|
| 公開日・更新日 | `<time>` / OGP / JSON-LD / 本文の日付表記 | 同じ（機械抽出を優先） |
| 影響人数・件数 | 本文の数値表現＋修飾語（約・最大・可能性） | 文脈を見て対象範囲を判定 |
| 事象種別・システム層 | 語彙表による判定 | 同じ＋曖昧例の補正 |
| 要約・見出しの書き直し | 本文の先頭から抽出（引用的） | 書き直す |
| 事実関係の切り分け | 既知の論点表と照合 | 新しい論点も判定 |

キーなしでも仕様§23の受入基準のうち、執筆品質以外は満たせる。

### 0.2 SNS反応は自動化しない

実測で手段が無いことを確認済み（監査§5）。
`data/manual/public-voices.json` を人が置ける口だけ作り、
無ければ「新規の有意な反応は確認できず」と表示する。**生成はしない。**

### 0.3 既存データを壊さない

- `curated.json` は読むだけ（従来どおり）
- `public/data/archive/*.json` は削除せず、新スキーマへの変換は**別ファイル**へ出す
- 既存URL（`#/`, `#/news`, `#/incidents`, `#/pr`, `#/archive`, `#/collected`）を維持
- 変更前に `data/backup/` へ退避

---

## 1. Phase 1：土台（本ターンで実施）

| # | 作業 | 成果物 |
|---|---|---|
| 1.1 | 設定を `config/` へ移設し、YAMLを読めるようにする | `config/query_catalog.yml`, `config/source_registry.yml`, `config/app.yml` |
| 1.2 | `event_schema.json` を TS型 + 実行時検証へ | `src/types/research.ts`, `scripts/validate-events.mjs` |
| 1.3 | 検索ログ（JSONL） | `data/runs/YYYY-MM-DD/search-log.jsonl` |
| 1.4 | パイプラインを工程ごとに分離 | `src/pipeline/*.mjs` |

## 2. Phase 2：調査品質（本ターンで実施）

| # | 作業 | 要点 |
|---|---|---|
| 2.1 | **fetch工程**を新設 | 本文・最終URL・HTTPステータス・公開日時をキャッシュ付きで取得。失敗は `fetch_failed` で断定しない |
| 2.2 | 5パス検索 | Pass A 広域 / B 一次情報 / C 深掘り / D 反応 / E 前日クローズ。停止条件を実装 |
| 2.3 | extract | 本文から日付5種・数値・システム層・事象種別を決定論的に抽出 |
| 2.4 | cluster | `canonicalKey` = 主体＋事象種別＋発生日＋システム層。系列転載を独立媒体に数えない |
| 2.5 | verify | 一次情報を探し、`primarySourceConfirmed` を立てる。60点以上で不在ならレビュー必須 |
| 2.6 | diff | 前日スナップショットと比較して9種の差分ラベルを判定 |
| 2.7 | score | `impactScore` と `attentionScore` を別計算 |

## 3. Phase 3：出力（本ターンで実施）

| # | 作業 | 成果物 |
|---|---|---|
| 3.1 | 日別HTML | `public/reports/myna_news_YYYY-MM-DD.html` |
| 3.2 | QAゲート | `qa.mjs`。ブロッキングエラーで公開を止める |
| 3.3 | レビュー待ち | `data/review_queue.json`, `public/review/index.html` 相当の画面 |
| 3.4 | 訂正履歴 | 差分検知時に `corrections[]` を自動生成 |
| 3.5 | ワークフロー統合 | 二重デプロイの解消、Artifact保存 |

## 4. Phase 4：以降（本ターン対象外）

- 検索プロバイダーの差し替え（`SEARCH_PROVIDER`）。現状はGoogle News RSS固定
- 過去30日分の評価セットによる再現率・誤判定の改善
- SNS反応の自動取得（手段が出現した場合）
- Teams への自動投稿（組織承認が必要）

---

## 5. 工程の責務

```text
discover  検索してURL候補を出す。config/query_catalog.yml を読む。全クエリをログへ
fetch     候補URLの本文を取る。キャッシュ、リトライ、タイムアウト、PDF抽出
extract   本文から構造化事実を取る。推測しない。不明はnull
cluster   同一事象へ統合。系列転載を独立媒体に数えない
verify    一次情報を探す。公式と報道の食い違いを残す
reaction  手動投入の反応を読む。無ければ「確認できず」
diff      前日と比較して差分ラベルを付ける
score     impactScore と attentionScore を別に出す
compose   レポートJSONを組む
render    日別HTMLと current.json を書く
qa        公開してよいか判定する。ブロッキングエラーがあれば止める
publish   コミットとデプロイ（ワークフロー側）
```

各工程は入力と出力がJSONで、単独でテストできる。

---

## 6. データの置き場所

既存の `public/data/` は表示用として維持し、調査の中間生成物は `data/` に分ける。

```text
config/                     設定（人が編集する）
  query_catalog.yml
  source_registry.yml
  app.yml
data/                       調査の中間生成物（生成物。人は編集しない）
  runs/YYYY-MM-DD/
    search-log.jsonl        全クエリのログ
    fetched.jsonl           取得したページ
    extracted.jsonl         抽出結果
    clusters.json           事象統合結果
    qa-result.json          QA結果
  events/
    current.json            事象台帳
  manual/
    public-voices.json      人が投入するSNS反応（任意）
  review_queue.json         レビュー待ち
  backup/                   移行前の退避
public/data/                表示用（サイトが読む。従来どおり）
  curated.json              人が書く
  current.json              生成物
  archive/YYYY-MM-DD.json
public/reports/
  myna_news_YYYY-MM-DD.html 日別レポート
```

---

## 7. 追加する依存

| パッケージ | 用途 | 理由 |
|---|---|---|
| `yaml` | `config/*.yml` の読み込み | 渡された設定がYAML。自前パーサは壊れやすい |
| `ajv` + `ajv-formats` | `event_schema.json` の実行時検証 | draft 2020-12 + `$ref` + `format` を自前実装するのは誤りが出る |

いずれも **devDependencies**。ブラウザバンドルには入らない
（`src/pipeline/*.mjs` はアプリのエントリから import されないため Vite が取り込まない）。

---

## 8. テスト計画

`CLAUDE_CODE_UPGRADE_PROMPT.md` §テスト の15項目に対応させる。

| # | 項目 | 対応するテスト |
|---|---|---|
| 1 | 24h/72h時間窓 | `pipeline/discover` |
| 2 | 事象クラスタリング | `pipeline/cluster` |
| 3 | 系列転載の除外 | `pipeline/cluster` |
| 4 | 一次情報必須ルール | `pipeline/verify` |
| 5 | 既存批判とキャンペーン反応の分離 | `pipeline/diff` |
| 6 | 7日沈静化ルール | `dashboardRules`（既存） |
| 7 | pinned例外 | `dashboardRules`（既存） |
| 8 | 影響度・話題度の別計算 | `pipeline/score` |
| 9 | 計画停止と障害の分離 | `pipeline/extract` |
| 10 | システム層の分離 | `pipeline/extract` |
| 11 | SNS非代表注記 | 既存 + `render` |
| 12 | 全外部リンク属性 | `externalLinks`（既存）+ 日別HTML |
| 13 | 空リンク禁止 | 同上 |
| 14 | 日付・曜日検証 | `pipeline/qa` |
| 15 | 訂正履歴 | `pipeline/diff` |

---

## 9. 未確認事項（実装しつつ判断した初期値）

すべて設定ファイルで変更できるようにする。

| 項目 | 初期値 | 置き場所 |
|---|---|---|
| ダッシュボード沈静化日数 | 7 | `config/app.yml` |
| 一次情報必須の閾値 | `impactScore >= 60` | `config/app.yml`（`query_catalog.yml` の指定に一致） |
| fetch の同時実行数 | 4 | `config/app.yml` |
| fetch のタイムアウト | 20秒 | `config/app.yml` |
| キャッシュ保持 | 72時間 | `config/app.yml` |
| 1クエリの取得上位件数 | 8 | `config/query_catalog.yml`（指定済み） |
| 検索停止条件 | 重要新規なしが2パス連続 | `config/query_catalog.yml`（指定済み） |
| 日別レポート保持 | 400日 | `config/app.yml` |
