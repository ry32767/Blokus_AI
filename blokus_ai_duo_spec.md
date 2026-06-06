# BlokusAI Duo 実装仕様書

- 文書バージョン: 0.1.0
- 作成日: 2026-06-06
- 対象: GitHub Pages で公開する 2人制 Blokus Duo 型 AI 対戦アプリ
- 対象モード: `人間 vs AI`, `AI vs AI`
- 非対象: ネットワーク対戦、ローカルIP対戦、4人制Blokus、ユーザーアカウント、サーバー常駐処理

---

## 0. 実装方針

本仕様では、2人制は **Blokus Duo / Travel Blokus 型**として定義する。盤面は 14 x 14、各プレイヤーは21個のピースを1色ずつ使用する。

公式説明書では Blokus Duo の盤面は196マス、ピースは白21個・黒21個、各色は1マス1個、2マス1個、3マス2個、4マス5個、5マス12個とされている。本仕様もこれに従う。[^mattel-jp][^mattel-fwg43]

スタートポイントの座標は、公式図の2つの開始位置を実装用に座標化し、0-indexedで `(4,4)` と `(9,9)` とする。これは 1-indexed では `(5,5)` と `(10,10)`、つまり互いに対角方向の「端から5マス目」に相当する。座標表現は BoardGameGeek 掲載の「starting squares 5x5 from opposite corners」という説明にも整合する。[^bgg-start]

---

## 1. 用語・座標系

### 1.1 座標系

盤面は 14 x 14 の正方格子とする。

```ts
const BOARD_SIZE = 14;
type X = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
type Y = X;
```

- 左上を `(0,0)` とする。
- `x` は右方向に増加する。
- `y` は下方向に増加する。
- flat index は `index = y * 14 + x` とする。
- スタートポイントは以下の2点。

```ts
const START_POINTS = [
  { id: "A", x: 4, y: 4 },
  { id: "B", x: 9, y: 9 },
] as const;
```

### 1.2 プレイヤー

```ts
type PlayerId = 0 | 1;

type Player = {
  id: PlayerId;
  label: "Black" | "White";
};
```

初期表示では次の対応にする。

```ts
const PLAYERS = [
  { id: 0, label: "Black" },
  { id: 1, label: "White" },
] as const;
```

色名はUIテーマ上の表示名であり、ゲームロジックでは `PlayerId` のみを使う。

---

## 2. 正確なルール定義

### 2.1 コンポーネント

- 盤面: 14 x 14 = 196マス。
- プレイヤー数: 2人。
- 各プレイヤーのピース: 21個。
- 各色のピース構成:
  - 1マス: 1個
  - 2マス: 1個
  - 3マス: 2個
  - 4マス: 5個
  - 5マス: 12個
- 各プレイヤーが置ける総マス数は `1 + 2 + 2*3 + 5*4 + 12*5 = 89`。
- 2人合計の全ピース面積は178マス。盤面196マスより18マス少ない。

### 2.2 勝利目的

各プレイヤーは、自分の21個のピースをできるだけ多く盤面に配置する。ゲーム終了後、公式説明書の高度スコア方式に従って得点を計算し、得点が高いプレイヤーを勝者とする。[^mattel-jp][^mattel-r1984]

### 2.3 初手ルール

公式説明書では、先攻が2つのスタートポイントのどちらかに最初のピースを置き、後攻がもう一方のスタートポイントに最初のピースを置くとされている。[^mattel-jp][^mattel-fwg43]

実装では以下の2方式をサポートする。

#### 2.3.1 標準ルール: `chooseStart`

- 初期状態では、両プレイヤーの開始点は未確定。
- 先攻 `Player 0` の初手は、配置ピースが `START_POINTS.A` または `START_POINTS.B` のどちらか1つ以上を覆う必要がある。
- 先攻が覆ったスタートポイントを `Player 0` の開始点とする。
- 後攻 `Player 1` の開始点は、先攻が選ばなかったもう一方のスタートポイントとする。
- 後攻の初手は、自分に割り当てられた開始点を覆う必要がある。

#### 2.3.2 学習・検証用固定ルール: `fixedStart`

AI評価の再現性を上げるため、学習・自動評価では次も利用可能にする。

```ts
const FIXED_START_ASSIGNMENT = {
  0: "A", // Player 0 -> (4,4)
  1: "B", // Player 1 -> (9,9)
} as const;
```

- `fixedStart` は公式ルールの完全な自由選択ではないが、スタートポイントの選択対称性を固定する実装モードである。
- UIの通常対局は `chooseStart` をデフォルトにする。
- AI学習とCIテストは `fixedStart` をデフォルトにする。

### 2.4 2手目以降の配置ルール

プレイヤーが自分の2個目以降のピースを置く場合、すべての条件を満たす必要がある。

1. 盤面外にはみ出してはならない。
2. 既に埋まっているマスに重ねてはならない。
3. 未使用の自分のピースを1個だけ置く。
4. 配置後、自分の既存ピースのいずれかと **角で1箇所以上接する**必要がある。
5. 配置後、自分の既存ピースと **辺で接してはならない**。
6. 相手ピースとは、辺で接しても角で接してもよい。
7. 一度置いたピースは移動・回転・反転・撤回できない。ただし開発用のUndo機能は、ゲーム履歴を巻き戻すUI機能としてのみ実装してよい。

上記の「同色は角のみ接触」「同色の辺接触は禁止」「異色ピースの接触制限なし」は公式説明書に従う。[^mattel-jp][^mattel-fwg43]

### 2.5 パス

