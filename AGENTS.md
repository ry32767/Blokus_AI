# AGENTS.md

AI エージェント（Claude Code / Codex 等）がこのリポジトリで作業するときの前提・制約・確認手順・完了条件を定義します。作業前に必ず読んでください。

> このファイルは **BlokusAI Duo 専用**です。ワークスペース直下の汎用テンプレート（React/Vite/Next を前提にしたもの）や、別プロジェクト（GeoSection）向けの `CLAUDE.md` の記述は、**このリポジトリには適用しません**。リポジトリ直下の本ファイルと [CLAUDE.md](CLAUDE.md) を優先してください。

---

## 1. Project Overview

- **Project**: BlokusAI Duo — ブラウザで動く 2 人対戦 Blokus Duo と、それを強くするための学習基盤。
- **目的（最重要）**: **公式ルールの Blokus Duo で世界ランカー（人間トップ）に勝てる AI** を作ること。強さに直結しない変更より、ルール正当性・探索の正しさ・自己対戦学習の質を優先する。
- **構成**: バニラ JavaScript（ESM）のモノレポ ＋ Python(PyTorch) の自己対戦・学習パイプライン。
- **バンドラ/フレームワークは無し**。React / Vite / Next / Tailwind 等は使っていない。`./packages/...` `./apps/...` の相対パスで静的に読み込む。
- **ブラウザ推論**: `onnxruntime-web`（`apps/web/public/vendor/onnxruntime-web/`）。
- **ホスティング**: GitHub Pages（`dist/` を publish）。

---

## 2. ゲームルール（実装の正）

- 盤面 14×14、0-indexed。21 ピース／プレイヤー、生成済み 91 orientation。
- **開始マス（公式 Blokus Duo）**: A=`(4,4)` / B=`(9,9)`（盤内側のドット。**角ではない**）。定義は [packages/core/src/constants.js](packages/core/src/constants.js) と [training/blokus_shared.py](training/blokus_shared.py)（JS/Python で一致必須）。
- 初手は自分の開始マスを覆う。2 手目以降は自色と「角接触のみ可・辺接触は不可」。相手とは接触可。
- 合法手が無いときのみ pass。両者連続 pass か両者打てなくなれば終局。
- **スコア式**（[packages/core/src/scoring.js](packages/core/src/scoring.js)、高いほど良い）:
  `score = -(残りユニットマス数) + (全ピース配置で +15) + (最後に置いたのが I1 なら +5)`。
  → 1 プレイヤーのスコア域は概ね `[-89, +20]`、スコア差は約 `[-109, +109]`。

> ⚠️ 開始マスを過去の `(0,0)/(13,13)`（角・非公式変種）から公式 `(4,4)/(9,9)` に変更済み。**この変更以前に学習した ONNX モデル/データセットは無効**で、再生成・再学習・再エクスポートが必要。

---

## 3. Repository Structure

