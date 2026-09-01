# 行政・マイナ関連 モニタリングポータル

マイナ保険証・マイナンバー制度を中心に、トップニュース／世論、自治体・保険者の不具合、オン資・マイナポータル等の共通システム障害、医療機関・周辺IT／サイバー、行政広報・広告の状況を **一つの固定URLで横断** するための静的サイトです。

- サーバー・データベース不要。`data/current.json` と `data/archive/*.json` だけで動きます。
- React + TypeScript + Vite。`vite build` で静的ファイルを出力します。
- ルーティングはハッシュ方式（`#/incidents?category=common_system`）。静的ホスティングでも深いリンクが壊れません。

---

## 1. ローカル起動手順

前提：Node.js 20 以上（開発は v24.19.0 / npm 11 で確認）

```bash
npm install
```

```bash
npm run dev
```

`http://localhost:5173` が開きます。初期状態は **サンプルデータ** を表示し、画面上部に紫のバナーが出ます。

### 本番データで確認したい場合

```bash
VITE_DATA_SOURCE=live npm run dev
```

Windows PowerShell の場合：

```bash
$env:VITE_DATA_SOURCE="live"; npm run dev
```

---

## 2. ビルド手順

```bash
npm run build
```

- `tsc --noEmit`（型チェック）→ `vite build` の順で実行されます。
- 出力先は `dist/`。`dist/data/` と `dist/sample-data/` も一緒にコピーされます。

ビルド結果をローカルで確認：

```bash
npm run preview
```

### ビルド時に指定できる環境変数

| 変数 | 既定値 | 意味 |
|---|---|---|
| `VITE_DATA_SOURCE` | `sample` | `live` で `data/` を、それ以外で `sample-data/` を読み込む |
| `VITE_BASE_PATH` | `./` | サブディレクトリ配信時のベースパス（例 `/monitoring/`） |
| `VITE_DASHBOARD_QUIET_DAYS` | `7` | N日ルールの既定値（JSONの `settings` が優先） |
| `VITE_NEW_ITEM_HOURS` | `48` | 「新着」とみなす時間（同上） |
| `VITE_STALE_DATA_HOURS` | `26` | `generatedAt` がこれより古いと「更新が止まっている」警告を出す |
| `VITE_TIMEZONE` | `Asia/Tokyo` | 表示タイムゾーン |
| `VITE_ORGANIZATION_LABEL` | `行政・マイナ関連モニタリング` | Teams投稿文の見出しに使う名称 |

`.env.example` をコピーして `.env.local` を作ると開発時に反映されます。

**本番用ビルドの例：**

```bash
VITE_DATA_SOURCE=live VITE_BASE_PATH=/monitoring/ npm run build
```

---

## 3. 静的デプロイ手順

`dist/` をそのまま配信するだけです。サーバーサイドの書き換えルールは不要です。

### 3.1 共通の手順

1. `VITE_DATA_SOURCE=live` でビルドする
2. `dist/` の中身をホスティング先へコピーする
3. `dist/data/current.json` を日次更新フローの出力で上書きする

サブディレクトリ配信（例 `https://example.internal/monitoring/`）の場合は `VITE_BASE_PATH=/monitoring/` を付けてビルドしてください。

### 3.2 GitHub Pages（インターネット公開）

`.github/workflows/deploy.yml` が同梱されています。**`main` へ push すると自動でビルド・デプロイされます。**

初回のみリポジトリ側の設定が必要です。

1. GitHubでリポジトリを作成する（Public / Private のどちらでも可。Private は GitHub Pages が有料プラン限定）
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更する
3. `main` へ push する

公開URLは次のようになります。

| リポジトリ名 | 公開URL | ベースパス |
|---|---|---|
| `<org>.github.io` | `https://<org>.github.io/` | `/` |
| それ以外（例 `myna-monitoring-portal`） | `https://<org>.github.io/myna-monitoring-portal/` | `/myna-monitoring-portal/` |

ベースパスは `actions/configure-pages` が自動算出するため、**リポジトリ名を変えても設定変更は不要**です。

#### 公開するデータの切り替え

**現在の公開設定は `live`（本番データ）です。** リポジトリ変数 `DATA_SOURCE=live` が設定済みで、`public/data/` の内容が公開されます。

切り替えたい場合：

- 恒久的に変更：リポジトリの **Settings → Secrets and variables → Actions → Variables** で `DATA_SOURCE` を `live` / `sample` に変更
- 1回だけ試す：**Actions → Deploy to GitHub Pages → Run workflow** で `data_source` を選択