- 合法手が1つも存在しないプレイヤーはパスする。
- 本仕様では **合法手が存在する場合の任意パスは禁止**する。
- UIでは、合法手が存在する間は「パス」ボタンを無効化する。
- AIでは、`pass` action は合法手が0件の場合のみ legal mask に含める。

### 2.6 終局

ゲームは以下のいずれかで終了する。

1. 両プレイヤーが合法手を持たない。
2. 両プレイヤーが21個すべてのピースを配置済み。
3. 片方が21個すべて配置済み、もう片方も合法手を持たない。

片方だけが置けなくなった場合、そのプレイヤーは以後パス扱いになり、もう片方は合法手がある限りプレイを継続する。これは公式説明書の「置けなくなったプレイヤーはパスし、両者が置けなくなったら終了」という記述に従う。[^mattel-fwg43][^mattel-r1984]

### 2.7 スコア

各プレイヤーのスコアは次で計算する。

```ts
score = -remainingUnitSquares + completionBonus + monominoLastBonus
```

- `remainingUnitSquares`: 手元に残った未配置ピースの合計マス数。
- `completionBonus`: 21個すべて配置できた場合 `+15`、それ以外 `0`。
- `monominoLastBonus`: 21個すべて配置し、最後に置いたピースが1マスピースの場合 `+5`、それ以外 `0`。
- 最高スコアは `+20`。
- 全ピースを置けなかった場合、スコアは `0` 以下になる。
- 同点の場合は引き分け。

公式説明書は、残った1マスにつき `-1`、全配置で `+15`、1マスピースを最後に置いた場合に追加 `+5` としている。[^mattel-jp][^mattel-r1984]

---

## 3. ピース定義

### 3.1 ピースID

21個のピースは以下のIDで固定する。

```ts
type PieceId =
  | "I1"
  | "I2"
  | "I3" | "V3"
  | "I4" | "O4" | "T4" | "L4" | "Z4"
  | "F5" | "I5" | "L5" | "P5" | "T5" | "U5" | "V5" | "W5" | "X5" | "Y5" | "Z5" | "N5";
```

### 3.2 基準形状

座標は各ピースのローカル座標 `(x,y)`。各ピースは、基準形状から回転・反転を生成し、左上原点に正規化する。

```json
{
  "I1": [[0,0]],
  "I2": [[0,0],[1,0]],

  "I3": [[0,0],[1,0],[2,0]],
  "V3": [[0,0],[0,1],[1,1]],

  "I4": [[0,0],[1,0],[2,0],[3,0]],
  "O4": [[0,0],[1,0],[0,1],[1,1]],
  "T4": [[0,0],[1,0],[2,0],[1,1]],
  "L4": [[0,0],[0,1],[0,2],[1,2]],
  "Z4": [[0,0],[1,0],[1,1],[2,1]],

  "F5": [[1,0],[2,0],[0,1],[1,1],[1,2]],
  "I5": [[0,0],[1,0],[2,0],[3,0],[4,0]],
  "L5": [[0,0],[0,1],[0,2],[0,3],[1,3]],
  "P5": [[0,0],[1,0],[0,1],[1,1],[0,2]],
  "T5": [[0,0],[1,0],[2,0],[1,1],[1,2]],
  "U5": [[0,0],[2,0],[0,1],[1,1],[2,1]],
  "V5": [[0,0],[0,1],[0,2],[1,2],[2,2]],
  "W5": [[0,0],[0,1],[1,1],[1,2],[2,2]],
  "X5": [[1,0],[0,1],[1,1],[2,1],[1,2]],
  "Y5": [[0,0],[0,1],[0,2],[0,3],[1,1]],
  "Z5": [[0,0],[1,0],[1,1],[1,2],[2,2]],
  "N5": [[0,0],[1,0],[1,1],[2,1],[3,1]]
}
```

### 3.3 変形生成

各ピースに対して、以下の8変換を適用する。

```ts
(x, y) => ( x,  y)
(x, y) => ( x, -y)
(x, y) => (-x,  y)
(x, y) => (-x, -y)
(x, y) => ( y,  x)
(x, y) => ( y, -x)
(x, y) => (-y,  x)
(x, y) => (-y, -x)
```

各変換後、次を行う。

1. 全セルを `minX = 0`, `minY = 0` になるように平行移動する。
2. セル座標を辞書順にソートする。
3. 同一セル集合を重複排除する。
4. ピースID順、セル座標配列の辞書順で安定ソートする。

期待されるユニーク向き数は以下。

| Piece | Unique orientations |
|---|---:|
| I1 | 1 |
| I2 | 2 |
| I3 | 2 |
| V3 | 4 |
| I4 | 2 |
| O4 | 1 |
| T4 | 4 |
| L4 | 8 |
| Z4 | 4 |
| F5 | 8 |
| I5 | 2 |
| L5 | 8 |
| P5 | 8 |
| T5 | 4 |
| U5 | 4 |
| V5 | 4 |
| W5 | 4 |
| X5 | 1 |
| Y5 | 8 |
| Z5 | 4 |
| N5 | 8 |

合計ユニーク向き数は `91`。

---

## 4. コアデータモデル

### 4.1 Board

```ts
type CellValue = -1 | PlayerId; // -1 = empty

type Board = Int8Array; // length = 196
```

- `board[y * BOARD_SIZE + x]` で参照する。
- `-1` は空マス。
- `0` は Player 0 の占有マス。
- `1` は Player 1 の占有マス。

### 4.2 GameState

