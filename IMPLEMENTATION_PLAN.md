# BlokusAI Duo Implementation Plan

## 1. 目的

BlokusAI Duo を GitHub Pages で公開できる静的 Web アプリとして維持しつつ、以下を段階的に実現する。

1. 探索型 AI の安定運用
2. 学習型 AI の強化
3. AlphaZero 系学習基盤の整備
4. **Critical State Replay** を含む高密度学習データ作成基盤の追加

本計画書では、現在の実装済み範囲と、これから実装する Critical State Replay 系の変更を明確に分ける。

---

## 2. 現在の技術スタック

- Language: JavaScript ES modules, Python
- Runtime: Node.js
- Package manager: npm
- Frontend: browser-native static app
- Build: custom Node.js build
- Hosting: GitHub Pages
- CI/CD: GitHub Actions
- Browser inference: `onnxruntime-web`
- Training: PyTorch
- Tests: Node.js built-in assertions

---

## 3. 現在の実装状況

## 3.1 実装済み

### ゲーム本体

- 14x14 盤面
- 21 ピース / 91 orientation
- `chooseStart` / `fixedStart`
- 開始マス `(0,0)` / `(13,13)`
- 合法手生成
- pass 制約
- 終局判定
- 公式スコア

### Web UI

- Human vs Human
- Human vs AI
- AI vs AI
- 盤面描画
- ピース選択
- 回転 / 反転 / pass / skip
- 合法手マーカー
- ホバープレビュー
- 終局 overlay
- 棋譜 JSON copy / load
- AI stats

### 探索型 AI

- `easy`
- `normal`
- `hard`
- `expert`
- `expert_plus`
- `master`

### 学習型 AI

- TS/Python 共通 action encoding
- TS/Python 共通 state encoder
- Expert teacher imitation dataset
- PolicyNet
- PolicyValueNet
- ONNX export
- browser learned inference
- browser master inference

### AI vs AI 学習基盤

- `generate:dataset`
- `arena:ai`
- `cycle:learned`
- `selfplay:loop`
- `distributed:selfplay`
- `coordinator:selfplay`
- `agent:selfplay`
- `alphazero:loop`
- replay buffer
- model registry
- Elo-based gating

### 検証基盤

- core rules tests
- AI legality tests
- worker protocol tests
- TS/Python shared encoding tests
- learned inference tests
- master fallback tests
- replay buffer tests
- distributed queue tests
- Elo gating tests
- build smoke check

## 3.2 まだ未実装

### Critical State Replay 系

- trajectory 保存
- critical state 選択
- replay action 選択
- branch replay
- q_values / policy_probs / blunder_score 生成
- branch dataset 保存
- mixed dataset loader での統合

### 将来の大規模運用

- network service 型 multi-host coordinator
- replay buffer の高度な優先 sampling
- replay buffer の圧縮戦略の最適化
- Elo 運用の長期安定化
- GPU 学習を含む CI

---

## 4. 今回追加する実装テーマ

今回の仕様更新を受けて、次のテーマを実装対象として計画する。

1. **Trajectory 収集**
2. **Critical State Selection**
3. **Branch Replay**
4. **Critical State Replay Dataset**
5. **Policy-Value 学習への統合**

---

## 5. Critical State Replay の目的

通常の self-play dataset は、全局面を均一に保存するため、

- 重要局面
- 終盤の価値差が大きい局面
- 明確な悪手 / 妥協手 / 最善手がある局面

の学習密度が不足しやすい。

Critical State Replay では、1 対局の中から重要局面だけを抜き出し、その局面から複数候補手を replay して、

- `q_values`
- `policy_probs`
- `best_action`
- `blunder_score`

を直接推定する。

これにより、Policy / Value / Policy-Value MCTS の教師データ密度を上げる。

---

## 6. 変更対象ファイル

### Core / Shared

- `packages/core/src/actionSpace.js`
- `packages/core/src/stateEncoding.js`
- `packages/core/src/generatedOrientations.js`
- `training/blokus_shared.py`

### Existing Training

- `training/generate_dataset.mjs`
- `training/train_policy_value.py`
- `training/replay_buffer.mjs`
- `training/run_alphazero_loop.mjs`

### New Training Files

- `training/critical_state_replay/collect_trajectory.mjs`
- `training/critical_state_replay/select_critical_states.mjs`
- `training/critical_state_replay/replay_from_state.mjs`
- `training/critical_state_replay/build_branch_dataset.mjs`
- `training/critical_state_replay/branch_dataset_schema.mjs`
- `training/critical_state_replay/README.md`

### Tests

- `training/training.test.mjs`
- 必要に応じて `apps/web/tests/ai.test.mjs`

### Docs

- `README.md`
- `blokus_ai_duo_spec.md`
- `IMPLEMENTATION_PLAN.md`

---

## 7. 実装ステップ

## Step 1: Trajectory 保存

### 目的

対局中の各手番について、後から replay できる十分な情報を保存する。

### 実装内容

- `TrajectoryStep` 相当のレコードを定義
- `stateHash`
- `state`
- `encodedState`
- `player`
- `turnIndex`
- `legalActions`
- `chosenAction`
- `evaluationBefore / After`
- mobility / corner 数
- `remainingPieceCount`
- `phase`

### 完了条件

- 1 対局分の trajectory を保存できる
- `chosenAction` が `legalActions` に含まれる
- `state` から局面復元できる

## Step 2: Critical State Selection

### 目的

全局面から replay 対象となる重要局面だけを選ぶ。

