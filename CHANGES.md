# 変更点一覧（モック v3 → MVP）

## 0. 公開後の修正（2026-09-01）

### 本番データへ切り替え

`public/sample-data/` の内容（実在の一次情報・報道・SNS投稿URLを含む2026-09-01時点のモニタリング内容）を `public/data/` へ昇格し、`dataset` を `live` に変更。リポジトリ変数 `DATA_SOURCE=live` を設定し、公開サイトは本番データを表示。サンプルはデモ・テスト用として `sample-data/` に維持。サイト上部の紫バナー（サンプル表示中の警告）は消えます。

### 共有ボタンが無反応になる不具合の修正

**症状**: 公開サイトで「共有URLをコピー」「Teams投稿文をコピー」を押しても何も起きない。

**原因は2つ**でした。

1. 管理されたブラウザでは `clipboard-write` 権限がポリシーで拒否されます（実測：`permission = denied`、`writeText` は `NotAllowedError`）。ここまでは想定内でしたが、フォールバックの `document.execCommand('copy')` 用 `<textarea>` に **`opacity: 0`** を付けていたため、Chrome が選択範囲のコピーを拒否し、フォールバックも失敗していました。
2. 失敗時のトーストは「画面のテキストを手動でコピーしてください」と案内していましたが、**その「画面のテキスト」がどこにも表示されていませんでした**。コピーだけに依存した設計自体が誤りでした。

**修正内容**:

| 変更 | 内容 |
|---|---|
| フォールバックの `<textarea>` | `opacity: 0` を除去。画面上は目立たないが描画されている状態にし、`setSelectionRange` で明示選択 |
| 失敗時の代替手段 | `CopyPanel`（モーダルダイアログ）を追加。投稿文／URLを読み取り専用 textarea に全選択状態で表示し、`Ctrl+C` でコピーできるようにした |
| ダイアログの描画位置 | `document.body` へポータル。`.topbar` の `backdrop-filter` が `position: fixed` の包含ブロックを作るため、トップバー内に描画するとオーバーレイがトップバーの矩形に閉じ込められて位置が崩れていた |
| Clipboard API のハング | 1.5秒でタイムアウトしてフォールバックへ進むようにした（reject せず解決しないブラウザ実装への保険） |
| 生成時の例外 | `buildTeamsSummary` が失敗しても無反応にせず、理由をトーストで表示 |
| アクセシビリティ | `role="dialog"` `aria-modal`、Escape・背景クリック・閉じるボタンで閉じる、開閉時のフォーカス移動と復帰 |

修正後、公開サイトでの実クリックで**コピーが成功**するようになりました（`execCommand` 経路が機能するため）。コピーできない環境でも必ずダイアログで本文が得られます。

テストは 152件 → **158件**（フォールバック表示、全選択状態、3通りの閉じ方、タイムアウト、`opacity` 回帰防止を追加）。

---


添付の `index.html`（静的モック）と `SITE_REQUIREMENTS.md` を起点に、実行可能なMVPへ再構築しました。

---

## 1. 構成の変更

| 項目 | モック v3 | MVP |
|---|---|---|
| 実装 | 単一HTML＋インラインJS | React 18 + TypeScript + Vite |
| データ | HTMLへ直接ハードコード | `data/current.json` / `data/archive/*.json` |
| 画面切替 | `display:none` の切替＋`#dashboard` | `HashRouter` による5ルート |
| 深いリンク | 画面単位のみ | 画面＋タブ＋分類（`#/incidents?category=common_system`） |
| 型 | なし | `src/types/monitoring.ts` ＋ JSON Schema |
| テスト | なし | Vitest 152件 ＋ Playwright E2E |
| サンプル/本番 | 区別なし | `sample-data/` と `data/` をディレクトリごと分離 |

デザイン（配色トークン、Meiryo UI、サイドバー252px、カード／バケット／PR3列のレイアウト、印刷スタイル）はモックのCSSをそのまま踏襲しています。

---

## 2. 要件への対応で追加した機能

### 7日ルールの実装

モックでは文章で説明されているだけでした。MVPでは `src/lib/dashboardRules.ts` に純関数として実装しています。

- 基準は `lastMaterialUpdateAt`
- 日数は `settings.dashboardQuietDays`（既定7）で変更可能
- `pinned: true` で表示継続
- `dashboardVisible: false` で編集者による手動非表示
- ダッシュボードから外れた案件は詳細・アーカイブに残り、非表示の理由を文章で表示
- 7日経過した未解決案件は表示上「沈静化」に切り替わる（`resolved` / `planned_outage` / `archived` は書き換えない）