```ts
type StartPointId = "A" | "B";
type StartPolicy = "chooseStart" | "fixedStart";
type GameStatus = "playing" | "finished";

type GameState = {
  board: number[]; // serialize用。実行時は Int8Array に変換可
  currentPlayer: PlayerId;
  turn: number;
  status: GameStatus;
  startPolicy: StartPolicy;
  startAssignment: [StartPointId | null, StartPointId | null];
  remainingPieces: [PieceId[], PieceId[]];
  placedPieces: [PieceId[], PieceId[]];
  lastPlacedPiece: [PieceId | null, PieceId | null];
  forcedPassed: [boolean, boolean];
  consecutivePasses: number;
  moveHistory: MoveRecord[];
};
```

### 4.3 Move

```ts
type Move = {
  kind: "place";
  player: PlayerId;
  pieceId: PieceId;
  orientationGlobalId: number; // 0..90
  x: number; // orientation bounding box top-left x
  y: number; // orientation bounding box top-left y
};

type PassMove = {
  kind: "pass";
  player: PlayerId;
};

type AnyMove = Move | PassMove;
```

### 4.4 MoveRecord

```ts
type MoveRecord = {
  ply: number;
  move: AnyMove;
  scoreAfter?: [number, number];
  legalMoveCountBefore: number;
  thinkingMs?: number;
  aiStats?: {
    engine: "random" | "heuristic" | "mcts" | "policy_value_mcts";
    nodes?: number;
    simulations?: number;
    value?: number;
    topPolicy?: Array<{ action: number; p: number }>;
  };
};
```

---

## 5. 合法手判定

### 5.1 補助関数

```ts
function inBounds(x: number, y: number): boolean;
function getCell(board: Board, x: number, y: number): CellValue;
function getCellsForMove(move: Move): Array<{ x: number; y: number }>;
function isBoardCellEmpty(board: Board, x: number, y: number): boolean;
```

### 5.2 隣接定義

```ts
const ORTHOGONAL_DIRS = [
  [ 1,  0],
  [-1,  0],
  [ 0,  1],
  [ 0, -1],
] as const;

const DIAGONAL_DIRS = [
  [ 1,  1],
  [ 1, -1],
  [-1,  1],
  [-1, -1],
] as const;
```

### 5.3 `isLegalMove`

```ts
function isLegalMove(state: GameState, move: AnyMove): boolean {
  if (state.status !== "playing") return false;
  if (move.player !== state.currentPlayer) return false;

  const legalMoves = generateLegalMoves(state);
  return legalMoves.some(m => sameMove(m, move));
}
```

実装時は高速化のため、`generateLegalMoves` の結果を action bitset としてキャッシュしてよい。ただし仕様上の真偽は `generateLegalMoves` と一致させる。

### 5.4 `isLegalPlacement`

配置手の個別判定は以下とする。

```ts
function isLegalPlacement(state: GameState, move: Move): boolean {
  const player = state.currentPlayer;
  if (move.player !== player) return false;
  if (!state.remainingPieces[player].includes(move.pieceId)) return false;

  const cells = getCellsForMove(move);

  // 1. 範囲外・重なり禁止
  for (const c of cells) {
    if (!inBounds(c.x, c.y)) return false;
    if (!isBoardCellEmpty(state.board, c.x, c.y)) return false;
  }

  // 2. 初手処理
  const isFirstMoveOfPlayer = state.placedPieces[player].length === 0;
  if (isFirstMoveOfPlayer) {
    const requiredStart = getRequiredStartPointForFirstMove(state, player);
    if (requiredStart.kind === "any") {
      return coversStartPoint(cells, "A") || coversStartPoint(cells, "B");
    }
    return coversStartPoint(cells, requiredStart.id);
  }

  // 3. 同色辺接触は禁止
  for (const c of cells) {
    for (const [dx, dy] of ORTHOGONAL_DIRS) {
      if (getCell(state.board, c.x + dx, c.y + dy) === player) {
        return false;
      }
    }
  }

  // 4. 同色角接触が1箇所以上必要
  let touchesOwnCorner = false;
  for (const c of cells) {
    for (const [dx, dy] of DIAGONAL_DIRS) {
      if (getCell(state.board, c.x + dx, c.y + dy) === player) {
        touchesOwnCorner = true;
      }
    }
  }

  return touchesOwnCorner;
}
```

### 5.5 `generateLegalMoves`

```ts
function generateLegalMoves(state: GameState): AnyMove[] {
  if (state.status !== "playing") return [];

  const player = state.currentPlayer;
  const moves: Move[] = [];

  for (const pieceId of state.remainingPieces[player]) {
    for (const orientation of getOrientations(pieceId)) {
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          const move = toMove(player, pieceId, orientation.globalId, x, y);
          if (isLegalPlacement(state, move)) moves.push(move);
        }
      }
    }
  }

  if (moves.length === 0) {
    return [{ kind: "pass", player }];
  }

  return moves;
}
```

### 5.6 `applyMove`

```ts
function applyMove(state: GameState, move: AnyMove): GameState {
  if (!isLegalMove(state, move)) {
    throw new Error("Illegal move");
  }

  const next = cloneState(state);

  if (move.kind === "pass") {
    next.forcedPassed[move.player] = true;
    next.consecutivePasses += 1;
    next.moveHistory.push(toMoveRecord(state, move));
    advanceTurnOrFinish(next);
    return next;
  }

  const cells = getCellsForMove(move);
  for (const c of cells) {
    setCell(next.board, c.x, c.y, move.player);
  }

  removePiece(next.remainingPieces[move.player], move.pieceId);
  next.placedPieces[move.player].push(move.pieceId);
  next.lastPlacedPiece[move.player] = move.pieceId;
  next.forcedPassed[move.player] = false;
  next.consecutivePasses = 0;

  if (next.placedPieces[move.player].length === 1) {
    updateStartAssignmentAfterFirstMove(next, move.player, cells);
  }

  next.moveHistory.push(toMoveRecord(state, move));
  advanceTurnOrFinish(next);
  return next;
}
```