`sample` にするとサイト上部に紫のバナーが出て、Teams投稿文にも「サンプルデータでの出力です」が入ります。

#### 検索エンジンへのインデックス

`index.html` に `<meta name="robots" content="noindex,nofollow">` を入れてあります。**URLを知っている人は誰でも閲覧できますが、検索結果には出ません。**

本番データの公開に切り替えた現在も、既定では **検索非対象のまま** にしています。掲載内容には実在の自治体名・医療機関名・SNS投稿URLが含まれるため、検索流入を受け入れるかは掲載方針を決めてから判断してください。受け入れる場合はこの1行を削除して push すれば反映されます。

#### 公開前の確認事項

デプロイ前に GitHub Actions 側で `validate:data` → `typecheck` → `test` が実行され、いずれかが失敗するとデプロイされません。壊れたデータや空リンクが公開されることはありません。

Public リポジトリで公開する場合、**JSONの内容（自治体名・医療機関名・SNS投稿URL・投稿者ハンドル）もそのまま公開・検索対象になります。** 要件 10「SNS上の個人情報を必要以上に保存しない／公開投稿者名・ハンドルの掲載は必要性を確認」に沿って、公開前に `data/current.json` の内容を確認してください。

### 3.3 ホスティング別メモ

| ホスティング | 手順 |
|---|---|
| GitHub Pages | 上記 3.2。ワークフロー同梱 |
| 社内Webサーバー / IIS | `dist/` をドキュメントルート配下へコピー。書き換えルール不要 |
| SharePoint / ファイル共有 | `dist/` をフォルダごと配置。`VITE_BASE_PATH=./` のままで可 |
| Azure Static Web Apps | 出力先 `dist`、ビルドコマンド `npm run build` |
| S3 + CloudFront | `dist/` を同期。`index.html` を既定ドキュメントに設定 |

### 3.4 サーバー側で設定すべきヘッダー

`<meta>` では設定できないため、ホスティング側で付与してください。

```
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: frame-ancestors 'self'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Cache-Control: no-cache        # data/current.json に対して
```

社内公開時は、組織で承認されたSSO（リバースプロキシ or ホスティングの認証機能）を前段に置いてください。アプリ側の認証境界は `src/integrations/auth.ts` に切ってあります。

---

## 4. データ更新手順

**日次更新は自動化されています。通常あなたの作業は不要です。** 手を入れるのは、自動収集された案件に判断（要注視かどうか、事実関係の切り分け等）を書き足すときだけです。

### 4.1 ディレクトリ構成

```
public/
  data/
    curated.json         ← 【人が書く】判断を含む案件。自動処理は読むだけで書き換えない
    current.json         ← 【生成物】curated + 自動収集のマージ結果。サイトが表示する
    archive/YYYY-MM-DD.json ← 【生成物】前日分の退避
  sample-data/           ← サンプル。デモ・テスト専用
```

`current.json` は毎朝上書きされる生成物です。**手で編集しないでください**（翌朝の実行で消えます）。恒久的に残したい内容は `curated.json` に書きます。

サンプルと本番は **ディレクトリごと分離** されており `VITE_DATA_SOURCE` でしか切り替わりません。サンプル表示中は画面上部に紫のバナーが出て、Teams投稿文にも「サンプルデータでの出力です」が入ります。

### 4.2 自動更新の仕組み（毎朝 7:00 JST）

`.github/workflows/daily-update.yml` が `cron: '0 22 * * *'`（22:00 UTC = 翌 7:00 JST）で動きます。

```
① myna-news-jp が公開している news_latest.json を取得
     https://myna-news-jp.github.io/news_latest.json
     ※収集そのものは myna-news-jp に任せ、ここでは新たなスクレイパを作らない
② curated.json を読み、新着記事とマージ
③ 前日分を archive/ へ退避、generatedAt / reportDate を更新
④ データ検証 → 型チェック → テスト（失敗したらデプロイしない）
⑤ current.json をコミットし、ビルドして GitHub Pages へデプロイ
```

手動実行もできます（**Actions → Daily update and deploy → Run workflow**）。`dry_run` に `true` を選ぶと差分表示だけでコミット・デプロイしません。

ローカルで試す場合：

```bash
npm run update:data
```

#### 自動でやること／やらないこと

**自動でやること**