### 状態語彙の確定

モックには `s-quiet` を「詳細に保持」、`s-follow` を「反応観測中」と表示している箇所がありました。MVPでは `ItemStatus` の7語彙に統一し、`STATUS_META` を唯一の定義元にしています。凡例には7状態すべてを表示します。

`WATCH` は画面に出しません。`継続` はラベル・タグ・見出しに使いません（テストで検査）。モック由来の「継続監視」「調査継続中」といったサンプル文言も書き換えました。

### ニュースカードの必須項目

モックのカードはタイトル・要約・リンクのみでした。MVPでは7項目を構造化しています。

1. ニュース自体（タイトル／日時／何が新しいか／影響対象／重要度）
2. 国民の声・現場の声（チャネル・感情・代表投稿・反応数）
3. 事実関係・誤解の切り分け（事実／誤解／言い過ぎ／正当な制度論点／影響範囲の切り分け）
4. 出典・リンク（種類ラベル付き）
5. 定量情報
6. 前日差分（無い場合は「前日から変化なし」）
7. 最終重要更新日時

反応が無い場合は「新規の有意な反応は確認できず」を表示します。

### 「予測される批判」の分離

要件どおり、まだ観測されていない批判は国民の声に混ぜず、`communicationRisks` として別枠に出します。枠内に「予測。実際に観測された反応ではありません」と明記しています。

### 広報3分類と「反応未検知／ポジティブ」の区別

モックでは `stable` の2件が同じ見た目でした。MVPでは `stableSubtype` を必須にし、`quiet`（反応未検知）と `positive`（好意的反応・効果を確認）をバッジで区別します。`stableSubtype` が欠けているデータは `quiet` として扱い、データ品質バナーで警告します。

### 不具合の3カテゴリー

ARIA `tablist` として実装し、左右矢印キーで切り替えられます。タブ状態はURLに入るため、特定カテゴリーを共有できます。地域・種別（サイバー/非サイバー）・復旧有無・重要度・状態・並び順の絞り込みを追加しました。

### 共有機能

- 「共有URLをコピー」…モックは `location.href` をコピーするだけでしたが、MVPではハッシュに画面とタブ・分類が入るため、開いている状態がそのまま共有されます
- 「Teams投稿文をコピー」…モックはハードコードの固定文でした。MVPではデータから生成し、7日ルールを適用し、要注視を先頭に並べ、該当なしの場合は「確認なし」と明示します。サンプルデータ利用中・データ更新失敗中はその旨を先頭に入れます
- モバイル（700px以下）でも共有ボタンを表示するよう変更しました（モックでは非表示だった）

### 信頼性の表示

- `dataUpdate.state` に応じて、更新失敗（赤）／更新停滞（黄）／未投入（黄）のバナーを出し、**最終正常更新時刻** を必ず表示
- `generatedAt` が26時間以上古い場合は、ファイルが `ok` でも「停滞」として警告
- 訂正履歴をアーカイブ画面に集約表示。案件単位の訂正はカード内にも表示
- リンク切れ（`active: false`）は注記として描画

---

## 3. 参照元リンクの修正

モックには次の実装がありました。

```js
document.querySelectorAll('a[href^="http"]').forEach(a => {
  a.setAttribute('target','_blank');
  a.setAttribute('rel','noopener noreferrer');
  a.addEventListener('click', e => e.stopPropagation());
});
```

JavaScript実行後に属性を付与する方式のため、スクリプト実行前やJS無効時には保証されません。MVPでは `ExternalLinkButton` コンポーネントがレンダリング時点で属性を出力します。

その他の変更：

- 絶対http(s) URL以外（空文字・`#`・`javascript:`・相対パス・`data:`）はリンクとして描画せず、注記に落とす。正規化時にデータ品質バナーへ報告
- ボタン文言を `linkText` で明示。未指定時も種類から「一次情報を開く」等を導出し、「詳細」のような曖昧語を使わない
- リンク先ホスト名をボタン内に併記（外部遷移であることの視覚表示）
- `aria-label` に「（新しいタブで開きます）」を含める
- モックの `!important` の連打（`display:inline-flex!important` 等）をやめ、オーバーレイを作らない構造で担保
- 状態ラベルが `<a>` / `<button>` の内側に入らないことをテストで検査

---

## 4. アクセシビリティ・品質の追加