### 5.7 手番進行

```ts
function advanceTurnOrFinish(state: GameState): void {
  const nextPlayer = other(state.currentPlayer);

  if (isTerminal(state)) {
    state.status = "finished";
    return;
  }

  state.currentPlayer = nextPlayer;
  state.turn += 1;
}
```

`isTerminal` は、両者に合法配置手がない、または両者の残ピースが0である場合に `true`。

---

## 6. アクションエンコーディング

### 6.1 固定アクション空間

学習AIでは固定長の action space を使う。

```ts
const NUM_ORIENTATIONS = 91;
const NUM_BOARD_POSITIONS = 14 * 14; // 196
const PLACE_ACTIONS = NUM_ORIENTATIONS * NUM_BOARD_POSITIONS; // 17836
const PASS_ACTION = PLACE_ACTIONS; // 17836
const ACTION_SIZE = PLACE_ACTIONS + 1; // 17837
```

### 6.2 action index

```ts
function encodeAction(move: AnyMove): number {
  if (move.kind === "pass") return PASS_ACTION;
  return move.orientationGlobalId * 196 + move.y * 14 + move.x;
}

function decodeAction(action: number, player: PlayerId): AnyMove {
  if (action === PASS_ACTION) return { kind: "pass", player };

  const orientationGlobalId = Math.floor(action / 196);
  const pos = action % 196;
  const x = pos % 14;
  const y = Math.floor(pos / 14);
  const orientation = ORIENTATIONS[orientationGlobalId];

  return {
    kind: "place",
    player,
    pieceId: orientation.pieceId,
    orientationGlobalId,
    x,
    y,
  };
}
```

### 6.3 legal mask

```ts
type LegalMask = Uint8Array; // length = ACTION_SIZE, 0/1
```

- 合法手のみ `1`。
- 合法配置手が1つ以上ある場合、`PASS_ACTION` は `0`。
- 合法配置手が0件の場合、`PASS_ACTION` のみ `1`。
- policy logits に対して、`mask=0` の action は `-Infinity` 相当として扱う。

---

## 7. 対戦UI仕様

### 7.1 画面一覧

初期実装では単一ページSPAとする。

```text
/                  GameApp
/settings          画面内モーダルで代替してよい
/replay/:id        v0.2以降。初期は非対象
```

GitHub Pages は静的サイトとしてリポジトリから公開できるため、本アプリは静的SPAとして構成する。[^github-pages] Viteを使う場合、GitHub Pages配置では `base` の設定に注意する。[^vite-pages]

### 7.2 レイアウト

デスクトップ幅では3カラム。

```text
┌────────────────────────────────────────────┐
│ Header: mode / turn / score / controls     │
├──────────────┬────────────────┬────────────┤
│ Player 0     │ 14x14 Board     │ Player 1   │
│ piece tray   │                │ piece tray │
│ status       │                │ status     │
├──────────────┴────────────────┴────────────┤
│ Log / AI stats / review panel              │
└────────────────────────────────────────────┘
```

モバイル幅では縦積み。

```text
Header
Board
Current player's tray
Controls
AI stats / log
```

### 7.3 モード

```ts
type GameMode = "HUMAN_VS_AI" | "AI_VS_AI";
```

#### `HUMAN_VS_AI`

- ユーザーは `Player 0` または `Player 1` を選択できる。
- デフォルトは `Player 0 = Human`, `Player 1 = AI`。
- AI手番中、人間の入力は無効化する。
- AIが手を返したら自動で `applyMove` する。

#### `AI_VS_AI`

- 両プレイヤーをAIにする。
- 自動再生、一時停止、1手進行、速度倍率を提供する。
- 学習AIの挙動確認・デモ用途を主目的とする。

### 7.4 ボード表示

- 14 x 14 のグリッドを表示する。
- スタートポイント `(4,4)` と `(9,9)` を薄いマーカーで表示する。
- 既に占有されたセルはプレイヤー別に描画する。
- 直前に置いたピースは輪郭またはハイライトで識別する。
- 合法配置プレビューは有効・無効が視覚的に分かるようにする。
- 同色の辺接触違反、角接触不足、盤面外、重なりをエラー理由として表示できるようにする。

### 7.5 ピーストレイ

各プレイヤーごとに、未使用ピース一覧を表示する。

- 置いたピースはトレイから除外、または半透明表示にする。
- 人間の手番では自分の未使用ピースのみ選択可能。
- AIの手番では全ピース選択を無効化する。
- 各ピースは回転・反転後のプレビューを表示する。

### 7.6 人間操作

最低限、以下を実装する。

| 操作 | 内容 |
|---|---|
| ピースクリック | ピース選択 |
| ボード上ホバー | 現在の向きで配置プレビュー |
| ボードクリック | 合法なら仮配置、もう一度クリックまたは確定ボタンで確定 |
| `R` | 選択ピースを90度回転 |
| `F` | 選択ピースを左右反転 |
| `Enter` | 合法プレビューを確定 |
| `Esc` | 選択解除 |
| `Space` | AI vs AI の一時停止/再開 |

ドラッグ&ドロップはv0.2以降でよい。初期実装はクリック操作を優先する。

### 7.7 コントロール

