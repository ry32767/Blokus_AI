# Architecture

BlokusAI Duo の全体像と、1 手・1 学習サイクルがどう流れるかのマップ。詳細仕様は [spec.md](spec.md)、評価とロードマップは [EVALUATION.md](EVALUATION.md)。

## レイヤ

```
packages/core/        ゲームモデル（唯一の真実）
  rules.js            合法手生成 / 着手適用 / 終局判定
  constants.js        盤・開始マス (4,4)/(9,9) 等
  scoring.js          スコア = -残り +15全配置 +5最後I1
  action.js           action ⇔ (orientation,x,y,pass) の符号化
  orientation.js      91 orientation（generatedOrientations.js）
  stateEncoding.js    [51,14,14] 状態テンソル（手番視点）

apps/web/             ブラウザアプリ
  src/main.js         UI / 入力 / 描画
  src/ai/             AI エンジン群（下記）
  src/workers/        Web Worker プロトコル（INIT/THINK/CANCEL）
  public/models/      *.onnx（学習成果）
  public/vendor/onnxruntime-web/  ブラウザ推論ランタイム

training/             自己対戦・学習（Node *.mjs / Python *.py）
scripts/              build/test/verify/serve/run-python
```

`apps/web` と `training` は `packages/core` を相対 import で共有する（同じルール・同じエンコーダ）。Python 側（`training/blokus_shared.py`）は JS と**ビット一致**の独立実装で、parity テストで担保する。

## 1 手の流れ（ブラウザ）

```
main.js → workers/aiWorker → ai/difficulty.js (難易度→エンジン)
  → ai/{heuristicAi|beamSearchAi|mctsAi|expertAi|alphaBetaAi|policyValueMctsAi|learnedAi}
      ↘ policyValueMctsAi/learnedAi は ai/modelRunner.js 経由で onnxruntime-web 推論
  → core/rules.js で合法性を担保した着手を返す
```

- 探索系（`mctsAi`, `policyValueMctsAi`）は **negamax**: ノード値は「その局面の手番側」視点、逆伝播で ply ごとに 1 回だけ符号反転。`master` は終盤で αβ／厳密解にルーティング、非終盤は policy-value PUCT。
- モデル読み込み/推論に失敗すると `expert` へ fallback（ブラウザ UX 用）。学習文脈では `decideTrainingMove({failOnFallback:true})` で hard-fail にできる。

## 学習データフロー

```
generate_dataset.mjs ──(self-play)──▶ JSONL サンプル
  decideTrainingMove → 各手の AI（master 等）
  master の探索: Dirichlet root noise + 温度サンプリング（自己対戦時）
  → visit分布を policy 教師 / 終局スコアを value 教師として記録
        │
        ▼
replay_buffer.mjs（gzip shard ＋ priority sampling）
        │  sampleReplayBufferToDataset
        ▼
train_policy_value.py（PyTorch 学習）
  入力 [51,14,14] → ResNet trunk(channels×blocks) → policy(17837) + value(tanh)
  policy: masked log-softmax × visit分布 / value: 勝敗(outcome) または margin
  checkpoint に model_arch を記録
        │
        ▼
export_onnx.py（checkpoint の model_arch で再構築 → ONNX）
        │
        ▼
apps/web/public/models/blokus_policy_value.onnx（ブラウザが読む）
```

## AlphaZero ループ（`run_alphazero_loop.mjs`）

```
active best model で distributed self-play（探索 ON）
  → replay buffer に蓄積 → sample → train_policy_value.py
  → candidate ONNX を export
  → candidate vs active best をアリーナ評価（Elo 下限ゲート、評価は貪欲・探索OFF）
  → ゲート通過時のみ model_registry の active best を更新
```

CLI 配線は 4 層（`run_alphazero_loop` → `run_distributed_selfplay` → `run_selfplay_worker` → `generate_dataset`）。探索フラグ（`--root-dirichlet-weight` 等）と net サイズはこの経路で末端の実行体まで届く。

## 触るときの注意

- `training/` のソースは相対 import 深度と `package.json` / `scripts/test.mjs` のパス直書きに強く依存。移動はクラスタ単位で、全パスを直して `npm run verify`。
- ルール/encoder/開始マスを変えたら JS↔Python 両方を変え、既存 ONNX は再学習・再 export する。
