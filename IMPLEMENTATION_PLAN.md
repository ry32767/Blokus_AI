# BlokusAI Duo Implementation Plan

## 1. 目的

`blokus_ai_duo_spec.md` に定義された 2 人制 Blokus Duo 型 AI 対戦アプリを、GitHub Pages で公開できる静的 Web アプリとして実装する。

初期到達点は v0.1 とし、以下を優先する。

- 14 x 14 の Blokus Duo ルールを正確に実装する
- Human vs AI と AI vs AI をブラウザ上で完走できるようにする
- 公式スコア方式、合法手生成、パス、終局判定をテストで固定する
- GitHub Pages へ静的ビルドをデプロイできる構成にする
- 将来の Policy-Value MCTS と Python 学習環境に拡張できる構成にする

現状のリポジトリは `AGENTS.md`、`README.md`、`blokus_ai_duo_spec.md` のみで、`package.json`、フレームワーク設定、GitHub Actions workflow は未作成である。

## 2. 使用する技術スタック

### Web アプリ

- Language: TypeScript
- Runtime: Node.js
- Package manager: pnpm workspace
- Frontend framework: React
- Build tool: Vite
- Styling: CSS Modules または通常の CSS。初期実装では追加 UI ライブラリを使わない
- State management: React reducer / context を中心にし、必要なら `src/state/gameStore.ts` に集約する
- AI execution: Vite の WebWorker 対応を使い、AI 思考を UI スレッドから分離する
- Testing: Vitest
- Browser check: Playwright またはローカルブラウザ確認
- Hosting: GitHub Pages
- CI/CD: GitHub Actions

### 学習・モデル

- Language: Python
- Core ML: PyTorch
- Export: ONNX
- Browser inference: ONNX Runtime Web
- Training data: JSONL
- Shared piece definition: `packages/core/src/pieces.json` を TypeScript / Python の両方から読み込む

### 導入タイミング

- v0.1 では Web アプリ、Core rules、Random / Heuristic / MCTS までを優先する
- PyTorch、ONNX Runtime Web、Python 学習 CLI は後続フェーズで追加する
- 依存関係は各フェーズで必要になった時点で追加し、README に目的を明記する

## 3. 作成・変更するファイル

### 初期足場

- `package.json`: workspace scripts と package manager 定義
- `pnpm-workspace.yaml`: `apps/*` と `packages/*` を workspace 化
- `tsconfig.base.json`: 共通 TypeScript 設定
- `.gitignore`: `node_modules`, `dist`, `.env*`, training outputs などを除外
- `README.md`: プロジェクト概要、起動、テスト、ビルド、デプロイ手順を更新

### Web アプリ

- `apps/web/package.json`
- `apps/web/index.html`
- `apps/web/vite.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/styles/global.css`
- `apps/web/src/components/BoardCanvas.tsx`
- `apps/web/src/components/PieceTray.tsx`
- `apps/web/src/components/GameHeader.tsx`
- `apps/web/src/components/GameControls.tsx`
- `apps/web/src/components/AiStatsPanel.tsx`
- `apps/web/src/components/GameLog.tsx`
- `apps/web/src/components/SettingsDialog.tsx`
- `apps/web/src/state/gameStore.ts`
- `apps/web/src/state/persistence.ts`
- `apps/web/src/ai/randomAi.ts`
- `apps/web/src/ai/heuristicAi.ts`
- `apps/web/src/ai/mctsAi.ts`
- `apps/web/src/ai/policyValueAi.ts`
- `apps/web/src/workers/aiWorker.ts`

### Core package

- `packages/core/package.json`
- `packages/core/src/constants.ts`
- `packages/core/src/types.ts`
- `packages/core/src/pieces.json`
- `packages/core/src/pieces.ts`
- `packages/core/src/orientation.ts`
- `packages/core/src/board.ts`
- `packages/core/src/rules.ts`
- `packages/core/src/move.ts`
- `packages/core/src/action.ts`
- `packages/core/src/scoring.ts`
- `packages/core/src/serialization.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/pieces.test.ts`
- `packages/core/tests/rules.test.ts`
- `packages/core/tests/scoring.test.ts`
- `packages/core/tests/action.test.ts`
- `packages/core/tests/fixtures.test.ts`

### 学習環境