- 新着記事を「トップニュース」に追加（`status: 新着`、`reviewState: unreviewed`）
- 不具合・広報に該当しそうな記事へ **候補タグ**（例「不具合候補（自治体・保険者）」）を付与
- `curated.json` の案件に `matchKeywords` があれば、一致する記事を出典に追記。**既存の出典に無い媒体**が増えた場合のみ `lastMaterialUpdateAt` を更新（＝要件の「独立した追加報道」）
- 前日分のアーカイブ化、`generatedAt` の更新

**自動でやらないこと（判断が必要なため）**

- 不具合3カテゴリー・広報3分類への振り分け
- 「要注視」への昇格、炎上認定
- 事実関係・誤解の切り分け、国民の声、影響人数

**自動収集項目を不具合・広報レーンに入れない設計にしています。** 公開サイトで「○○市で不具合が発生」と誤って掲載する損害が大きく、キーワード判定では解説記事と実際の障害報道を確実に区別できないためです（例：「資格確認書の交付ルールはどう違う?」という解説記事が不具合に見える）。要件 9 も重要度大・炎上認定・個人情報/サイバーには公開前レビューを求めています。

自動項目は画面に **「⚑ 自動収集・未レビュー」** と明示され、重要度は最大でも「中」、状態は必ず「新着」です。

#### 収集元が落ちていた場合

`current.json` は `curated.json` の内容で生成され、**サイトは空になりません**。画面には赤いバナーで「データ更新に失敗しています／最終正常更新：○○」が表示されます。ワークフローは警告を出しますがデプロイは続行します。

### 4.3 人が判断を書き足す手順

自動収集された案件を正式な案件に昇格させるときの流れです。

1. サイトの「トップニュース」で「⚑ 自動収集・未レビュー」の案件を見る
2. 出典を確認し、掲載に値すると判断したら `public/data/curated.json` に項目を追記する
   - 不具合なら `incidents[]` へ（`incidentCategory` / `entityName` / `affectedCount` 等）
   - 広報なら `prItems[]` へ（`prClassification` / `active_stable` なら `stableSubtype` 必須）
   - 継続監視するなら `matchKeywords` を付けておくと、以後の追加報道が自動で出典に積まれます
3. コミットして push

```bash
npm run validate:data
```

```bash
git add public/data/curated.json && git commit -m "data: 案件を追加" && git push
```

push すると自動でビルド・デプロイされます。翌朝の自動実行でも `curated.json` の内容は保持されます。

### 4.4 日次の更新（手動で行う場合の考え方）

1. 朝レポート・不具合監視（9/12/15/18時）・広報ウォッチの結果を正規化する
   - 重複記事をまとめる
   - 同一通信社・系列の転載は `mediaPickupCount` に重複計上しない
   - 公式発表 / 報道 / SNS を `sources[].type` で分ける
   - 事実と推測を分ける（推測は `communicationRisks` へ）
   - 前日との差分を `dailyDiff` に書く
2. **重要更新があった案件だけ** `lastMaterialUpdateAt` を更新する
3. `public/data/current.json` を上書きする
4. 当日分を `public/data/archive/YYYY-MM-DD.json` にコピーし、`current.json` の `archive[]` に1行足す
5. 検証する

```bash
npm run validate:data
```

6. ビルドしてデプロイする

### 4.5 `lastMaterialUpdateAt` を更新してよい場合（重要更新の定義）

- 新しい公式発表
- 独立した追加報道（系列転載は含まない）
- 反応量の有意な増加
- 重要度・影響人数・対象範囲の変更
- 復旧、原因確定、謝罪、削除、中止

これ以外（表記ゆれの修正、リンクの張り替え等）では更新しないでください。更新するとN日ルールの起算点がずれ、沈静化した案件がダッシュボードに残り続けます。

### 4.6 検証スクリプト

```bash
npm run validate:data
```

```bash
node scripts/validate-data.mjs public/sample-data
```

依存パッケージなしで動きます。次を検査します。

- 必須項目（`id` / `title` / `status` / `severity` / `lastMaterialUpdateAt` / `sources`）
- 状態語彙（`new` `attention` `follow_up` `resolved` `planned_outage` `quiet` `archived` のみ）
- 出典URLが絶対http(s)であること（空・`#`・`javascript:` はエラー）
- `active_stable` に `stableSubtype` があること
- `incidentCategory` が3分類のいずれかであること
- id の重複

エラーが1件でもあると終了コード1を返すので、CIやデプロイ前フックに組み込めます。

### 4.7 訂正した場合