- `New Game`
- `Undo` 開発・検証用。正式対局では無効化可能。
- `Restart`
- `Copy Game JSON`
- `Load Game JSON`
- `AI Speed`
- `AI Engine`
  - `Random`
  - `Heuristic`
  - `MCTS`
  - `PolicyValueMCTS`

### 7.8 AI思考表示

AI手番では以下を表示する。

```ts
type AiThinkingStats = {
  engine: string;
  thinkingMs: number;
  legalMoves: number;
  selectedAction: number;
  selectedPieceId?: PieceId;
  simulations?: number;
  nodes?: number;
  value?: number;
};
```

### 7.9 状態永続化

`localStorage` に保存する。

```ts
type SavedSettings = {
  mode: GameMode;
  humanPlayer: PlayerId;
  aiConfig: [AiConfig, AiConfig];
  startPolicy: StartPolicy;
};
```

棋譜は `GameState.moveHistory` をJSONでコピーできるようにする。

---

## 8. AI実装仕様

### 8.1 AIエンジン共通インターフェース

```ts
type AiConfig = {
  engine: "random" | "heuristic" | "mcts" | "policy_value_mcts";
  maxThinkingMs: number;
  simulations?: number;
  temperature?: number;
  modelPath?: string;
};

type AiDecision = {
  move: AnyMove;
  stats: AiThinkingStats;
};

interface AiEngine {
  decide(state: GameState, config: AiConfig): Promise<AiDecision>;
}
```

AIはWebWorkerで実行し、UIスレッドをブロックしない。

### 8.2 Random AI

- `generateLegalMoves(state)` から一様ランダムに選ぶ。
- 合法手がパスのみならパスする。
- テスト・ベースライン用。

### 8.3 Heuristic AI

初期の教師・ベースラインとして実装する。

評価関数:

```ts
score(move) =
  + 10.0 * placedUnitSquares
  +  2.0 * ownCornerDelta
  -  1.5 * ownEdgeForbiddenDelta
  +  1.0 * opponentCornerBlockedDelta
  -  0.5 * leavesLargePiecePenalty
  +  0.2 * centerAdvance
```

各項目:

- `placedUnitSquares`: 置いたピースのマス数。
- `ownCornerDelta`: 配置後に増える自分の合法角候補数。
- `ownEdgeForbiddenDelta`: 自分の辺接触禁止により将来使いづらくなる周辺マスの増加量。
- `opponentCornerBlockedDelta`: 相手の角候補を占有・封鎖した数。
- `leavesLargePiecePenalty`: 終盤に大きいピースを残すペナルティ。
- `centerAdvance`: 盤面中央方向への展開。中心 `(6.5, 6.5)` に近いセルを含むほど加点。

公式説明書の戦略ヒントでは、大きいピースを序盤に置く、相手に囲い込まれないようにする、相手の残りピースも見る、といった指針が示されているため、ヒューリスティックはそれに沿う。[^mattel-fwg43]

### 8.4 MCTS AI

ニューラルネットなしのMCTSを実装する。

- prior: 一様分布、または Heuristic softmax。
- rollout: 原則しない。葉評価は Heuristic value を使う。
- selection: PUCT。
- expansion: legal moves を全展開。ただし合法手が多すぎる場合は Heuristic 上位 `maxChildren` 件に制限可能。

PUCT:

```text
U(s,a) = Q(s,a) + c_puct * P(s,a) * sqrt(N(s)) / (1 + N(s,a))
```

初期値:

```ts
const MCTS_DEFAULTS = {
  simulations: 128,
  cPuct: 1.5,
  maxChildren: 256,
};
```

### 8.5 学習AI: Policy-Value MCTS

最終的な主力AIは AlphaZero 系の自己対戦学習とする。AlphaGo Zero / AlphaZero 系では、自己対戦で生成したデータから方策と価値を予測するニューラルネットワークを訓練し、そのネットワークをMCTSの prior/value として使う。[^nature-agz][^openspiel-az]

#### 8.5.1 ネットワーク入出力

入力は現在手番プレイヤー視点に正規化する。

```python
# shape = [C, 14, 14]
C = 48
```

推奨チャンネル:

| Channel | 内容 |
|---:|---|
| 0 | 自分の占有セル |
| 1 | 相手の占有セル |
| 2 | 自分の角候補セル |
| 3 | 自分の辺接触禁止セル |
| 4 | 相手の角候補セル |
| 5 | 相手の辺接触禁止セル |
| 6 | START_A |
| 7 | START_B |
| 8..28 | 自分の残ピース21種を盤面全体にbroadcast |
| 29..49 | 相手の残ピース21種を盤面全体にbroadcast |

上表では50チャンネルになるため、実装では次のどちらかを選ぶ。

初期実装では **50チャンネル版**を採用する。

```python
INPUT_CHANNELS = 50
```

出力:

```python
policy_logits_place: [91, 14, 14]
policy_logit_pass: [1]
value: [1]  # current player perspective, range [-1, 1]
```

policy logits は `91 * 14 * 14 + 1 = 17837` action に対応する。

#### 8.5.2 モデル構造

初期モデル:

```text
Input [50,14,14]
 -> Conv 3x3, channels=64, padding=1
 -> ResidualBlock x 4
 -> PolicyHead: Conv 1x1, out_channels=91 -> [91,14,14]
 -> PassHead: GlobalAvgPool -> Linear 64->1
 -> ValueHead: GlobalAvgPool -> Linear 64->64 -> ReLU -> Linear 64->1 -> tanh
```

初期モデルは小さくし、ブラウザ推論を優先する。ONNX Runtime Web は JavaScript APIでWebアプリ内に機械学習モデルを組み込めるため、学習済みモデルはONNX形式でエクスポートしてブラウザから読み込む。[^onnx-web]