- `training/blokus_duo/pieces.py`
- `training/blokus_duo/action.py`
- `training/blokus_duo/env.py`
- `training/blokus_duo/encoder.py`
- `training/blokus_duo/model.py`
- `training/blokus_duo/mcts.py`
- `training/blokus_duo/selfplay.py`
- `training/blokus_duo/train.py`
- `training/blokus_duo/evaluate.py`
- `training/blokus_duo/export_onnx.py`
- `training/configs/bootstrap.yaml`
- `training/configs/selfplay.yaml`
- `training/tests/`

### 静的アセット・モデル

- `apps/web/public/models/`: ブラウザで読み込む ONNX モデル配置先
- `apps/web/public/`: favicon や必要最小限の静的アセット

### GitHub Pages / CI

- `.github/workflows/deploy.yml`: GitHub Pages deploy
- 必要に応じて `.github/workflows/ci.yml`: test / build のみを行う CI

## 4. 画面構成

初期実装は単一ページ SPA とする。

- `/`: `GameApp`
- `/settings`: ルートは作らず、画面内モーダルで代替する
- `/replay/:id`: v0.2 以降。初期実装では非対象

デスクトップでは 3 カラム構成にする。

- 上部: モード、手番、スコア、主要操作
- 左: Player 0 の状態、未使用ピース、AI 設定
- 中央: 14 x 14 board
- 右: Player 1 の状態、未使用ピース、AI 設定
- 下部: game log、AI stats、JSON copy/load

モバイルでは縦積みにする。

- Header
- Board
- Current player's tray
- Controls
- AI stats / log

初期操作はクリック中心にする。

- ピース選択
- `R` で回転
- `F` で左右反転
- ボード hover で配置プレビュー
- ボード click または `Enter` で確定
- `Esc` で選択解除
- `Space` で AI vs AI の一時停止 / 再開

## 5. コンポーネント構成

### `App`

- mode、selected piece、preview、AI 実行状態を統合する
- `GameHeader`、`BoardCanvas`、`PieceTray`、`GameControls`、`AiStatsPanel`、`GameLog` を配置する
- AI 手番では worker に `THINK` を送信し、返却手を再検証してから適用する

### `BoardCanvas`

- 14 x 14 board を表示する
- start point `(4,4)` と `(9,9)` を表示する
- 占有セル、直前配置、合法 / 違法 preview を描画する
- hover / click / keyboard 操作を親へ通知する

初期実装では HTML grid でもよいが、性能と描画制御を考慮して canvas 実装を第一候補にする。

### `PieceTray`

- 各 player の 21 ピースを表示する
- 未使用 / 使用済み / 選択中 / AI 手番中 disabled を区別する
- 小さな SVG または CSS grid でピース形状を描画する

### `GameHeader`

- mode、current player、turn、score、status を表示する
- ゲーム終了時は winner / draw を表示する

### `GameControls`

- New Game
- Undo
- Restart
- Pass
- Copy Game JSON
- Load Game JSON
- AI Speed
- AI Engine
- start policy

### `AiStatsPanel`

- engine
- thinkingMs
- legalMoves
- selectedAction
- selectedPieceId
- simulations / nodes / value

### `GameLog`

- `MoveRecord[]` を時系列表示する
- player、piece、position、pass、scoreAfter、thinkingMs を表示する

### `SettingsDialog`

- game mode
- human player
- AI engine / simulations / speed
- start policy
- model path

## 6. データ構造

仕様書の型を基本形として採用する。

### Board

- 実行時: `Int8Array` length `196`
- serialize 時: `number[]`
- `-1`: empty
- `0`: Player 0
- `1`: Player 1

### GameState

- `board`
- `currentPlayer`
- `turn`
- `status`
- `startPolicy`
- `startAssignment`
- `remainingPieces`
- `placedPieces`
- `lastPlacedPiece`
- `forcedPassed`
- `consecutivePasses`
- `moveHistory`

### Piece / Orientation

- `PieceId` は仕様書の 21 種で固定する
- `pieces.json` に基準形状を保存する
- 8 変換から orientation を生成し、正規化、ソート、重複排除する
- 期待 orientation 合計は `91`

### Move / Action

- `Move`: placement
- `PassMove`: pass
- `AnyMove`: placement または pass
- `encodeAction` / `decodeAction` は固定 action space に対応する
- `ACTION_SIZE = 17837`
- `LegalMask = Uint8Array`

### Scoring

- `score = -remainingUnitSquares + completionBonus + monominoLastBonus`
- 完全配置で `+15`
- 最後が `I1` なら追加 `+5`
- 同点は draw