`corrections[]` に追記してください。案件単位（`news[].corrections`）とサイト全体（ルートの `corrections`）の両方に置けます。アーカイブ画面の「訂正履歴」表に新しい順で集約表示されます。

### 4.8 リンク切れが判明した場合

出典の `active` を `false` にしてください。リンクではなく「⚠ リンク切れのため参照できません」という注記として描画され、空リンクや `#` は生成されません。

---

## 5. 状態ラベル

曖昧な「WATCH」「継続」は使いません。

| 状態 | `status` | 意味 |
|---|---|---|
| 新着 | `new` | 原則48時間以内に新しく検知 |
| 要注視 | `attention` | 影響・反応・報道が拡大中、または即時確認が必要 |
| 続報待ち | `follow_up` | 未解消のまま推移しているが、直近では新しい拡大がない |
| 解消済 | `resolved` | 復旧、終了、訂正、回収等が確認できた |
| 計画停止 | `planned_outage` | 事前に公表されたメンテナンス |
| 沈静化 | `quiet` | 最終重要更新から所定日数、新しい動きがない |
| アーカイブ | `archived` | ダッシュボード非表示だが履歴として保持 |

色だけに依存しないよう、各ラベルに記号（◆▲◐●■○▤）を併記しています。

### N日ルール（既定7日）

- 基準は発生日ではなく `lastMaterialUpdateAt`
- 7日間重要更新がなければ **ダッシュボードから自動的に外す**
- 詳細ページ（`/news`, `/incidents`, `/pr`）とアーカイブには残る
- `pinned: true` の案件は日数に関係なく表示を続ける
- 日数は `settings.dashboardQuietDays` で変更可能

実装は [`src/lib/dashboardRules.ts`](src/lib/dashboardRules.ts) の純関数です。

---

## 6. 画面

| ルート | 画面 | 共有可能な深いリンクの例 |
|---|---|---|
| `#/` | ダッシュボード | `#/` |
| `#/news` | トップニュース・世論 | `#/news` |
| `#/incidents` | 不具合・エラー詳細 | `#/incidents?category=common_system` |
| `#/pr` | 広報・広告ウォッチ | `#/pr?classification=reported_backlash` |
| `#/archive` | アーカイブ | `#/archive` |

未定義パスは404画面になり、ダッシュボードとアーカイブへの導線を出します。

### 不具合の3カテゴリー

| 値 | 表示 |
|---|---|
| `local_government_insurer` | 自治体・保険者関連 |
| `common_system` | オン資・マイナポータル等の共通システム |
| `medical_it_cyber` | 医療機関・周辺IT／サイバー |

### 広報の3分類

| 値 | 表示 |
|---|---|
| `reported_backlash` | 二次転載・報道化まで拡大した炎上 |
| `active_watch` | 掲載中・要注視 |
| `active_stable` | 掲載中・安定／ポジティブ |

`active_stable` は `stableSubtype` で必ず区別します。

- `quiet` … **反応未検知**（大きな批判が確認できないだけ。ポジティブとは判定しない）
- `positive` … **好意的反応・効果を確認**（定量的に確認できた場合のみ）

---

## 7. 参照元リンクの扱い

要件で最も厳しい部分です。実装は [`src/lib/links.ts`](src/lib/links.ts) と [`src/components/common/ExternalLinkButton.tsx`](src/components/common/ExternalLinkButton.tsx) に集約しています。

- すべて実体のある `<a href>`。絶対http(s) URLのみ
- 外部リンクは必ず `target="_blank"` `rel="noopener noreferrer"`
- ボタンの矩形全体がアンカー。`pointer-events: auto`
- カード全体を覆う透明リンク・疑似要素・オーバーレイは作らない
- 状態ラベルは `<span>`（`cursor: default`、タブ移動不可、クリック不可）
- 文言は「一次情報を開く」「報道記事を開く」「X投稿を開く」のように明示。「詳細」は使わない
- 空の `href`、`javascript:void(0)`、`#` だけのリンクは生成しない（正規化時に弾く）
- リンク切れ（`active: false`）は注記として描画

これらは Vitest（`src/test/externalLinks.test.ts x`）と Playwright（`e2e/external-links.spec.ts`）の両方で検査しています。

---

## 8. 共有機能

- **共有URLをコピー** … 現在のハッシュURLをコピー（画面・タブ・絞り込みを含む）
- **Teams投稿文をコピー** … 日付・状態別の要点・データ基準時刻・固定URLを含む短いサマリを生成

