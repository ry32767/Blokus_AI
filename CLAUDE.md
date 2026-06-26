# CLAUDE.md

このリポジトリ（**BlokusAI Duo**）で Claude Code が作業するときの指針です。**このファイルはワークスペース直下の `CLAUDE.md`（GeoSection / GPX アプリ向け）を上書きします** — ワークスペース版のルール上、リポジトリ直下のファイルが優先されます。GeoSection 固有の記述（`app.js` / `tests/run-tests.mjs` / `npm.cmd test = node --check app.js` / `web-design-guidelines` 等）は**このリポジトリには一切適用しません**。

## このプロジェクトの正体

- バニラ JavaScript（ESM）モノレポ ＋ Python(PyTorch) 自己対戦/学習パイプライン。
- 目的: **公式 Blokus Duo で世界ランカーに勝てる AI**。
- バンドラ/フレームワーク無し（React/Vite/Next/Tailwind 不使用）。ブラウザ推論は `onnxruntime-web`。

詳細・制約・報告フォーマットは [AGENTS.md](AGENTS.md) を正典とする。本ファイルはコマンドと最重要の注意点のみ。

## 実コマンド

```bash
npm test              # node scripts/test.mjs（core/web/training 全スイート）
npm run verify        # test → build → dist/ smoke
npm run build         # dist/ 生成
npm run lint          # no-op
npm run typecheck     # no-op
npm run dev           # node scripts/serve.mjs（http://localhost:4173）
npm run smoke:learning   # 学習の最小スモーク
npm run smoke:critical   # Critical Replay の最小スモーク
```

PowerShell で `npm.ps1` が止まる場合は `npm.cmd` を使う。存在しない script は実行しない。

## Python

- `scripts/run-python.mjs` 経由（`npm run train:policy` / `train:policy-value` / `export:onnx`）。
- Python 実体は環境変数 `BLOKUS_PYTHON` で指定。**cwd=リポジトリルート**で実行。
- `training/*.py` は兄弟モジュール import（`from blokus_shared import ...`）。これらを移動するとパス・import が壊れる。

## 最重要の注意点

- **`training/` のソース（`.mjs`/`.py`）を安易に移動しない**（相対 import 深度・`package.json` の script パス・`scripts/test.mjs` の import が直書き）。動かすなら全部直して `npm run verify`。
- **JS↔Python パリティ**（action 符号化・state encoder・開始マス）を崩さない。片方を変えたら両方変えて parity テストで確認。
- **公式開始マスは `(4,4)/(9,9)`**。ルールや encoder を変えたら既存 ONNX モデルは無効 → 再学習・再 export が必要。
- 詳しい設計とデータフローは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、現状評価と改善ロードマップは [docs/EVALUATION.md](docs/EVALUATION.md)。
