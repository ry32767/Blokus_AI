# BlokusAI Duo

GitHub Pages で公開できる、2 人制 Blokus Duo 型の静的 AI 対戦アプリです。

対応モード:

- Human vs Human
- Human vs AI
- AI vs AI

実装済みの主な内容:

- 14 x 14 board
- start point `(0,0)` / `(13,13)`
- `chooseStart` / `fixedStart`
- 21 ピース、91 orientation
- 合法手生成
- 強制 pass
- 終局判定
- 公式スコア方式
- 探索型 AI difficulty 実装
- ルール確認用の Human vs Human
- 棋譜 JSON copy / load
- GitHub Pages 用 static build
- AI / Worker / build の動作検証基盤

## Tech Stack

- Language: JavaScript ES modules
- Runtime: Node.js
- Package manager: npm
- Frontend: browser-native static app
- Build: custom Node.js copy build
- Testing: Node.js built-in assertions with suite runner
- Hosting: GitHub Pages
- CI/CD: GitHub Actions

外部 npm 依存はありません。GitHub Pages で壊れにくいよう、ビルド後も相対パスで JS / CSS を読み込みます。

## Local Development

```bash
npm install
npm run dev
```

開発サーバーは既定で以下を使います。

```text
http://localhost:4173
```

ポートを変える場合:

```bash
$env:PORT=3000
npm run dev
```

## Build

```bash
npm run build
```

成果物は `dist/` に出力されます。

## Test

```bash
npm test
```

テストでは以下を確認します。

- ピース数が 21
- 各ピースの orientation 数
- orientation 合計が 91
- 各プレイヤーの総セル数が 89
- 初期合法手数 `chooseStart = 116`
- 初期合法手数 `fixedStart = 58`
- action encode / decode
- pass 制約
- scoring
- ランダム合法手の適用
- AI difficulty dispatch の正規化
- AI smoke test での合法手返却
- 手作り評価関数 `evaluateState` / `evaluateMoveQuick`
- Easy / Normal の Heuristic AI
- Hard の Beam Search AI
- Expert の Hybrid AI
- Expert+ の exact endgame solver
- 終盤 Alpha-Beta Search と Transposition Table
- Worker protocol の `INIT` / `THINK` / `CANCEL`
- Worker fallback が違法手を安全な合法手へ置き換えること

## Verification

```bash
npm run verify
```

`npm run verify` は以下を順に実行します。

1. `npm test`
2. `npm run build`
3. `dist/` の build smoke check

## Other Checks

```bash
npm run lint
npm run typecheck
```

現在は外部 linter / TypeScript compiler を導入していないため、上記は確認用の no-op script です。

## GitHub Pages Deploy

`.github/workflows/deploy.yml` が `main` branch への push で実行されます。

workflow の流れ:

1. repository を checkout
2. Node.js 22 をセットアップ
3. `npm ci`
4. `npm test`
5. `npm run build`
6. `dist/` を `gh-pages` branch に publish
7. GitHub Pages の Source を `Deploy from a branch` にして `gh-pages` / `root` を選ぶ

## Project Pages Base Path

このアプリは Vite などの bundler に依存せず、`./apps/...` と `./packages/...` の相対パスで静的ファイルを読み込みます。

そのため、以下のような Project Pages URL でも asset path が壊れない構成です。

```text
https://<user>.github.io/Blokus_AI/
```

User / Organization Pages や custom domain 直下でも同じ `dist/` を利用できます。

## Notes

- サーバー常駐処理、API Routes、SSR は使っていません。
- `.env` 系ファイルは `.gitignore` に含めています。
- AI は学習済みモデルではなく、評価関数ベースの探索型 AI です。
- `npm test` と `npm run verify` でルール、AI legality、Worker protocol、build smoke を継続確認できます。