### クリップボードが使えない環境への対応

企業の管理ブラウザでは `clipboard-write` がポリシーで拒否されることがあり、その場合はレガシーな `document.execCommand('copy')` も同時に失敗します。**コピー失敗は異常ではなく想定される結果**として扱い、失敗時は投稿文／URLを選択可能なダイアログ（[`CopyPanel`](src/components/common/CopyPanel.tsx)）で表示します。開いた時点で全選択されているため、そのまま `Ctrl+C` でコピーできます。

実装上の注意点（いずれも実機で踏んだ問題です）：

- フォールバック用の `<textarea>` に `opacity: 0` や `display: none` を付けると、Chrome は選択範囲のコピーを拒否します。画面上は目立たないが「描画されている」状態にする必要があります。
- `CopyPanel` は `document.body` へポータルします。`.topbar` の `backdrop-filter` が `position: fixed` の包含ブロックを作るため、トップバー内に描画するとオーバーレイがトップバーの矩形に閉じ込められます。
- Clipboard API は reject せずハングすることがあるため、1.5秒のタイムアウトを入れています。

### 改修要望の受け付け

画面左下に **「✎ 改修要望」** ボタンがあります。閲覧者が「ここが見にくい」「この情報が欲しい」を気軽に投稿するための導線です。

静的サイトには投稿を受けるサーバがないため、**GitHub Issue を受け皿**にしています。

```
左下のボタン → 画面内フォームに記入 → 「この内容で投稿画面を開く」
  → GitHub の新規Issue画面が開く（タイトル・本文は自動入力済み）
  → 投稿者は緑の「Submit new issue」を押すだけ
```

| 項目 | 内容 |
|---|---|
| フォームの項目 | こうしたい（必須）／対象画面／種別／今どうなっているか／理由／優先度／お名前（任意） |
| 自動記録 | URL、データ基準時刻、画面幅、投稿日時（表示崩れの再現に使う） |
| タイトル | `[改修要望] <対象画面>：<要望の先頭60字>` |
| ラベル | `改修要望` |
| 書きかけ | `localStorage` に自動保存。誤って閉じても消えない |
| 対象画面 | 開いている画面が自動で選ばれる（書きかけ復元時も現在の画面を優先） |

**投稿者にはGitHubアカウントが必要です。** アカウントを持たない方にも投稿してもらう場合は、`src/lib/feedback.ts` に `mailto:` 生成やテキストコピーの導線を足せます（`CopyPanel` が再利用できます）。

要望一覧：<https://github.com/myna-monitoring-jp/myna-monitoring-jp.github.io/issues?q=label%3A%E6%94%B9%E4%BF%AE%E8%A6%81%E6%9C%9B>

投稿先リポジトリは `VITE_FEEDBACK_REPO` で変更できます。

### Teamsへの自動投稿

MVPでは **行いません**。公開バンドルに認証情報を置けないためです。境界は [`src/integrations/notifier.ts`](src/integrations/notifier.ts) の `NotificationGateway` インターフェースとして切ってあり、将来、組織で承認されたワークフロー（資格情報はバックエンド側で保持）を実装して差し替えられます。

---

## 9. テスト

```bash
npm test
```

Vitest + Testing Library。210件。

| # | 要件のテスト項目 | ファイル |
|---|---|---|
| 1 | 7日ルール | `src/test/dashboardRules.test.ts`, `src/test/app.test.tsx` |
| 2 | pinned の表示継続 | 同上 |
| 3 | 状態フィルター | `src/test/filters.test.ts`, `src/test/app.test.tsx` |
| 4 | 3カテゴリー切替 | `src/test/app.test.tsx` |
| 5 | 広報3分類（反応未検知／ポジティブの区別を含む） | `src/test/app.test.tsx` |
| 6 | 外部リンクの href / target / rel | `src/test/externalLinks.test.tsx`, `e2e/external-links.spec.ts` |
| 7 | URLコピー（成功時・拒否時のフォールバック表示を含む） | `src/test/share.test.ts`, `src/test/app.test.tsx` |
| 8 | Teamsサマリ生成 | `src/test/teamsSummary.test.ts` |
| 9 | 空データ時表示 | `src/test/app.test.tsx` |
| 10 | 訂正履歴表示 | `src/test/app.test.tsx` |

追加で、データ正規化の頑健性（`src/test/normalize.test.ts`）、リンク判定（`src/test/links.test.ts`）、状態語彙の検査、404、リンク切れ表示、データ更新失敗表示も検査しています。

