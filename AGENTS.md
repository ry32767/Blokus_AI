# AGENTS.md

AI エージェント（Claude Code / Codex 等）がこのリポジトリで作業するときの**正典**です。前提・制約・コマンド・検証ループ・完了条件をここに集約します。作業前に必ず読んでください。

> このファイルは **BlokusAI Duo 専用**で、ワークスペース直下の汎用テンプレート（React/Vite/Next 前提）や別プロジェクト向けの記述には従いません。リポジトリ直下の本ファイルが最優先です。Claude 固有の補足のみ [CLAUDE.md](CLAUDE.md) にあります（本ファイルを `@AGENTS.md` で取り込むだけの薄いラッパ）。人間向けの概要・フォルダ構成・セットアップは [README.md](README.md) を参照。

---

## 1. Project Overview

- **Project**: BlokusAI Duo — ブラウザで動く 2 人対戦 Blokus Duo と、それを強くするための学習基盤。
- **目的（最重要）**: **公式ルールの Blokus Duo で世界ランカー（人間トップ）に勝てる AI** を作る。強さに直結しない変更より、ルール正当性・探索の正しさ・自己対戦学習の質を優先する。
- **構成**: バニラ JavaScript（ESM）のモノレポ ＋ Python(PyTorch) の自己対戦・学習パイプライン。バンドラ/フレームワークは無し（React / Vite / Next / Tailwind 不使用）。`./packages/...` `./apps/...` の相対パスで静的に読み込む。
- **ブラウザ推論**: `onnxruntime-web`。**ローカル自己対戦の推論**: `onnxruntime-node`（未導入時は web に自動フォールバック）。
- **ホスティング**: GitHub Pages（`dist/` を publish）。

設計の全体像は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、現状評価と世界ランカーへのロードマップは [docs/EVALUATION.md](docs/EVALUATION.md)。

---

## 2. ゲームルール（実装の正）

- 盤面 14×14、0-indexed。21 ピース／プレイヤー、生成済み 91 orientation。各プレイヤー総セル数 89。
- **開始マス（公式 Blokus Duo）**: A=`(4,4)` / B=`(9,9)`（盤内側のドット。**角ではない**）。定義は [packages/core/src/constants.js](packages/core/src/constants.js) と [training/blokus_shared.py](training/blokus_shared.py)（JS/Python 一致必須）。
- 初手は自分の開始マスを覆う。2 手目以降は自色と「角接触のみ可・辺接触は不可」。相手とは接触可。
- 合法手が無いときのみ pass。両者連続 pass か両者打てなくなれば終局。
- **スコア式**（[packages/core/src/scoring.js](packages/core/src/scoring.js)、高いほど良い）:
  `score = -(残りユニットマス数) + (全ピース配置で +15) + (最後に置いたのが I1 なら +5)`。
  → 1 プレイヤーのスコア域は概ね `[-89, +20]`、スコア差は約 `[-109, +109]`。

> ⚠️ 開始マスを過去の `(0,0)/(13,13)`（角・非公式変種）から公式 `(4,4)/(9,9)` に変更済み。**この変更以前に学習した ONNX モデル/データセットは無効**で、再生成・再学習・再エクスポートが必要。

action 符号化・state encoder の詳細な契約は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) と [docs/spec.md](docs/spec.md)。

---

## 3. Repository Structure

フォルダ構成の人間向け説明は [README.md](README.md) にある。エージェントが押さえるべき要点:

- `packages/core/` — ゲームモデルと共有エンコーダ（`rules.js`, `constants.js`, `scoring.js`, `board.js`, `action.js`, `orientation.js`, `stateEncoding.js`, `generatedOrientations.js`, `index.js`）＋ `tests/`。**安定した土台。むやみに動かさない。**
- `apps/web/` — ブラウザアプリ。`src/main.js`（UI）、`src/ai/`（探索/学習 AI エンジン群）、`src/workers/`（Web Worker プロトコル）、`public/`（`models/`・`vendor/onnxruntime-web/`）、`tests/`。
- `training/` — Node 製の自己対戦・アリーナ・リプレイバッファ・モデルレジストリ・AlphaZero ループ（`*.mjs`）＋ Python トレーナ（`*.py`）＋ `critical_state_replay/`（重要局面再生）＋ `native/`（Rust 自己対戦エンジン）。
- `scripts/` — 自作の build/test/verify/serve/run-python など。
- `docs/` — 設計・運用ドキュメント（下記索引）。

### AI 難易度

`easy` / `normal`（ヒューリスティック）、`hard`（ビームサーチ）、`expert` / `expert_plus`（ヒューリスティック＋αβ＋ negamax 木探索＋終盤厳密解）、`learned`（PolicyNet 単体）、`master`（policy-value 誘導 PUCT MCTS ＋終盤探索）。

### docs 索引（各トピックの正典は 1 箇所）