- `packages/core/` — ゲームモデルと共有エンコーダ（`rules.js`, `constants.js`, `scoring.js`, `board.js`, `action.js`, `orientation.js`, `stateEncoding.js`, `generatedOrientations.js`, `index.js`）＋ `tests/`。**安定した土台。むやみに動かさない。**
- `apps/web/` — ブラウザアプリ。`src/main.js`（UI）、`src/ai/`（探索/学習 AI エンジン群）、`src/workers/`（Web Worker プロトコル）、`public/`（`models/`・`vendor/onnxruntime-web/`）、`tests/`。
- `training/` — Node 製の自己対戦・アリーナ・リプレイバッファ・モデルレジストリ・AlphaZero ループ（`*.mjs`）＋ Python トレーナ（`*.py`）＋ `critical_state_replay/`。
- `scripts/` — 自作の build/test/verify/serve/run-python など。
- `docs/` — 設計・運用ドキュメント（[spec](docs/spec.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [EVALUATION](docs/EVALUATION.md), [TRAINING_RUNBOOK](docs/TRAINING_RUNBOOK.md), [TRAINING_OPTIONS](docs/TRAINING_OPTIONS.md), [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md), [DEPLOYMENT_NOTE](docs/DEPLOYMENT_NOTE.md)）。

AI 難易度: `easy` / `normal`（ヒューリスティック）、`hard`（ビームサーチ）、`expert` / `expert_plus`（ヒューリスティック＋αβ＋ negamax 木探索＋終盤厳密解）、`learned`（PolicyNet 単体）、`master`（policy-value 誘導 PUCT MCTS ＋終盤探索）。

---

## 4. Commands

`package.json` の script のみを使う（PowerShell で `npm.ps1` が止まる場合は `npm.cmd`）。

```bash
npm test            # node scripts/test.mjs — core / web / training の全スイート
npm run verify      # test → build → dist/ の smoke check
npm run build       # dist/ を生成（静的コピー）
npm run lint        # 現状 no-op
npm run typecheck   # 現状 no-op
npm run dev         # node scripts/serve.mjs（既定 http://localhost:4173）
```

学習・自己対戦は `npm run generate:dataset` / `selfplay:loop` / `alphazero:loop` / `cycle:learned` 等（正確なパスは `package.json`、手順は [docs/TRAINING_RUNBOOK.md](docs/TRAINING_RUNBOOK.md)、全オプションは [docs/TRAINING_OPTIONS.md](docs/TRAINING_OPTIONS.md)）。

Python は `scripts/run-python.mjs` 経由（`npm run train:policy` / `train:policy-value` / `export:onnx`）。Python 実体は環境変数 `BLOKUS_PYTHON` で指定、**cwd=リポジトリルート**で実行され、`training/*.py` は**兄弟モジュール import**（`from blokus_shared import ...`）。

---

## 5. エージェント向けの重要な制約

- **`training/` のソース（`*.mjs` / `*.py`）を安易に移動しない。** 多くが深さ依存の相対 import（`../packages`, `../apps`, `critical_state_replay/` は `../../`）を使い、`package.json` の約 7 個の script と `scripts/test.mjs` の 6 個の import がパスを直書きしている。移動する場合は import 深度・全 script パス・`scripts/test.mjs` を同時に直し、必ず `npm run verify` を通す。クラスタ単位で移動し、半端な状態で止めない。
- **JS↔Python パリティ**: action 符号化・状態エンコーダ・開始マスは両言語で完全一致が前提。片方を変えたら必ずもう片方も変え、`npm test` の parity テストで確認する。
- **モデル再学習**: ルール（開始マス等）や state encoder を変えたら、既存 ONNX は無効。再学習→`export:onnx`→`apps/web/public/models/` 更新が必要。
- **探索エンジンの符号規約**: MCTS は negamax（各ノードの値は「その局面の手番側」視点、逆伝播で ply ごとに符号反転）。価値の二重反転・相手手番の非反転はバグなので踏襲しない。

---

## 6. Testing and Verification

変更後は可能な範囲で以下を実行し、結果を報告する。

```bash
npm test
npm run verify   # 必要に応じて
```

Python を変えた場合は `npm run smoke:learning` / `npm run smoke:critical`、または小さなデータセットで `train_policy_value.py` を 1 epoch CPU で回して通ることを確認する。存在しないコマンドは実行せず、その旨を明記する。

---

## 7. Core Rules（作業マナー）

- 既存の設計・命名・構成を尊重し、依頼範囲に集中する。大規模リファクタは明示要求時のみ。
- 破壊的変更・データ削除・セキュリティ判断・公式ルール変更は事前に確認する。
- 秘密情報をコミット/出力しない。`git push` / PR / デプロイはユーザーの明示要求があるまで行わない。
- 軽微な判断は自律的に行ってよい。最後に変更・検証・残課題を報告する。

---

## 8. Final Response Format

```md
## Summary
- 変更内容

## Verification
- `npm test`: passed / failed / not run
- `npm run verify`: passed / failed / not run
- Python smoke: passed / not run

## Notes
- 残課題 / 注意点 / 次にやるとよいこと
```

実行できなかった確認項目は理由を明記する。詳細な背景は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) と [docs/EVALUATION.md](docs/EVALUATION.md) を参照。