#### 8.5.3 学習ターゲット

1局の自己対戦から、各手番について次を保存する。

```python
TrainingSample = {
    "state": encoded_state,        # float32 [50,14,14]
    "legal_mask": legal_mask,      # uint8 [17837]
    "policy": visit_distribution,  # float32 [17837]
    "z": value_target,             # float32 [-1,1]
}
```

`z` は、その局面の手番プレイヤーから見た最終結果。

```python
score_diff = final_score[current_player] - final_score[opponent]
z = clamp(score_diff / 89.0, -1.0, 1.0)
```

勝敗のみで学習したい場合は、設定で次に切り替え可能。

```python
z = 1.0 if score_diff > 0 else -1.0 if score_diff < 0 else 0.0
```

#### 8.5.4 損失関数

```text
loss = policy_loss + value_weight * value_loss + l2_weight * l2
```

```python
policy_loss = cross_entropy(masked_policy_logits, visit_distribution)
value_loss = mse(predicted_value, z)
value_weight = 0.5
l2_weight = 1e-4
```

#### 8.5.5 自己対戦MCTS

自己対戦では Policy-Value MCTS を使う。

初期値:

```python
SELFPLAY_DEFAULTS = {
    "simulations_per_move": 96,
    "c_puct": 1.5,
    "dirichlet_alpha": 0.15,
    "dirichlet_epsilon": 0.25,
    "temperature_turns": 10,
    "temperature_after": 0.25,
    "max_children": 256
}
```

- root にのみ Dirichlet noise を加える。
- 序盤10手は探索分布からサンプリングする。
- 11手目以降は温度を下げる。
- 合法手が `maxChildren` を超える場合、policy prior上位を残す。ただし初手・終盤では合法手の全展開を優先する。
- パスが唯一の合法手ならMCTSを省略して即パスする。

#### 8.5.6 学習ループ

```text
for iteration in 1..N:
  1. current_model で自己対戦を生成
  2. replay_buffer にサンプル追加
  3. replay_buffer からミニバッチ学習
  4. challenger_model を baseline と対局評価
  5. 勝率・平均スコア差が基準を超えたら promote
  6. ONNX export
```

昇格条件:

```python
PROMOTION = {
    "games": 100,
    "min_win_rate": 0.55,
    "min_avg_score_diff": 1.0
}
```

#### 8.5.7 初期ブートストラップ

学習開始直後はニューラルネットのpriorが無意味なため、以下の順で進める。

1. `Random AI` と `Heuristic AI` の対局を生成する。
2. Heuristicの選択手を one-hot policy として教師データ化する。
3. policy/value model を事前学習する。
4. 事前学習済みモデルで self-play MCTS を開始する。
5. 以降は自己対戦データを主データにする。

---

## 9. 学習実装ディレクトリ

```text
blokus-ai/
├─ apps/
│  └─ web/
│     ├─ src/
│     │  ├─ components/
│     │  │  ├─ BoardCanvas.tsx
│     │  │  ├─ PieceTray.tsx
│     │  │  ├─ GameHeader.tsx
│     │  │  ├─ AiStatsPanel.tsx
│     │  │  └─ GameControls.tsx
│     │  ├─ state/
│     │  │  └─ gameStore.ts
│     │  ├─ ai/
│     │  │  ├─ randomAi.ts
│     │  │  ├─ heuristicAi.ts
│     │  │  ├─ mctsAi.ts
│     │  │  └─ policyValueAi.ts
│     │  ├─ workers/
│     │  │  └─ aiWorker.ts
│     │  └─ App.tsx
│     └─ vite.config.ts
├─ packages/
│  └─ core/
│     ├─ src/
│     │  ├─ constants.ts
│     │  ├─ pieces.json
│     │  ├─ pieces.ts
│     │  ├─ orientation.ts
│     │  ├─ board.ts
│     │  ├─ rules.ts
│     │  ├─ move.ts
│     │  ├─ action.ts
│     │  ├─ scoring.ts
│     │  └─ index.ts
│     └─ tests/
│        ├─ pieces.test.ts
│        ├─ rules.test.ts
│        ├─ scoring.test.ts
│        └─ fixtures.test.ts
├─ training/
│  ├─ blokus_duo/
│  │  ├─ pieces.py
│  │  ├─ action.py
│  │  ├─ env.py
│  │  ├─ encoder.py
│  │  ├─ model.py
│  │  ├─ mcts.py
│  │  ├─ selfplay.py
│  │  ├─ train.py
│  │  ├─ evaluate.py
│  │  └─ export_onnx.py
│  ├─ configs/
│  │  ├─ bootstrap.yaml
│  │  └─ selfplay.yaml
│  └─ runs/
├─ public/
│  └─ models/
│     └─ blokus-duo-latest.onnx
└─ docs/
   └─ blokus_ai_duo_spec.md
```

### 9.1 共有データ

- `packages/core/src/pieces.json` をTypeScriptとPythonの両方で読み込む。
- Python側で別定義を書かない。
- orientation生成ロジックはTS/Pythonで同じテストを通す。

---

## 10. WebWorker通信仕様

### 10.1 Request

```ts
type AiWorkerRequest =
  | {
      type: "INIT";
      modelPath?: string;
    }
  | {
      type: "THINK";
      requestId: string;
      state: GameState;
      config: AiConfig;
    }
  | {
      type: "CANCEL";
      requestId: string;
    };
```

### 10.2 Response

