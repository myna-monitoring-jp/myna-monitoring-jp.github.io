# 現行実装の監査（2026-09-07）

`RESEARCH_PIPELINE_SPEC.md` §24 の10項目と `CLAUDE_CODE_END_TO_END_PROMPT.md` §2.1 に対する、
実測にもとづく回答。推測は書かず、確認方法を併記する。

---

## 1. 基盤構成

| 項目 | 実測値 |
|---|---|
| フレームワーク | Vite 5 + React 18 + TypeScript（`HashRouter`） |
| 実行時依存 | `react`, `react-dom`, `react-router-dom` のみ |
| ビルド | `tsc --noEmit && vite build` |
| GitHub Pages | Actions の `configure-pages` + `upload-pages-artifact` + `deploy-pages`（`build_type=workflow`） |
| ワークフロー | `ci.yml` / `daily-update.yml` / `deploy.yml` / `verify-openai-key.yml` |
| データ | `public/data/curated.json`（人が書く）→ `public/data/current.json`（生成物）＋ `public/data/archive/*.json` 10日分 |
| テスト | Vitest 325件（18ファイル）＋ Playwright `e2e/external-links.spec.ts` |
| パイプライン | `scripts/update-data.mjs`(693行) / `collect-official.mjs`(298行) / `collect-briefing.mjs`(725行) / `validate-data.mjs`(260行) |

秘密情報のフロントエンド露出：**なし**。`src/` 配下に API キーの参照はなく、
`collect-briefing.mjs` は Node 側でのみ `process.env.OPENAI_API_KEY` を読む。
`verify-openai-key.mjs` はキー本体をログへ出さない（長さと接頭辞4文字まで）。

---

## 2. 仕様§24の10項目への回答

### 2.1 どの検索サービス・API・スクレイピングを使っているか

検索APIは**未使用**。実際に使っているのは次の4系統。

| 系統 | 実装 | 件数 |
|---|---|---|
| 見出しフィード | `myna-news-jp` の `news_latest.json` を取得 | 50件/日 |
| Google News RSS | `scripts/sources.json` の `newsQueries` | 18クエリ |
| 官公庁 新着RSS | デジタル庁 / 厚労省 / 総務省 | 3本 |
| 稼働状況ページ | マイナポータルAPI（`【】`マーカー抽出） | 1本 |

**仕様との差分**：5パス（広域発見／一次情報探索／深掘り／反応／前日クローズ）の区別がない。
全クエリが「広域発見」相当で、Pass B〜E が存在しない。

### 2.2 公式サイトの定点取得があるか

**ある**（`rss` と `statusPages`）。ただし取得しているのは**見出しと概要だけ**で、
**本文取得（fetch工程）が存在しない**。これが現行の最大の欠陥。

確認方法：`collect-official.mjs` の `parseFeed` は `title` / `link` / `pubDate` / `description` のみ返す。
記事本文・PDF・公開日時の取得コードがない。

### 2.3 検索ログが残るか

**残らない。** `public/data/source-state.json` に稼働状況ページの fingerprint と
`checkedAt` があるだけ（0.1KB）。クエリ、実行時刻、プロバイダー、結果件数、採用URLの記録はない。

### 2.4 前日状態と比較しているか

**部分的。** `update-data.mjs` の `carryOver()` が前日の `current.json` を読み、
未レビュー項目を引き継ぎ・却下・保持期間切れ判定する。
`attachCoverage()` は新しい独立媒体が増えたときだけ `lastMaterialUpdateAt` を進める。

**差分ラベル（new / expanded / material_update / improving / resolved / unchanged /
reignited / correction / backfill）の自動判定はない。**
前日差分を出していたのは `collect-briefing.mjs` のLLM生成部分だけで、
これは外部APIキー依存であり、現在キーが無効なため動いていない。

### 2.5 記事単位か事象単位か

**記事単位。** 1記事＝1項目。`canonicalKey` は存在しない（実測：53件中0件）。

### 2.6 転載重複を除去しているか

**URLとタイトル正規化による同一性判定のみ。**

```js
// scripts/update-data.mjs
function normalizeTitle(title) { /* 記号除去・「 - 媒体名」除去 */ }
```

系列転載（FNN系列、共同・時事配信、PR TIMES転載、Yahoo!転載）を
同一事象へまとめる仕組みはない。`rawArticleCount` / `independentMediaCount` /
`majorMediaCount` / `syndicatedCount` は**いずれも未実装**（実測：0件）。

### 2.7 一次情報へ追跡しているか

**していない。** `isOfficialSource()` が URL/媒体名のドメインで公式かどうかを
判定するだけで、報道記事から公式発表を探しに行く処理はない。
`primarySourceConfirmed` は未実装（実測：0件）。

### 2.8 SNS反応の取得時点を保存しているか

型（`PublicVoice.observedAt`）は**ある**が、自動取得は**できない**。
2026-09-03 の実測で確認済み：App Store レビューフィードは0件返却、
X・Yahoo!コメントはAPIなし。`data/` の `publicVoices` は人が `curated.json` に書いたものだけ。

### 2.9 7日ルールが `lastMaterialUpdateAt` 基準か

**なっている。** `src/lib/dashboardRules.ts` が仕様どおり実装済み。

- 優先順位：`pinned` → 手動非表示 → `archived` → `lastMaterialUpdateAt` 欠落（fail closed）→ 経過日数
- 日数は `settings.dashboardQuietDays`（既定7）で変更可能
- `pinned=true` は表示継続
- 詳細・アーカイブには保持