### Persistence

- `SavedSettings` を `localStorage` に保存する
- 棋譜は `GameState.moveHistory` を JSON として copy / load できるようにする

## 7. GitHub Pages 対応方針

- アプリは SSR なしの静的 SPA として構成する
- Vite の `build.outDir` は `apps/web/dist`
- server-side API、認証、秘密鍵、サーバー常駐処理は追加しない
- asset path は Vite の `base` で制御する
- Project Pages の場合は `base: "/Blokus_AI/"` または公開 repo 名に合わせる
- User / Organization Pages または custom domain 直下の場合は `base: "/"`
- base path は環境変数で切り替え可能にする

例:

```ts
const base = process.env.GITHUB_PAGES_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
});
```

GitHub Actions では Project Pages 前提なら `GITHUB_PAGES_BASE=/Blokus_AI/` を build 時に渡す。

## 8. GitHub Actions デプロイ方針

`.github/workflows/deploy.yml` を作成する。

- trigger: `main` branch への push
- permissions: `contents: read`, `pages: write`, `id-token: write`
- Node.js: 22
- package manager: pnpm
- install: `pnpm install --frozen-lockfile`
- test: `pnpm -w test`
- build: `pnpm --filter @blokus-ai/web build`
- artifact path: `apps/web/dist`
- deploy: `actions/deploy-pages@v4`

workflow を追加したら README に以下を追記する。

- GitHub Pages の有効化方法
- 公開 URL
- Project Pages / User Pages の base path 設定
- 手動確認コマンド

## 9. 実装ステップ

### Step 0: Project scaffold

- pnpm workspace を作成する
- `apps/web` と `packages/core` を作成する
- Vite React TypeScript を設定する
- Vitest、TypeScript、build scripts を設定する
- README と `.gitignore` を更新する

完了条件:

- `pnpm install`
- `pnpm -w test`
- `pnpm --filter @blokus-ai/web build`

### Step 1: Core rules

- `pieces.json` を作成する
- orientation generator を実装する
- board utilities を実装する
- legal move generator を実装する
- `applyMove`、turn advance、terminal 判定を実装する
- scoring を実装する
- action encode/decode と legal mask を実装する

完了条件:

- ピース数 21
- orientation 合計 91
- total unit squares 89
- 初期合法手数 `chooseStart = 828`
- 初期合法手数 `fixedStart = 414`
- 盤面外、重なり、同色辺接触、角接触不足、pass 制約のテストが通る

### Step 2: Minimal UI

- board を表示する
- start point と occupied cells を描画する
- piece tray を表示する
- human click placement を実装する
- legal / illegal preview と理由表示を実装する
- Human vs Random AI を実装する
- game log を表示する

完了条件:

- 人間が 1 局最後までプレイできる
- 合法手がある間は pass できない
- Random AI が違法手を返さない

### Step 3: Heuristic AI + AI vs AI

- Heuristic AI を実装する
- AI worker を導入する
- AI vs AI autoplay / pause / step / speed を実装する
- AI stats panel を実装する
- Copy / Load Game JSON を実装する

完了条件:

- AI vs AI を 100 局連続で正常終局できる
- 棋譜 JSON をコピー / 読み込みできる
- worker から返る手を main thread で再検証する

### Step 4: MCTS AI

- Heuristic prior または uniform prior の MCTS を実装する
- PUCT、simulations、maxChildren を設定可能にする
- maxThinkingMs を尊重する

完了条件:

- MCTS が違法手を返さない
- 128 simulations が実用的な時間で完了する
- AI stats に nodes / simulations / value を表示する

### Step 5: Python training env

- Python 側の env、rules、action、encoder を実装する
- `pieces.json` を共有して読み込む
- random / heuristic self-play CLI を実装する
- TS / Python fixture 一致テストを作成する

完了条件:

- Python self-play で違法手が 0 件
- TS と Python の orientation、legal action set、score が fixture で一致する

### Step 6: Policy-value model

- PyTorch model を実装する
- bootstrap data で train できるようにする
- evaluate CLI を実装する
- ONNX export を実装する

完了条件:

- bootstrap data で loss が低下する
- ONNX model を `apps/web/public/models/` に出力できる

### Step 7: PolicyValueMCTS in browser

- ONNX Runtime Web を導入する
- policy / value inference を worker で実行する
- legal mask を policy logits に適用する
- model 未ロード時は Heuristic AI にフォールバックする