```ts
type AiWorkerResponse =
  | {
      type: "READY";
      modelLoaded: boolean;
    }
  | {
      type: "DECISION";
      requestId: string;
      decision: AiDecision;
    }
  | {
      type: "ERROR";
      requestId?: string;
      message: string;
      stack?: string;
    };
```

### 10.3 制約

- Worker内で `GameState` を受け取ったら、必ず合法手を再計算する。
- Workerから返った手も、メインスレッド側で再度 `isLegalMove` を通す。
- 違法手が返った場合は、そのAIを失敗扱いにして `Heuristic AI` にフォールバックする。

---

## 11. Python学習CLI

### 11.1 Bootstrap data

```bash
python -m training.blokus_duo.selfplay \
  --engine heuristic \
  --games 1000 \
  --out training/runs/bootstrap/data.jsonl \
  --start-policy fixedStart \
  --seed 1
```

### 11.2 Train

```bash
python -m training.blokus_duo.train \
  --data training/runs/bootstrap/data.jsonl \
  --out training/runs/models/model_iter_0001.pt \
  --epochs 5 \
  --batch-size 256 \
  --lr 3e-4 \
  --seed 1
```

### 11.3 Self-play

```bash
python -m training.blokus_duo.selfplay \
  --engine policy_value_mcts \
  --model training/runs/models/model_iter_0001.pt \
  --games 200 \
  --simulations 96 \
  --out training/runs/selfplay/iter_0002.jsonl \
  --seed 2
```

### 11.4 Evaluate

```bash
python -m training.blokus_duo.evaluate \
  --challenger training/runs/models/model_iter_0002.pt \
  --baseline training/runs/models/model_iter_0001.pt \
  --games 100 \
  --simulations 128 \
  --seed 3
```

### 11.5 Export ONNX

```bash
python -m training.blokus_duo.export_onnx \
  --model training/runs/models/model_iter_0002.pt \
  --out public/models/blokus-duo-latest.onnx
```

---

## 12. テスト仕様

### 12.1 ピーステスト

必須テスト:

1. ピース数が21である。
2. 各ピースのセル数が公式構成と一致する。
3. 各プレイヤーの総セル数が89である。
4. orientation合計が91である。
5. 各orientationは正規化済みである。
6. 各pieceId内に重複orientationがない。

期待値:

```ts
expect(pieceIds.length).toBe(21);
expect(totalUnitSquares).toBe(89);
expect(totalUniqueOrientations).toBe(91);
```

### 12.2 初期合法手数

本仕様のピース定義・座標定義に基づく期待値:

```ts
// chooseStart: 先攻は A または B のどちらを覆ってもよい
expect(generateLegalMoves(initialState("chooseStart")).length).toBe(828);

// fixedStart: Player 0 は START_A のみ
expect(generateLegalMoves(initialState("fixedStart")).length).toBe(414);
```

### 12.3 配置ルールテスト

- 盤面外配置は違法。
- 既存セルへの重なりは違法。
- 初手でスタートポイントを覆わない配置は違法。
- 2手目以降、同色辺接触は違法。
- 2手目以降、同色角接触がない配置は違法。
- 異色辺接触は合法。
- 合法手が存在するときのパスは違法。
- 合法手が存在しないときのパスは合法。

### 12.4 スコアテスト

```ts
// 全ピース未配置
expect(score(emptyFinishedStateForPlayer)).toBe(-89);

// 全配置、最後がI1でない
expect(score(completedStateLastNotI1)).toBe(15);

// 全配置、最後がI1
expect(score(completedStateLastI1)).toBe(20);

// 3マス2個、4マス1個が残る
expect(score(stateWithRemainingUnits10)).toBe(-10);
```

### 12.5 AIテスト

- Random AI が1000回連続で違法手を返さない。
- Heuristic AI が1000回連続で違法手を返さない。
- MCTS AI が `maxThinkingMs` を大幅に超過しない。
- PolicyValue AI はモデル未ロード時に Heuristic AI へフォールバックする。
- legal mask の `1` の数が `generateLegalMoves` の件数と一致する。

### 12.6 Python/TypeScript整合テスト

- 同一 `pieces.json` から同一orientation数を生成する。
- 同一fixture stateに対して、TSとPythonの合法action setが一致する。
- 同一fixture stateに対して、TSとPythonのscoreが一致する。

---

## 13. 性能目標

初期目標:

| 項目 | 目標 |
|---|---:|
| 初期合法手生成 | 50ms未満 |
| 中盤合法手生成 | 20ms未満 |
| Random AI | 10ms未満 |
| Heuristic AI | 200ms未満 |
| MCTS 128 simulations | 3秒未満 |
| ONNX推論 | 100ms未満 |
| UIフレーム落ち | AI思考中も操作不能感を出さない |

性能目標は開発環境に依存するため、CIでは厳密な時間アサーションにしない。ローカルbenchmarkとして管理する。

---

## 14. GitHub Pages公開仕様

### 14.1 ビルド

```bash
pnpm install
pnpm -w test
pnpm --filter @blokus-ai/web build
```

### 14.2 Vite設定

リポジトリが `https://<user>.github.io/blokus-ai/` に公開される場合:

```ts
// apps/web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/blokus-ai/",
  plugins: [react()],
});
```

ユーザーサイト `https://<user>.github.io/` またはカスタムドメイン直下なら `base: "/"`。

### 14.3 GitHub Actions

