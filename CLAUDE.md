# CLAUDE.md

このリポジトリ（**BlokusAI Duo**）の作業規約・コマンド・検証ループ・ゲームルール・制約は、すべて [AGENTS.md](AGENTS.md) を**正典**とします。Claude Code もまず AGENTS.md に従ってください。

@AGENTS.md

> **このファイルはワークスペース直下の `CLAUDE.md`（GeoSection / GPX アプリ向け）を上書きします。** ワークスペースのルール上、リポジトリ直下のファイルが優先されます。GeoSection 固有の記述（`app.js` / `tests/run-tests.mjs` / `npm.cmd test = node --check app.js` / `web-design-guidelines` 等）はこのリポジトリには一切適用しません。

## Claude Code 固有の補足

- 技術スタック・コマンド・検証ループ・ゲームルール・Do-NOT は **AGENTS.md にのみ**置いています（ここでは再掲しません）。迷ったら AGENTS.md を参照。
- 実行環境は PowerShell。`npm.ps1` が実行ポリシーで止まる場合は `npm.cmd` を使ってください。
- 人間向けの概要・フォルダ構成・セットアップは [README.md](README.md)、設計は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、現状評価は [docs/EVALUATION.md](docs/EVALUATION.md)。