- 「本文へスキップ」リンク
- `:focus-visible` によるフォーカスリング（`outline: none` を使わない）
- 状態ラベルに記号（◆▲◐●■○▤）を併記し、色だけに依存しない
- すべての `<input>` / `<select>` にラベル
- 絞り込み結果件数を `aria-live` で通知
- テーブルに `<caption>` と `scope` 属性
- カテゴリータブのキーボード操作（左右矢印）
- 印刷時に参照元リンクのURLを併記
- `prefers-reduced-motion` に対応
- 404画面（未定義パス）

---

## 5. データモデルの変更

`sample-data.json` を型定義へ変換した際の主な追加・変更です。

| 変更 | 内容 |
|---|---|
| 追加 | `dataset`（sample/live）、`reportDate`、`dataUpdate`、`headline` |
| 追加 | `whatIsNew`, `audience`, `quantitativeMetrics`, `dailyDiff`, `communicationRisks`, `corrections` |
| 追加 | `surveys`（代表性のある世論調査）、`pulses`（SNSの論点）、`archive`、`timeline` |
| 変更 | `publicVoices[].type` → `channel`（旧 `type` も互換受付）。`sentiment` を追加 |
| 変更 | `sources[].linkText`, `publisher`, `verifiedAt`, `active`, `note` を追加 |
| 変更 | `incidents[].affectedCount` は `null` を「未公表」として扱い、`0` と区別。`affectedCountNote` を追加 |
| 変更 | `prItems[].stableSubtype` を `active_stable` で必須化 |
| 変更 | `dashboardVisible` は `null` を「N日ルールに委ねる」の意味に |
| 追加 | `settings.organizationLabel` |

JSON Schema（`schema/monitoring-data.schema.json`）と TypeScript 型（`src/types/monitoring.ts`）の両方を用意し、`scripts/validate-data.mjs` で依存なしに検証できるようにしました。

---

## 6. 抽象化した箇所（MVPはモック実装）

| 境界 | インターフェース | MVPの実装 |
|---|---|---|
| Teams通知 | `NotificationGateway` | `MockNotificationGateway`（`available: false`。送信内容を記録するのみ） |
| 認証 | `AuthProvider` | `MockAuthProvider`（常に閲覧者を返す） |

いずれも公開バンドルに秘密情報を置かないための措置です。差し替え点は `createNotificationGateway()` / `createAuthProvider()` の1箇所に集約しています。

---

## 7. 判断が必要だった点と、置いた初期値

要件に明記がなかった箇所は、以下の初期値を置いたうえで設定ファイル・JSONから変更できるようにしています。

| 論点 | 置いた初期値 | 変更方法 |
|---|---|---|
| ルーティング方式 | ハッシュルーティング | — （静的ホスティング前提のため固定） |
| 既定のデータソース | `sample` | `VITE_DATA_SOURCE=live` |
| データ停滞の警告しきい値 | 26時間 | `VITE_STALE_DATA_HOURS` |
| N日ルールの起算 | `lastMaterialUpdateAt` 未設定なら非表示（フェイルクローズ）＋理由表示 | — |
| 7日ちょうどの扱い | 7日「以上」で非表示（`>=`） | `settings.dashboardQuietDays` |
| 沈静化への状態書き換え | `resolved` / `planned_outage` / `archived` / `pinned` は書き換えない | — |
| `stableSubtype` 欠落時 | `quiet`（反応未検知）扱い＋警告 | データ側で明示 |
| 不正な `incidentCategory` | 自治体・保険者扱い＋警告 | データ側で修正 |
| ベースパス | `./`（相対） | `VITE_BASE_PATH` |
| モバイルでの共有ボタン | 表示する | — |

---

## 8. 検証結果

このリポジトリで実際に実行した結果です。

| コマンド | 結果 |
|---|---|
| `npm run typecheck` | エラーなし |
| `npm test` | 8ファイル / 152テスト すべて成功 |
| `npm run build` | 成功（`dist/` 出力、JS 224KB / gzip 75KB） |
| `node scripts/validate-data.mjs public/sample-data` | エラー0・警告0 |
| `node scripts/validate-data.mjs public/data` | エラー0・警告0 |
| ブラウザ表示確認 | 5画面すべて描画。深いリンク（`#/incidents?category=common_system`）、3カテゴリー切替、広報3列、モバイル表示（375px）を目視確認 |

`npm run test:e2e`（Playwright）はブラウザバイナリの取得（`npx playwright install chromium`）が必要なため、この環境では未実行です。設定とテストコードは同梱しています。
