# ネイティブ自己対戦エンジン（設計 / 土台）

## なぜネイティブか

現状の自己対戦は **Node ＋ onnxruntime-web（WASM）** で動く。これは「ブラウザと同じコードで動かせる」利点がある一方、自己対戦の大量生成では非効率：

- WASM 推論は同期・単発で、ネイティブ（CPU/GPU）より大幅に遅い。
- ゲームエンジンが JS のため、MCTS の 1 ノード展開ごとに JS↔WASM 境界を跨ぐ。
- マルチスレッド（WASM threads）は COOP/COEP 等の制約が多い。

世界ランカーを狙うには **自己対戦の量と探索深さ**が効く。そこがボトルネックなので、自己対戦専用に**ネイティブバイナリ**を用意する。

## 言語の選定：Rust

`C / C++ / Rust` から **Rust** を採用する。

- メモリ安全＋データ競合安全（並列自己対戦を安全に書ける）。
- `cargo` で依存・ビルド・テストが完結（ヘッダ地獄が無い）。
- ONNX 推論は `ort`（onnxruntime バインディング）や `tract`（純 Rust 推論）で実現可能。
- 既存の JS/Python 資産（JSONL 形式・`orientations.json`）をそのまま流用できる。

> C を選ばなかったのは保守性・安全性・ビルド体験のため。性能は Rust で十分（C と同等のネイティブ速度）。

## パリティが最優先

ネイティブ実装が JS/Python と**少しでも違う状態/行動を出すと、学習・推論が破綻**する（モデルに別ゲームを食わせることになる）。そこで言語非依存の**ゴールデン基準**を用意した。

- 生成: `npm run parity:golden`（`training/native/parity/gen_golden.mjs`）→ `training/native/parity/golden.json`
- 内容: orientation 数(91)・`ACTION_SIZE`(17837)・`PASS_ACTION`(17836)・開始マス(4,4)/(9,9)・初期合法手数(chooseStart=828 / fixedStart=414)・action 符号化の往復・スコア式のサンプル・**決定的ゲームの全局面**（盤面 SHA256・状態テンソル SHA256・選択 action・スコア）。
- 決定的ゲームの着手選択は `moves[turn % moves.length]`（生成順が一致すれば言語に依らず再現可能）。
- 正準シリアライズ（バイト一致のうえ SHA256）:
  - 盤面: `cell==EMPTY(-1)?0:(cell+1)` を行優先（index=y*14+x）で並べた 196 バイト。
  - 状態テンソル: `plane(0..51) → y(0..14) → x(0..14)` 順の `f32` リトルエンディアン。

ネイティブ側は `npm run native:test`（パリティテスト）で **golden.json と完全一致**することを検証する。これが通って初めて、自己対戦の出力（JSONL）を既存の Python トレーナへ流せる。

## ディレクトリ

```
training/native/
├── README.md                  # インデックス（薄い。設計はこのファイル、crate 詳細は下の README）
├── parity/
│   ├── gen_golden.mjs         # ゴールデン基準の生成（Node, 検証済み）
│   └── golden.json            # 言語非依存の基準（生成物）
└── blokus-selfplay/           # Rust crate（cargo）
    ├── Cargo.toml
    ├── README.md             # crate API・JSONL スキーマ・全フラグ
    ├── src/
    │   ├── lib.rs            # 公開 API（下の各モジュールを束ねる）
    │   ├── constants.rs board.rs rules.rs scoring.rs action.rs orientation.rs encoding.rs
    │   │                     # JS core を移植した決定的コア＋state encoder
    │   ├── inference.rs      # PolicyValue trait（onnx feature で ort 推論 / 既定は Uniform）
    │   ├── mcts.rs           # negamax PUCT MCTS（policyValueMctsAi.js の移植）
    │   └── bin/{selfplay.rs, parity_check.rs}  # 自己対戦→JSONL / パリティ突き合わせ
    └── tests/parity.rs        # パリティ検証（npm run native:test）
```

## データ流（ネイティブ）

```
orientations.json ─▶ Rust core(board/rules/encoder) ─▶ self-play ─▶ JSONL（既存スキーマ）
                                                                      └▶ replay_buffer / train_policy_value.py（既存のまま）
```

JSONL のスキーマは `generate_dataset.mjs` と同一（`encoded_state`, `legal_actions`, `selected_action`, `final_score_diff`, `policy_target_actions/probs`）。よって**学習側は無改修**で受けられる。

## ビルドとステータス

> ⚠️ この crate は **Rust ツールチェーンが無い環境で作成された**ため未コンパイル。決定的コア＋ state encoder に加え、**NN 推論（`inference.rs`, onnx feature）と negamax PUCT MCTS（`mcts.rs`）まで実装済み**だが、ローカルでのビルド/検証が未了。最初にやること:

```bash
npm run parity:golden       # ゴールデン基準を最新化（任意。生成物は同梱済み）
npm run native:test         # ← まず golden.json とのパリティを検証（最重要）
npm run native:selfplay -- --games 100 --out games.jsonl --seed 1
```

NN 推論つき MCTS 自己対戦は `onnx` feature が必要（onnxruntime をリンク）:

```bash
cd training/native/blokus-selfplay
cargo build --features onnx
cargo run --release --features onnx --bin selfplay -- --policy mcts \
  --model ../../../apps/web/public/models/blokus_policy_value.onnx --games 50 --sims 200
```

**`npm run native:test`（パリティ）が緑になるまでは、ネイティブ出力を学習に使わないこと**（[AGENTS.md](../AGENTS.md) の Do-NOT）。crate API・JSONL スキーマ・全 CLI フラグは [../training/native/blokus-selfplay/README.md](../training/native/blokus-selfplay/README.md)。

## ロードマップ（段階導入）

1. ✅ **コア＋パリティ**: board/rules/encoder/action/scoring を移植し、golden.json と完全一致する `tests/parity.rs`。自己対戦は random-legal でも JSONL を出力。（**要 `npm run native:test` 検証**）
2. ✅ **NN 推論**: `ort`（onnxruntime）で `blokus_policy_value.onnx` を読み policy/value を取得（`onnx` feature、未指定時は Uniform にフォールバック）。（**要 `cargo build --features onnx` 検証**）
3. ✅ **PUCT MCTS（negamax）**: `policyValueMctsAi.js` と同じ規約（手番視点・ply ごと符号反転・Dirichlet root noise・visit 温度サンプリング）を実装し、visit 分布を policy 教師として JSONL に出力。
4. ⏳ **置き換え**: `run_distributed_selfplay` のワーカーをネイティブバイナリに差し替え可能にする（同じ JSONL 出力・同じ CLI 互換）。Node 経路は対局 UI/検証用に残す。
5. ⏳ **並列化**: rayon 等でマルチコア自己対戦、（任意で）GPU 推論バッチ。

各段階で `npm run parity:golden` を再生成して基準を最新化し、`npm run native:test` を回す。