```yaml
name: deploy
on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w test
      - run: pnpm --filter @blokus-ai/web build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/web/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

## 15. 実装順序

最短で学習AIまで到達するため、順序は以下に固定する。

### PR 1: Core rules

- `pieces.json`
- orientation generator
- board utilities
- legal move generator
- apply move
- scoring
- tests

完了条件:

- 12章のピース・ルール・スコアテストが通る。
- 初期合法手数 `828 / 414` が一致する。

### PR 2: Minimal UI

- 14 x 14 board
- piece tray
- click-based placement
- Human vs Random AI
- game log

完了条件:

- 人間が1局最後までプレイできる。
- 違法手理由が表示される。
- AIが違法手を返さない。

### PR 3: Heuristic + AI vs AI

- Heuristic AI
- AI vs AI autoplay
- pause / step
- AI stats panel

完了条件:

- AI vs AIを100局回せる。
- すべての局が正常終局する。
- 棋譜JSONが保存できる。

### PR 4: Python training env

- Python env
- legal mask
- state encoder
- random/heuristic self-play
- TS/Python fixture一致テスト

完了条件:

- Pythonが1万局のrandom/heuristic self-playを生成できる。
- 生成データに違法手が0件。

### PR 5: Policy-value model

- PyTorch model
- train loop
- evaluate loop
- ONNX export

完了条件:

- bootstrapデータでlossが低下する。
- ONNXをweb側でロードできる。
- model inferenceからpolicy/valueを取得できる。

### PR 6: PolicyValueMCTS

- browser-side inference
- worker-side MCTS
- legal mask application
- model fallback

完了条件:

- PolicyValueMCTS が違法手を返さない。
- Heuristic AI相手に100局評価できる。
- 昇格基準を満たすモデルを `public/models/blokus-duo-latest.onnx` に配置できる。

---

## 16. 受け入れ基準

v0.1完了条件:

- 2人制Blokus Duoのルールが正しく実装されている。
- Human vs AI がブラウザで完走する。
- AI vs AI がブラウザで完走する。
- ゲーム終了時に公式スコアが表示される。
- 合法手生成、スコア、初期合法手数のテストが通る。
- 学習用Python環境が棋譜データを生成できる。
- ONNXモデルをブラウザでロードする導線がある。

v0.2完了条件:

- PolicyValueMCTS がUIから選択できる。
- self-play -> train -> evaluate -> export -> web deploy の一連の流れがREADME通りに動く。
- Heuristic AIに対して昇格基準を満たす学習AIが1つ以上ある。

---

## 17. レビュー・修正ログ

### Review 1: ルール正確性

指摘:

- 2人制Blokusの対象が曖昧だと、クラシック版2人ルールとDuo型が混同される。
- スタートポイント座標が実装に必要。
- スコア方式は「残りマスが少ない方が勝ち」と「高度スコア」が混在しやすい。

修正:

- 対象を Blokus Duo / Travel Blokus 型に固定。
- 盤面14x14、スタートポイント `(4,4)`, `(9,9)` を明記。
- スコアを `-残りマス + 全配置15 + I1最後5` に固定。

### Review 2: 実装可能性

指摘:

- 学習AIには固定action spaceとlegal maskが必要。
- TSとPythonでルールがズレるリスクがある。
- UIとAI思考を同一スレッドに置くと操作性が悪くなる。

修正:

- action size `17837` を定義。
- `pieces.json` をTS/Python共有データにした。
- WebWorker通信仕様を追加。
- TS/Python fixture一致テストを追加。

### Review 3: テスト容易性・学習継続性

指摘:

- 初期合法手数などの固定期待値がないと、合法手生成の退行検知が弱い。
- 学習AIの昇格条件がないと、強くなったか判断できない。
- モデル未ロード・違法手返却時のフォールバックが必要。

修正:

- 初期合法手数 `chooseStart=828`, `fixedStart=414` を受け入れテストに追加。
- 昇格条件 `100局, 勝率55%以上, 平均スコア差+1以上` を追加。
- PolicyValue AIのフォールバック仕様を追加。

---

## 18. 未確定だが実装を止めない項目

- UI上で `Blokus` 名をどこまで使うかは、公開時に商標・権利表記を確認する。技術実装上は `BlokusAI Duo` 仮称とする。
- モデルサイズ、MCTS simulation数、heuristic重みは初期値であり、実測で調整する。
- 学習AIの最終的な強さは自己対戦量と評価基準に依存する。まずはパイプラインを完成させることを優先する。

---

## 参考資料

[^mattel-jp]: Mattel Japan, `FWG43-ブロックスデュオ_IS`, https://mattel.co.jp/wp-content/uploads/2022/07/blokus_duo.pdf
[^mattel-fwg43]: Mattel Consumer Support, `FWG43-Eng.pdf`, https://service.mattel.com/instruction_sheets/FWG43-Eng.pdf
[^mattel-r1984]: Mattel Consumer Support, `R1984-0920.pdf`, https://service.mattel.com/instruction_sheets/R1984-0920.pdf
[^bgg-start]: BoardGameGeek image note for Blokus Duo, https://boardgamegeek.com/image/96716/blokus-duo
[^github-pages]: GitHub Docs, GitHub Pages documentation, https://docs.github.com/pages
[^vite-pages]: Vite Docs, Deploying a Static Site, https://vite.dev/guide/static-deploy
[^onnx-web]: ONNX Runtime Docs, ONNX Runtime Web, https://onnxruntime.ai/docs/tutorials/web/
[^nature-agz]: Silver et al., `Mastering the game of Go without human knowledge`, Nature, https://www.nature.com/articles/nature24270
[^openspiel-az]: Google DeepMind OpenSpiel, AlphaZero documentation, https://github.com/google-deepmind/open_spiel/blob/master/docs/alpha_zero.md