### E2E（任意）

ビルド済みサイトに対して外部リンク契約を検証します。初回のみブラウザの取得が必要です。

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

### 型チェック

```bash
npm run typecheck
```

---

## 10. ディレクトリ構成

```
myna-monitoring-portal/
├─ index.html                     エントリHTML（CSP設定を含む）
├─ vite.config.ts                 ビルド設定 + Vitest設定
├─ playwright.config.ts           E2E設定
├─ schema/
│  └─ monitoring-data.schema.json JSON Schema（型と1:1対応）
├─ scripts/
│  └─ validate-data.mjs           依存なしのデータ検証
├─ public/
│  ├─ data/                       本番データ
│  └─ sample-data/                サンプルデータ
└─ src/
   ├─ main.tsx                    HashRouter のマウント
   ├─ App.tsx                     データ読み込み + ルーティング
   ├─ config/appConfig.ts         設定値の一元管理
   ├─ types/monitoring.ts         型定義（データ契約）
   ├─ data/
   │  ├─ normalize.ts             JSON → 型。壊れた行は落として報告
   │  └─ loadMonitoringData.ts    fetch と失敗時の扱い
   ├─ lib/
   │  ├─ dashboardRules.ts        N日ルール・pinned・表示状態
   │  ├─ statusLabels.ts          全ラベル語彙
   │  ├─ links.ts                 リンク安全性
   │  ├─ filters.ts               検索・絞り込み・並び替え
   │  ├─ teamsSummary.ts          Teams投稿文とKPI集計
   │  ├─ share.ts                 共有URLとクリップボード
   │  └─ format.ts                日時・数値の整形
   ├─ integrations/
   │  ├─ notifier.ts              Teams通知の抽象化（MVPはモック）
   │  └─ auth.ts                  認証の抽象化（MVPはモック）
   ├─ components/
   │  ├─ layout/                  サイドバー・トップバー
   │  ├─ common/                  状態バッジ・外部リンク・絞り込み・トースト等
   │  ├─ news/                    ニュースカード・国民の声・事実確認
   │  ├─ incidents/               カテゴリータブ・不具合テーブル
   │  └─ pr/                      広報3列・広報カード
   ├─ routes/                     5画面 + 404
   └─ test/                       テストとフィクスチャ
```

---

## 11. 品質・非機能

- **レスポンシブ** … 1040px 以下でサイドバー→上部タブ、700px 以下で1カラム
- **キーボード操作** … 全操作要素にタブ移動可。カテゴリータブは左右矢印キー対応。「本文へスキップ」リンクあり
- **フォーカス表示** … `:focus-visible` で3pxのアウトラインを常時表示（`outline: none` を使わない）
- **色依存の回避** … 状態ラベルに記号と文字を併記
- **印刷** … サイドバー・ツールバーを非表示、カードの分断を防止、参照元リンクのURLを併記
- **404 / リンク切れ** … 404画面あり。リンク切れは注記化
- **最終更新時刻** … トップバーとフッターに `generatedAt` を表示
- **訂正履歴** … アーカイブ画面に集約表示、カード内にも表示
- **データ更新失敗** … 赤バナーで最終正常更新時刻を表示。26時間以上古い場合は黄バナー
- **SNSの注記** … 反応を表示するすべての箇所と、フッターに常時表示
- **セキュリティ** … フロントエンドに秘密情報を置かない。`rel="noopener"` 必須。CSP を `index.html` と（frame-ancestors は）サーバー側に設定

---

## 12. 権限（MVPの範囲）

| 権限 | MVP | 将来 |
|---|---|---|
| 閲覧者 | ○（全機能） | 同左 |
| 編集者 | ×（JSONを直接編集） | 編集画面・レビュー・承認 |
| 管理者 | ×（環境変数・JSONで設定） | ユーザー権限・データソース設定 |

`src/integrations/auth.ts` の `AuthProvider` / `canEdit` / `canAdminister` が接続点です。MVPは `MockAuthProvider` が常に閲覧者を返します。

---

## 13. 既知の制約

- 認証・Teams自動投稿はモック実装です（インターフェースのみ提供）
- 編集画面はありません。データ修正はJSONの直接編集です
- リンク切れの自動巡回チェックは含みません。`sources[].active` と `verifiedAt` を運用で更新してください
- 1年分程度の想定で、仮想スクロールは未実装です。件数が数千件規模になる場合はページネーションの追加を検討してください