### 実装内容

- `isCriticalState(step)` 実装
- 評価差
- mobility drop
- corner drop
- phase
- 残りピース数

### 完了条件

- 各対局から上限数の critical state を選べる
- `stateHash` による dedupe ができる

## Step 3: Replay Action Selection

### 目的

critical state ごとに replay する候補手を選ぶ。

### 実装内容

- `evaluateMoveQuick` ベースの上位手抽出
- `chosenAction` の強制包含
- top-k 設定

### 完了条件

- `evaluated_actions` が常に legal action の部分集合になる
- `chosenAction` が必ず含まれる

## Step 4: Branch Replay

### 目的

critical state から複数候補手を replay して終局値を集める。

### 実装内容

- `playoutsPerAction`
- Expert with noise
- 必要なら Master / MCTS teacher 対応
- `score_diffs` 保存

### 完了条件

- 複数 action の replay が終局まで走る
- 各 action に対してスコア差配列が得られる

## Step 5: q_values / policy_probs / blunder_score

### 目的

branch replay 結果から学習用ターゲットを作る。

### 実装内容

- `q_values = average(score_diffs)`
- 正規化
- `policy_probs = softmax(q_values / temperature)`
- `best_action`
- `blunder_score`

### 完了条件

- `policy_probs` の総和が 1 になる
- `best_action` が `evaluated_actions` に含まれる
- `blunder_score >= 0`

## Step 6: Branch Dataset 保存

### 目的

Critical State Replay の出力を、Policy-Value 学習で使える dataset として保存する。

### 実装内容

- `records.jsonl`
- `metadata.json`
- 必要に応じて `states.npy`
- `schema_version`

### 完了条件

- 100 局 smoke で branch dataset を生成できる
- metadata に作成条件が保存される

## Step 7: Policy-Value 学習への統合

### 目的

既存の self-play dataset と Critical State Replay dataset を混ぜて学習する。

### 実装内容

- mixed dataset loader
- `dataset_mix` 設定
- policy loss に `policy_probs`
- value loss に `max(q_values)` または派生 target

### 完了条件

- smoke dataset で 1 epoch 学習できる
- loss が NaN にならない

---

## 8. データ構造

### 8.1 TrajectoryStep

```ts
interface TrajectoryStep {
  stateHash: string;
  state: SerializedGameState;
  encodedState?: number[] | Uint8Array;
  player: PlayerId;
  turnIndex: number;
  legalActions: number[];
  chosenAction: number;
  evaluationBefore: number;
  evaluationAfter: number;
  myLegalMoveCountBefore: number;
  myLegalMoveCountAfter: number;
  oppLegalMoveCountBefore: number;
  oppLegalMoveCountAfter: number;
  myCornerCountBefore: number;
  myCornerCountAfter: number;
  oppCornerCountBefore: number;
  oppCornerCountAfter: number;
  remainingPieceCount: number;
  remainingCellCount: number;
  phase: "opening" | "midgame" | "endgame";
}
```

### 8.2 Branch Dataset Record

```ts
interface BranchDatasetRecord {
  schemaVersion: number;
  source: "critical_state_replay";
  stateId: string;
  gameId: string;
  turnIndex: number;
  phase: "opening" | "midgame" | "endgame";
  player: PlayerId;
  state: string | number[];
  legalActions: number[];
  evaluatedActions: number[];
  qValues: number[];
  policyProbs: number[];
  chosenAction: number;
  bestAction: number;
  blunderScore: number;
  playoutsPerAction: number;
  teacherAi: string;
  scoreDiffs: Record<string, number[]>;
}
```

---

## 9. 検証方法

通常の確認:

```bash
npm test
npm run build
npm run lint
npm run typecheck
```

Critical State Replay の smoke 確認:

```bash
npm run generate:trajectory -- --games 100 --ai expert --out training/dataset/trajectories/smoke
npm run generate:critical-replay -- --trajectories training/dataset/trajectories/smoke --out training/dataset/critical_replay/smoke --critical-states-per-game 4 --top-k-actions 5 --playouts-per-action 4 --teacher expert_with_noise
```

学習 smoke:

```bash
python training/train_policy_value.py --dataset training/dataset/mixed_config.yaml --epochs 1 --batch-size 512 --device cuda --amp
```

---

## 10. 完了条件

### この計画の完了条件

- trajectory を生成できる
- critical state を選べる
- branch replay が走る
- `q_values` / `policy_probs` / `blunder_score` を計算できる
- branch dataset を保存できる
- Policy-Value 学習へ混合して 1 epoch 動く
- replay buffer / AlphaZero loop と整合する
- ドキュメントが更新されている

### 今回まだ将来に残すもの

- Master self-play に対する大規模 branch replay 最適化
- Critical State Replay の replay teacher 多様化
- 大規模 mixed dataset の長時間学習運用
- GPU CI

---

## 11. リスク

- branch replay は計算量が大きくなりやすい
- 同一局面の重複評価が増えるとデータが偏る
- replay teacher に noise を入れすぎると教師品質が落ちる
- `policy_probs` の温度設計で学習の安定性が変わる
- dataset mix の比率次第で既存 self-play data を打ち消す可能性がある

---

## 12. ロールバック方針

- Critical State Replay の品質に問題がある場合は dataset mix から外す
- mixed loader に問題がある場合は従来の self-play dataset 学習へ戻す
- replay branch 数が重すぎる場合は `critical_states_per_game` と `playouts_per_action` を縮小する
