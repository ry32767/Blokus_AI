# BlokusAI Duo 仕様書

- バージョン: 0.4.0-draft
- 更新日: 2026-06-08
- 対象: GitHub Pages で公開する 2 人対戦 Blokus Duo AI アプリ

---

## 1. 概要

BlokusAI Duo は、14x14 盤面の 2 人対戦 Blokus Duo をブラウザで遊べる静的 Web アプリである。

対応モード:

- Human vs Human
- Human vs AI
- AI vs AI

AI は大きく 2 系統を扱う。

1. 探索型 AI
2. 学習型 AI

学習型 AI は段階的に拡張する。

- Phase 1: Expert teacher imitation learning
- Phase 2: Policy-Value model + Master difficulty
- Phase 3: Replay buffer / distributed self-play / model registry / Elo gating
- Phase 4: Critical State Replay を含む高密度学習データ生成

本仕様では、既存の self-play / policy-value 学習基盤に加え、**Critical State Replay** を正式な学習データ作成方式として追加定義する。

---

## 2. ゲーム仕様

### 2.1 盤面

- 盤面サイズ: 14 x 14
- 座標系: 0-indexed
- 開始マス:
  - Player 0: `(0, 0)`
  - Player 1: `(13, 13)`

### 2.2 ピース

- Blokus Duo の 21 ピースを使う
- 各プレイヤーは各ピースを 1 回だけ使える
- 各プレイヤーの総セル数は 89

### 2.3 合法手

- 初手は自分の開始マスを含む必要がある
- 2 手目以降は自分の既存ピースと角で接する必要がある
- 自分の既存ピースと辺で接してはならない
- 合法手がない場合のみ pass できる

### 2.4 終局

- 両プレイヤーが連続して pass したら終局
- スコアは Blokus Duo 公式ルールに従う

---

## 3. AI difficulty

```ts
type AiDifficulty =
  | "easy"
  | "normal"
  | "hard"
  | "expert"
  | "expert_plus"
  | "learned"
  | "master";
```

### 3.1 探索型 AI

- `easy`: 弱めの Heuristic AI
- `normal`: 強めの Heuristic AI
- `hard`: Beam Search AI
- `expert`: Hybrid Expert AI
- `expert_plus`: exact endgame を含む強化 Expert
- `master`: policy-value guided MCTS + endgame search

### 3.2 学習型 AI

- `learned`: PolicyNet 単体推論 AI
- `master`: policy-value model を探索へ組み込んだ最上位 AI

---

## 4. 共通 action encoding

TypeScript と Python で完全一致する action id を定義する。

```ts
action_id = orientation_id * 14 * 14 + y * 14 + x
pass_action_id = ORIENTATION_COUNT * 14 * 14
ACTION_SIZE = ORIENTATION_COUNT * 14 * 14 + 1
```

### 4.1 ルール

- `orientation_id` は全ピース共通の global orientation id
- `pass` は最後の action id
- `ORIENTATION_COUNT` は生成済み unique orientation 数
- `orientations.json` を TS / Python 両方で読む

---

## 5. State Encoder

学習用 tensor は以下で統一する。

```text
shape: [51, 14, 14]
dtype: float32
視点: player 視点で正規化
```

### 5.1 channel

```text
0: 自分の占有セル
1: 相手の占有セル
2: 空きセル
3: 自分の角候補
4: 相手の角候補
5: 自分の辺接触禁止セル
6: 相手の辺接触禁止セル
7: 自分の開始マス
8: 相手の開始マス
9..29: 自分の残ピース 21 plane
30..50: 相手の残ピース 21 plane
```

---

## 6. 学習データセットの全体方針

学習データセットは 1 種類に固定しない。以下の複数ソースを混合して使う。

1. Expert self-play dataset
2. MCTS visit distribution dataset
3. Critical State Replay dataset
4. 必要に応じた人手検証ログ由来 dataset

### 6.1 dataset mix

初期の混合例:

```yaml
dataset_mix:
  expert_self_play: 0.35
  mcts_visit_distribution: 0.25
  critical_state_replay: 0.40
```

### 6.2 目的

- 全局面を均一に学習するだけでは拾いにくい分岐を厚く学習する
- 終盤や局面悪化点のデータ密度を上げる
- Policy / Value / Policy-Value MCTS の教師データ品質を上げる

---

## 7. 既存 dataset 形式

### 7.1 Policy imitation dataset

```json
{
  "player": 0,
  "actor_difficulty": "expert",
  "encoded_state": [0, 0, 1],
  "legal_actions": [123, 456, 789],
  "selected_action": 123,
  "expert_selected_action": 123,
  "final_score_diff": 12
}
```

### 7.2 Policy-Value dataset で使う追加情報

- `policy_target_actions`
- `policy_target_probs`
- `policy_target_visits`
- `policy_target_total_visits`
- `root_value`

---

## 8. Critical State Replay

