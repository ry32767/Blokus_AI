# BlokusAI Duo

GitHub Pages で公開できる、2 人制 **公式 Blokus Duo** の静的 AI 対戦アプリと、その AI を強くするための自己対戦・学習パイプラインです。

**目的は「公式 Blokus Duo で世界ランカー（人間トップ）に勝てる AI」を作ること。** ブラウザでは探索型 AI と学習済みモデル（ONNX）を使い、`training/` の Node + Python(PyTorch) パイプラインで自己対戦・学習を回します。

- 現状評価と世界ランカーへのロードマップ → [docs/EVALUATION.md](docs/EVALUATION.md)
- 全体設計とデータフロー → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 学習の進め方 → [docs/TRAINING_WORKFLOW.md](docs/TRAINING_WORKFLOW.md)
- エージェント（Claude Code / Codex 等）向けの作業規約 → [AGENTS.md](AGENTS.md)

> ⚠️ 開始マスを公式の `(4,4)/(9,9)`（盤内側のドット。角ではない）に変更したため、**過去に学習した ONNX モデル/データセットは無効**です。再生成・再学習・再 `export:onnx` が必要です（それまで `learned`/`master` は旧変種の重みで動くため、再学習を推奨）。

## できること

対応モード: **Human vs Human** / **Human vs AI** / **AI vs AI**。

- 14×14 盤面、21 ピース／プレイヤー、91 orientation、公式スコア式 `-(残りマス) +15(全配置) +5(最後がI1)`
- 公式開始マス `(4,4)` / `(9,9)`、合法手生成・強制 pass・終局判定
- 探索型 AI: `easy` / `normal`（ヒューリスティック）、`hard`（ビームサーチ）、`expert` / `expert_plus`（ヒューリスティック＋αβ＋終盤厳密解）
- 学習型 AI: `learned`（PolicyNet 単体）、`master`（policy-value 誘導 PUCT MCTS ＋終盤探索）
- 棋譜 JSON の copy / load、GitHub Pages 用の静的 build

## フォルダ構成

```
Blokus_AI/
├── apps/web/                 ブラウザアプリ
│   ├── src/
│   │   ├── main.js              UI / 入力 / 盤面描画
│   │   ├── ai/                  AI エンジン群（heuristic / beam / mcts / expert / policy-value / learned）
│   │   └── workers/             Web Worker プロトコル（INIT / THINK / CANCEL）
│   └── public/
│       ├── models/              *.onnx（学習成果。ブラウザが読む）
│       └── vendor/onnxruntime-web/   ブラウザ推論ランタイム
├── packages/core/            ゲームモデルと共有エンコーダ（唯一の真実）
│   └── src/                     rules / constants / scoring / action / orientation / stateEncoding ...
├── training/                 自己対戦・学習パイプライン
│   ├── *.mjs                    Node 製の自己対戦・アリーナ・replay buffer・registry・AlphaZero ループ
│   ├── *.py                     Python(PyTorch) トレーナ・ONNX export
│   ├── critical_state_replay/   重要局面の分岐再生によるデータ生成
│   └── native/                  Rust 製ネイティブ自己対戦エンジン（高速化・任意）
├── scripts/                  build / test / verify / serve / run-python など
├── docs/                     設計・学習・評価ドキュメント
├── index.html                アプリのエントリ
└── dist/                     build 成果物（GitHub Pages 公開対象）
```

バンドラ/フレームワークは使わず（React / Vite / Next / Tailwind 不使用）、`./apps/...` `./packages/...` の相対パスで静的に読み込みます。

## セットアップと起動

```bash
npm install
npm run dev        # 開発サーバ（既定 http://localhost:4173。$env:PORT=3000 で変更可）
npm run build      # dist/ を生成
npm test           # core / web / training の全スイート
```

> 検証ループ（`npm run verify` の内訳）・テスト項目の詳細・Do-NOT は、エージェント向け正典の [AGENTS.md](AGENTS.md) にまとめています。

## 世界ランカーに勝つための学習（プルしてそのまま回す手順）

リポジトリをプルした人が強い AI を育てるための最短手順です。学習は **AlphaZero ループ**（`master` 自己対戦 → policy-value ネット学習 → 候補を現役 best と対戦させ、強くなっていれば SPRT で昇格）。多反復まわすほど強くなります。GPU 推奨。**詳細・全オプションは [docs/TRAINING_WORKFLOW.md](docs/TRAINING_WORKFLOW.md) と [docs/TRAINING_OPTIONS.md](docs/TRAINING_OPTIONS.md)。**

```bash
# 0) 準備（GPU PyTorch。CPU だけなら python:install:cpu）
npm install
npm run python:install:gpu
npm run python:check          # 環境確認

# 1) 全経路のドライラン（数分・CPU）。warm-up→bootstrap→学習→SPRT→resume を検証
npm run train:full -- --smoke

# 2) Phase 1: コールドスタート warm-up（強い探索 AI の自己対戦 → 初期ネットを best-0 として bootstrap。最初に一度だけ）
npm run train:full -- --phase1

# 3) Phase 2: 本番の自己対戦ループ（best から master 自己対戦 ＋ SPRT 昇格、多反復。中断したら同じコマンドで再開）
npm run train:full -- --phase2

# 4) 学習の様子を見る / 納得のいく best をブラウザ公開モデルへ反映
npm run view:selfplay -- --summary training/runs/full/runs/<iter>/checkpoints/train_summary.json
npm run export:onnx:pv -- --checkpoint training/runs/full/model_registry/<best>/policy_value_best.pt --out apps/web/public/models/blokus_policy_value.onnx
npm run verify
```

> Phase 1 → Phase 2 を一括で回すなら引数なしの `npm run train:full` も使えます。ネット規模（`--net-size`）や反復数などの調整・全オプションは [docs/TRAINING_OPTIONS.md](docs/TRAINING_OPTIONS.md)、各フェーズの詳しい説明・出力レイアウト・観戦は [docs/TRAINING_WORKFLOW.md](docs/TRAINING_WORKFLOW.md) を参照。

## GitHub Pages デプロイ

`main` への push で `.github/workflows/deploy.yml` が走ります（checkout → Node.js セットアップ → `npm ci` → `npm test` → `npm run build` → `dist/` を `gh-pages` ブランチへ publish）。

このアプリは bundler に依存せず相対パスで asset を読むため、Project Pages URL（`https://<user>.github.io/Blokus_AI/`）でもパスが壊れません。User / Organization Pages や custom domain でも同じ `dist/` を使えます。

> デプロイ成功後もサイトが古いまま見える場合は、ブラウザでハードリフレッシュしてください。

## 補足

- サーバー常駐処理・API Routes・SSR は使っていません。`.env` 系は `.gitignore` 済み。
- `master` / `learned` はモデル未ロード・推論失敗・違法手時に `expert` へ自動 fallback します。
- 学習コマンドの手順は [docs/TRAINING_WORKFLOW.md](docs/TRAINING_WORKFLOW.md)、全オプションは [docs/TRAINING_OPTIONS.md](docs/TRAINING_OPTIONS.md)、ネイティブ自己対戦は [docs/NATIVE_SELFPLAY.md](docs/NATIVE_SELFPLAY.md) を参照。