実測：`lastMaterialUpdateAt` は53件中53件に存在。テスト `dashboardRules.test.ts` で検証済み。

### 2.10 HTMLリンクの自動テストがあるか

**ある。**

- Vitest `externalLinks.test.tsx` 32件：実href・`target="_blank"`・`rel="noopener noreferrer"`・
  空href/`#`/`javascript:` の不在・`pointer-events` の確認
- Playwright `e2e/external-links.spec.ts`：ビルド後のサイトに対して同等の検証

---

## 3. 仕様との差分一覧

| 仕様の要求 | 現状 | 差分の深刻度 |
|---|---|---|
| fetch工程（本文・PDF取得） | **なし**。見出しと概要のみ | **重大**。スニペットだけで項目を作っている |
| 5パス検索 | 1パス相当のみ | **重大** |
| 事象クラスタリング | なし | **重大** |
| 一次情報探索（verify） | なし | **重大** |
| 検索ログ（JSONL） | なし | 大 |
| 差分ラベル自動判定 | LLM依存で現在停止中 | 大 |
| `impactScore` / `attentionScore` 分離 | なし（`severity` 1軸のみ） | 大 |
| `event_schema.json` 準拠 | 独自 `MonitoringDataset`。`canonicalKey` 等が無い | 大 |
| 日別HTML `public/reports/myna_news_YYYY-MM-DD.html` | **ディレクトリごと無い** | 大 |
| レビュー待ち（`review_queue.json` / `public/review/`） | なし。`reviewState` フラグのみ | 中 |
| `occurredAt` / `updatedAt` の分離 | `occurredAt` 53件中9件、`updatedAt` 0件 | 中 |
| システム層の分離 | 3カテゴリーはあるが `systemLayer` フィールドなし | 中 |
| 訂正履歴 | 型と `ArchivePage` の表示はある。訂正を生む工程がない | 中 |
| 設定の外部化 | `scripts/sources.json` にあるが `config/` 配下ではない。YAML未対応 | 小 |
| 7日ルール | **実装済み** | なし |
| リンク自動テスト | **実装済み** | なし |
| 状態語彙（WATCH/継続の排除） | **実装済み**（`statusLabels.ts` に集約、テストで禁止語を検査） | なし |
| SNSと世論調査の分離 | **実装済み**（`PublicVoice` と `Survey` が別型・別UI） | なし |
| 予測批判の分離 | **実装済み**（`communicationRisks` が別フィールド） | なし |

---

## 4. 既知の品質問題とその原因

過去に実際に発生し、原因を特定したもの。再発防止のためテストを残している。

| 症状 | 原因 | 状態 |
|---|---|---|
| 概要に生のHTMLが表示された | 実体参照の復元をタグ落としの**後**に行っていた。Google News は二重エスケープ（`&amp;nbsp;`） | 修正済（`collectOfficial.test.ts`） |
| 政府広報の掲載物が参考情報に埋もれた | 候補タグ判定が媒体名を見ていなかった。表題に「広報」「広告」の語が入らない | 修正済（`updatePipeline.test.ts`） |
| 自治体の周知が1件も取れなかった | 収集器と `update-data` で期間フィルタを二重に適用。自治体はGoogle Newsの索引が10〜85日遅い | 修正済（`_ageChecked` 印） |
| 1年前の記事が上位に来る | 本文の日付を確認していない（fetch工程が無い） | **未解決**。本改修の対象 |
| 解説記事が不具合に見えた | キーワード判定では区別できない | 緩和済（自動項目を不具合レーンに入れない） |
| 共有URLが1文字で行き止まり | `404.html` に復帰処理がなかった | 修正済（`fallbackRoute.test.ts`） |

---

## 5. 取得できないと実測で確認済みの情報源

同じ調査を繰り返さないための記録。`scripts/sources.json` にも記載。

| 情報源 | 結果 |
|---|---|
| 外務省（`mofa.go.jp`） | ブラウザUAでも403 |
| 医療機関等向け総合ポータル | ServiceNow SPA。HTML本文は110字のみ |
| 政府広報オンライン RSS / 個人情報保護委員会 RSS | 404。ただし**Google News経由なら索引されている** |
| J-LIS | 403 |
| 自治体サイト（`lg.jp`） | RSSを持たない。Google News経由で取得 |
| App Store レビューフィード | 0件返却（実質廃止） |
| X / Yahoo!コメント | 無料のAPIなし |

**結論：SNS反応の自動取得は現時点で手段がない。** 仕様§11の値は人手投入を前提にする。

---

## 6. GitHub Actions の状態

| ワークフロー | 状態 |
|---|---|
| `daily-update.yml` | `cron: '0 22 * * *'`（07:00 JST）。直近10回は success |
| `deploy.yml` | push 時。直近は success |
| `ci.yml` | typecheck + test |
| `verify-openai-key.yml` | 手動。キー形式の確認のみ |

**二重デプロイの懸念**：`daily-update.yml` が自前で build/deploy し、
`deploy.yml` も push で発火する。`daily-update` のコミットが `deploy.yml` を起動するため、
同一内容のデプロイが連続する。`concurrency: group: pages` で直列化されており障害は出ていないが、
統合の余地がある（本改修で対応）。

**失敗時の挙動**：`Update data` は `continue-on-error: true`。
収集に失敗しても `current.json` は生成され、画面に「データ更新に失敗しています／最終正常更新」が出る。
既存の公開サイトは壊れない。