Critical State Replay は、1 対局の全局面をそのまま学習するのではなく、**局面価値や分岐価値が大きい局面だけを選び、その局面から複数の候補手を分岐再生して教師データを濃くする**手法である。

### 8.1 基本思想

通常の self-play dataset:

```text
S0, S1, S2, ..., ST
final_result = +1
```

この形式では、どの手が本当に重要だったかが薄くなる。

Critical State Replay では、対局中の重要局面 `S_t` を取り出し、複数候補手を評価する。

```text
critical state S_t
  action A -> final score diff +8
  action B -> final score diff +2
  action C -> final score diff -4
  action D -> final score diff -11
```

この差分情報を `q_values`、`policy_probs`、`best_action`、`blunder_score` として保存し、Policy / Value / Policy-Value MCTS 用の高密度教師データに変換する。

---

## 9. Trajectory 収集

まず Expert 系 AI または Master AI による対局 trajectory を保存する。

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

### 9.1 目的

- state を完全復元可能な形で保持する
- `stateHash` を dedupe と transposition reuse に使う
- 後段の critical state 判定に必要な特徴量を持つ

---

## 10. Critical State 選択

対局中のすべての局面を replay するのではなく、重要局面だけを選ぶ。

### 10.1 判定例

```ts
function isCriticalState(step: TrajectoryStep): boolean {
  const evalDelta = Math.abs(step.evaluationAfter - step.evaluationBefore);

  const myMobilityDrop =
    step.myLegalMoveCountBefore - step.myLegalMoveCountAfter;

  const myCornerDrop =
    step.myCornerCountBefore - step.myCornerCountAfter;

  return (
    evalDelta >= 0.20 ||
    myMobilityDrop >= 30 ||
    myCornerDrop >= 3 ||
    step.phase === "endgame" ||
    step.remainingPieceCount <= 8
  );
}
```

### 10.2 重視する局面

- 評価値が大きく変動した局面
- 自分の合法手数が急減した局面
- 相手に強い展開阻止を受けた局面
- 終盤局面
- 負け対局中の重要局面

---

## 11. Replay 候補手の選択

Critical state ごとに、全合法手ではなく有望な候補手だけを branch replay する。

### 11.1 候補手の選び方

優先順位:

1. Expert AI の move ordering
2. `evaluateMoveQuick`
3. MCTS prior / visit count
4. 実際に選ばれた `chosenAction`

```ts
function selectReplayActions(
  state: GameState,
  player: PlayerId,
  legalActions: number[],
  chosenAction: number,
  topK: number
): number[] {
  const scored = legalActions.map(action => ({
    action,
    score: evaluateMoveQuick(state, player, actionIdToMove(action)),
  }));

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, topK).map(x => x.action);

  if (!selected.includes(chosenAction)) {
    selected[selected.length - 1] = chosenAction;
  }

  return Array.from(new Set(selected));
}
```

---

## 12. Branch Replay

選んだ critical state に対して、複数候補手を分岐させ、その先を終局まで replay する。

```ts
for (const criticalState of criticalStates) {
  const replayActions = selectReplayActions(...);

  for (const action of replayActions) {
    for (let i = 0; i < playoutsPerAction; i++) {
      const nextState = applyAction(criticalState.state, action);

      const result = playToEnd(nextState, {
        black: expertAiWithNoise,
        white: expertAiWithNoise,
        maxDepth: "until_terminal",
      });

      saveReplayResult(criticalState, action, result);
    }
  }
}
```

### 12.1 replay policy

- deterministic にしすぎない
- ただし完全ランダムにはしない
- 軽い noise を足した Expert / Master を使う

例:

```yaml
expert_noise:
  temperature: 0.15
  random_top_k: 3
  epsilon_random: 0.03
```

---

## 13. q_values / policy_probs / blunder_score

### 13.1 q_values

```ts
q_value[action] =
  average(finalScoreDiffFromCurrentPlayerPerspective)
```

```ts
normalizedQ = clamp(q_value / 89.0, -1.0, 1.0);
```

### 13.2 policy_probs

`q_values` から policy target を作る。

```ts
policy_probs = softmax(q_values / temperature)
```

```yaml
policy_temperature_by_phase:
  opening: 0.80
  midgame: 0.50
  endgame: 0.30
```

### 13.3 blunder_score

```ts
bestAction = action with max q_value
blunderScore = q_value[bestAction] - q_value[chosenAction]
```

### 13.4 value target

Critical State Replay dataset の value target は初期値として以下を使う。

```py
value_target = max(q_values)
```

将来的には以下も比較対象にする。

```py
value_target = average(q_values under policy_probs)
```

---

## 14. Branch Dataset 形式

Critical State Replay 由来の branch dataset は JSONL で保存する。