| ドキュメント | 役割（このトピックの正典） |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | システム構成・データフロー・encoder/状態テンソルの設計 |
| [docs/EVALUATION.md](docs/EVALUATION.md) | 現状評価・確定した修正・世界ランカーへのロードマップ |
| [docs/TRAINING_WORKFLOW.md](docs/TRAINING_WORKFLOW.md) | 学習の手順・出力レイアウト・観戦・公開モデル更新（**手順の正典**） |
| [docs/TRAINING_OPTIONS.md](docs/TRAINING_OPTIONS.md) | 学習系 CLI の全オプション・既定値（**フラグの正典**） |
| [docs/spec.md](docs/spec.md) | Critical State Replay の契約・dataset 形式・受け入れ条件 |
| [docs/NATIVE_SELFPLAY.md](docs/NATIVE_SELFPLAY.md) | ネイティブ（Rust）自己対戦エンジンの設計・パリティ契約 |

---

## 4. Commands

`package.json` の script のみを使う（PowerShell で `npm.ps1` が止まる場合は `npm.cmd`）。**コア:**

```bash
npm test            # node scripts/test.mjs — core / web / training の全スイート
npm run verify      # test → build → dist/ の smoke check
npm run build       # dist/ を生成（静的コピー）
npm run dev         # node scripts/serve.mjs（既定 http://localhost:4173）
npm run lint        # 現状 no-op
npm run typecheck   # 現状 no-op
```

**学習・自己対戦**: 手順は [docs/TRAINING_WORKFLOW.md](docs/TRAINING_WORKFLOW.md)、各コマンドの全オプションは [docs/TRAINING_OPTIONS.md](docs/TRAINING_OPTIONS.md) を参照（本ファイルではフラグを再掲しない）。入口は `npm run train:full`（`-- --phase1` / `-- --phase2` / `-- --smoke`）。観戦は `npm run view:selfplay`。

**Python**: `scripts/run-python.mjs` 経由（`npm run train:policy` / `train:policy-value` / `export:onnx` / `export:onnx:pv`）。Python 実体は環境変数 `BLOKUS_PYTHON` で指定、**cwd=リポジトリルート**で実行され、`training/*.py` は**兄弟モジュール import**（`from blokus_shared import ...`）。

**ネイティブ（Rust）**: `npm run parity:golden`（ゴールデン基準生成）／ `npm run native:test`（パリティ検証）／ `npm run native:selfplay`。Rust ツールチェーンが必要。

---

## 5. エージェント向けの重要な制約（Do NOT）

- **`training/` のソース（`*.mjs` / `*.py`）を安易に移動しない。** 多くが深さ依存の相対 import（`../packages`, `../apps`, `critical_state_replay/` は `../../`）を使い、`package.json` の複数 script と `scripts/test.mjs` の import がパスを直書きしている。移動する場合は import 深度・全 script パス・`scripts/test.mjs` を同時に直し、必ず `npm run verify` を通す。クラスタ単位で移動し、半端な状態で止めない。
- **JS↔Python パリティ**: action 符号化・状態エンコーダ・開始マスは両言語で完全一致が前提。片方を変えたら必ずもう片方も変え、`npm test` の parity テストで確認する。
- **モデル再学習**: ルール（開始マス等）や state encoder を変えたら、既存 ONNX は無効。再学習→`export:onnx`→`apps/web/public/models/` 更新が必要。
- **探索エンジンの符号規約**: MCTS は negamax（各ノードの値は「その局面の手番側」視点、逆伝播で ply ごとに 1 回符号反転）。価値の二重反転・相手手番の非反転はバグなので踏襲しない。
- **ネイティブ出力のゲート**: Rust 自己対戦エンジン（`training/native/`）の出力を学習に流すのは、`npm run native:test`（golden パリティ）が緑になってから。未検証のネイティブ JSONL を学習に使わない。
- **公開モデルを勝手に上書きしない**: `apps/web/public/models/*.onnx` の差し替えは、納得のいく候補を `export:onnx:pv -- --out ...` で明示出力したときだけ。スモーク/お試しは `training/.scratch/` に出す。

---

## 6. Testing and Verification（検証ループの正典）

変更後は可能な範囲で以下を実行し、結果を報告する。

```bash
npm test            # 最初に必ず
npm run verify      # build smoke まで通すとき
```

- **Python を変えた場合**: `npm run smoke:learning`（学習）/ `npm run smoke:critical`（Critical Replay）、または小さなデータセットで `train_policy_value.py` を 1 epoch CPU で回して通ることを確認する。
- **ネイティブ（Rust）を変えた場合**: `npm run native:test`（パリティ）。Rust ツールチェーンが無い環境では実行できない旨を明記する。
- 存在しないコマンドは実行せず、その旨を明記する。

---

## 7. Core Rules（作業マナー）

- 既存の設計・命名・構成を尊重し、依頼範囲に集中する。大規模リファクタは明示要求時のみ。
- 破壊的変更・データ削除・セキュリティ判断・公式ルール変更は事前に確認する。
- 秘密情報をコミット/出力しない。`git push` / PR / デプロイ / `main` へのマージはユーザーの明示要求があるまで行わない。
- 軽微な判断は自律的に行ってよい。最後に変更・検証・残課題を報告する。

---

## 8. Final Response Format

```md
## Summary
- 変更内容

## Verification
- `npm test`: passed / failed / not run
- `npm run verify`: passed / failed / not run
- Python smoke / native:test: passed / not run

## Notes
- 残課題 / 注意点 / 次にやるとよいこと
```

実行できなかった確認項目は理由を明記する。