完了条件:

- PolicyValueMCTS が UI から選択できる
- model 未ロード時も対局が継続できる
- Heuristic AI 相手に評価できる

### Step 8: GitHub Pages deploy

- deploy workflow を作成する
- base path を設定する
- production build を GitHub Pages artifact として upload する
- README にデプロイ手順を書く

完了条件:

- GitHub Actions で build / test / deploy が完了する
- 公開 URL で JS / CSS / model asset が読み込める

## 10. ビルド・確認方法

現時点では `package.json` がないため、以下は実装後に作成する予定のコマンドである。

```bash
pnpm install
pnpm -w test
pnpm -w lint
pnpm -w typecheck
pnpm --filter @blokus-ai/web build
pnpm --filter @blokus-ai/web dev
```

確認項目:

- unit tests
- lint
- typecheck
- production build
- local browser check
- GitHub Pages base path で asset が壊れないこと
- Human vs AI が完走すること
- AI vs AI が複数局完走すること
- browser console に重大な error がないこと

Python 学習環境の確認:

```bash
python -m training.blokus_duo.selfplay --engine heuristic --games 10 --out training/runs/bootstrap/data.jsonl --start-policy fixedStart --seed 1
python -m training.blokus_duo.train --data training/runs/bootstrap/data.jsonl --out training/runs/models/model_iter_0001.pt --epochs 1 --batch-size 32 --lr 3e-4 --seed 1
python -m training.blokus_duo.export_onnx --model training/runs/models/model_iter_0001.pt --out apps/web/public/models/blokus-duo-latest.onnx
```

## 11. 完了条件

### v0.1

- Blokus Duo の 14 x 14 ルールが仕様通りに実装されている
- `chooseStart` と `fixedStart` の初手ルールが実装されている
- 初期合法手数 `828 / 414` がテストで保証されている
- スコア、パス、終局判定がテストで保証されている
- Human vs AI がブラウザで完走する
- AI vs AI がブラウザで完走する
- Random / Heuristic / MCTS が違法手を返さない
- ゲーム終了時に公式スコアと winner / draw が表示される
- `localStorage` に設定が保存される
- 棋譜 JSON を copy / load できる
- production build が成功する
- GitHub Pages 用の base path が設定されている
- GitHub Actions deploy workflow がある
- README に起動、build、test、deploy 手順がある

### v0.2

- Python 学習環境が self-play data を生成できる
- TS / Python の fixture 一致テストがある
- Policy-value model を学習、評価、ONNX export できる
- ONNX model を browser worker からロードできる
- PolicyValueMCTS が UI から選択できる
- self-play -> train -> evaluate -> export -> web deploy の流れが README 通りに動く

## 12. リスクや不明点

### 実装前に確認したい点

- GitHub Pages の種類: User / Organization Pages か Project Pages か
- 公開 URL と Vite `base`: 現 repo 名に合わせるなら `/Blokus_AI/` か、仕様例の `/blokus-ai/` か
- package manager: 仕様に合わせて pnpm でよいか
- 初期実装の完了範囲: v0.1 までか、Python 学習環境まで同時に進めるか
- アプリ名: 公開時に `Blokus` 名をそのまま使うか、商標リスクを避ける表示名にするか
- ONNX model を repo に含めるか、生成手順だけを管理するか

### 技術リスク

- 合法手生成は初期局面で手数が多いため、UI 操作中の再計算をキャッシュまたは worker 化する必要がある
- TS と Python のルール実装がズレる可能性があるため、fixture 一致テストを早期に用意する
- MCTS は思考時間が伸びやすいため、`maxChildren`、`simulations`、`maxThinkingMs` を UI から調整可能にする
- ONNX Runtime Web と model asset は GitHub Pages の base path 影響を受けるため、model URL の生成を Vite base に合わせる
- training outputs は大きくなるため、`training/runs/` は原則 `.gitignore` 対象にする
- 公開静的サイトでは秘密情報を扱えないため、外部 API や private model registry には依存しない

### ロールバック方針

- 各 step を小さな PR 単位で進める
- Core rules の退行は unit tests で検知する
- AI 追加で UI が不安定になった場合は AI engine selector から該当 engine を一時的に無効化できるようにする
- GitHub Pages deploy に問題が出た場合は workflow の deploy job のみを戻し、ローカル build / test は維持する