```json
{
  "schema_version": 1,
  "source": "critical_state_replay",
  "state_id": "abc123",
  "game_id": "game_000001",
  "turn_index": 27,
  "phase": "endgame",
  "player": 0,
  "state": "encoded_state_or_state_ref",
  "legal_actions": [123, 456, 789, 1001],
  "evaluated_actions": [123, 456, 789],
  "q_values": [0.42, 0.18, -0.31],
  "policy_probs": [0.61, 0.29, 0.10],
  "chosen_action": 123,
  "best_action": 123,
  "blunder_score": 0.0,
  "playouts_per_action": 4,
  "teacher_ai": "expert_with_noise",
  "score_diffs": {
    "123": [8, 7, 9, 8],
    "456": [3, 2, 1, 3],
    "789": [-6, -4, -5, -7]
  }
}
```

### 14.1 保存レイアウト例

```text
training/dataset/critical_replay/
  states.npy
  records.jsonl
  metadata.json
  README.md
```

---

## 15. Critical State Replay の生成パラメータ

初期値:

```yaml
critical_states_per_game: 4
top_k_actions: 5
playouts_per_action: 4
max_replay_depth: until_terminal
teacher_ai: expert_with_noise
deduplicate_by_hash: true
include_endgame_states: true
include_losing_game_states: true
```

拡張時の可変域:

```yaml
critical_states_per_game: 4-12
top_k_actions: 3-10
playouts_per_action: 2-16
teacher_ai:
  - expert
  - expert_with_noise
  - mcts_512
  - mcts_1024
phase_sampling_ratio:
  opening: 0.15
  midgame: 0.35
  endgame: 0.50
```

---

## 16. Training 統合

Critical State Replay dataset は Policy / Value 学習に統合して使う。

### 16.1 Policy loss

```py
policy_loss = -sum(policy_probs * log_softmax(masked_logits[evaluated_actions]))
```

```py
masked_logits = logits.masked_fill(legal_mask == 0, -1e9)
```

### 16.2 Value loss

```py
value_loss = mse(predicted_value, value_target)
```

### 16.3 混合学習

```yaml
dataset_mix:
  expert_self_play: 0.35
  mcts_visit_distribution: 0.25
  critical_state_replay: 0.40
```

---

## 17. Multi-Host / Replay Buffer / Registry

### 17.1 replay buffer

- file-based replay buffer
- gzip shard 圧縮
- priority sampling
- shard priority と sample priority の両方を使う

### 17.2 multi-host distributed self-play

- coordinator が shared directory に job を積む
- agent が atomic claim で job を処理する
- replay buffer に shard を戻す

### 17.3 model registry

- candidate model 登録
- active best 管理
- promotion history
- rating / ratingGames / ratingHistory

### 17.4 Elo gating

- candidate vs active best を arena 評価する
- score rate から Elo gain を推定する
- confidence lower bound を gate に使う

---

## 18. 実装対象

本仕様に基づいて実装対象とするもの:

1. trajectory 保存
2. critical state 選択
3. replay action 選択
4. branch replay
5. q_values / policy_probs / blunder_score 算出
6. branch dataset 保存
7. metadata 保存
8. policy-value training への統合
9. dataset mix 対応
10. replay buffer / distributed self-play / registry との接続

---

## 19. テスト要件

最低限、以下を確認する。

- trajectory が生成できる
- critical state 判定が動く
- replay action selection が legal action に限定される
- branch replay が終局まで回る
- q_values / policy_probs / blunder_score が計算できる
- branch dataset が JSONL / metadata として保存できる
- policy-value 学習へ混合して 1 epoch 動く
- replay buffer に critical replay shard を投入できる
- multi-host queue から job を処理できる
- Elo gate の summary を出力できる

---

## 20. 実行コマンド例

```bash
npm run generate:trajectory -- \
  --games 100 \
  --ai expert \
  --out training/dataset/trajectories/smoke

npm run generate:critical-replay -- \
  --trajectories training/dataset/trajectories/smoke \
  --out training/dataset/critical_replay/smoke \
  --critical-states-per-game 4 \
  --top-k-actions 5 \
  --playouts-per-action 4 \
  --teacher expert_with_noise

python training/train_policy_value.py \
  --dataset training/dataset/mixed_config.yaml \
  --epochs 1 \
  --batch-size 512 \
  --device cuda \
  --amp
```

注:

- 上記の `generate:trajectory` / `generate:critical-replay` は本仕様で追加されたコマンド例であり、既存実装に未着手の部分を含む
- 既存の `generate:dataset`, `distributed:selfplay`, `alphazero:loop` と並行して育てる

---

## 21. 将来拡張

今後の拡張候補:

1. Critical State Replay を Master self-play に本格統合
2. branch replay の teacher を Master / MCTS 系へ広げる
3. visit distribution と branch replay を混ぜた高精度 policy teacher
4. losing game の重要局面を優先する hard-case mining
5. Policy-Value MCTS 強化
6. AlphaZero に近い自己対戦学習への移行
