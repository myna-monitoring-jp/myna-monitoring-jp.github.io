# マイナ関連リサーチ品質改善パッケージ

このフォルダは、`myna-monitoring-jp.github.io` の日次リサーチ品質を改善するためにClaude Codeへ渡す資料一式です。

## 最初に読むファイル

1. `RESEARCH_PIPELINE_SPEC.md`
2. `CLAUDE_CODE_UPGRADE_PROMPT.md`
3. `query_catalog.yml`
4. `source_registry.yml`
5. `event_schema.json`

## 重要な考え方

- 検索結果をそのまま要約しない
- 発見、一次情報確認、事象統合、差分、反応分析、ファクトチェック、執筆、QAを分ける
- SNSと全国世論を分ける
- 既存批判と新規広報起点の反応を分ける
- 記事数ではなく独立媒体数を数える
- マイナアプリ、マイナポータルAPI、オンライン資格確認等を混同しない
- 不明値は推測しない

## 現行サイトの扱い

Claude Codeは最初に現在のリポジトリを監査し、既存構造を壊さず段階的に改修してください。
