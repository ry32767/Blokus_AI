# AGENTS.md

このファイルは、AI エージェント（Codex 等）がこのリポジトリで作業するときの前提、制約、確認手順、完了条件を定義します。

Codex は作業前にこのファイルを参照し、ここに書かれた方針に従ってください。

---

## Project Overview

このプロジェクトは、GitHub Pages で公開する静的 Web アプリ / Web サイトです。

TODO: プロジェクトに合わせて記入してください。

- Project name:
- Purpose:
- Target users:
- Main value:
- Public URL:
- Repository type: `user/organization pages` または `project pages`
- Production hosting: GitHub Pages

---

## First Steps

作業を始める前に、まず以下を確認してください。

1. `README.md`
2. `package.json`
3. 使用しているフレームワークの設定ファイル
   - `vite.config.*`
   - `astro.config.*`
   - `next.config.*`
   - `その他該当する設定ファイル`
4. GitHub Actions の workflow
   - `.github/workflows/*`
5. 既存のディレクトリ構成
6. 既存のテスト、lint、typecheck、build コマンド

実装に入る前に、必要に応じて以下を短く整理してください。

- 現在の技術スタック
- 実行可能な開発コマンド
- ビルド成果物の出力先
- GitHub Pages の公開方式
- 実装方針
- 不明点

---

## Core Rules

作業時は以下を守ってください。

- 既存の設計、命名、ディレクトリ構成を尊重する
- 依頼された範囲に集中し、関係ない変更を避ける
- 大規模なリファクタリングは、明示的に求められた場合のみ行う
- 変更はできるだけ小さく、レビューしやすい単位にする
- 実在しないコマンドを推測で実行しない
- `package.json` や README を確認し、存在するコマンドだけを使う
- 依存関係を追加する場合は、目的と必要性を明確にする
- 既存の UI / UX 方針がある場合はそれを優先する
- 不明点が作業結果に大きく影響する場合は、実装前に質問する
- 軽微な判断は自律的に行ってよい
- 最後に、変更内容、検証結果、残課題を報告する

---

## Human Intent

人間が主に指定するべき内容は以下です。

- 誰に向けた機能・ページなのか
- 何を実現したいのか
- どの状態になれば完了なのか
- 優先順位
- デザインや挙動の好み
- 制約条件
- 変更してよい範囲

目的や完了条件が曖昧で、実装方針に大きな差が出る場合は、推測で進めず質問してください。

---

## Tech Stack

TODO: 実際のプロジェクトに合わせて更新してください。

- Language: TypeScript / JavaScript / HTML / CSS
- Runtime: Node.js
- Package manager: npm / pnpm / yarn
- Frontend framework: React / Vue / Svelte / Astro / Next.js / plain HTML
- Build tool: Vite / Astro / Next.js / other
- Styling: CSS / CSS Modules / Tailwind CSS / Sass / other
- Testing: Vitest / Jest / Playwright / none
- Hosting: GitHub Pages
- CI/CD: GitHub Actions

---

## Repository Structure

TODO: 実際の構成に合わせて更新してください。

- `src/`: アプリケーション本体
- `public/`: 静的アセット
- `components/`: UI コンポーネント
- `pages/` または `routes/`: ページ / ルーティング
- `styles/`: スタイル
- `tests/`: テスト
- `docs/`: ドキュメント
- `.github/workflows/`: GitHub Actions workflow

存在しないディレクトリについては、この記述を修正してください。

---

## Commands

このプロジェクトで使う主なコマンドです。

実行前に `package.json` を確認し、存在する script のみ実行してください。

```bash
# install dependencies
npm install

# start development server
npm run dev

# build for production
npm run build

# run tests
npm test

# run lint
npm run lint

# type check
npm run typecheck
```

別のパッケージマネージャーを使っている場合は、実際のプロジェクトに合わせて置き換えてください。

例:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

---

## GitHub Pages Requirements

このプロジェクトは GitHub Pages で公開する前提です。

以下を守ってください。

- 静的サイトとしてビルドできる構成にする
- サーバー常駐処理を前提にしない
- SSR が必要な機能を追加しない
- API Routes やサーバーサイド専用処理を追加しない
- 認証情報や秘密鍵をフロントエンドに埋め込まない
- GitHub Pages の base path を考慮する
- ルーティング、画像、CSS、JS のパスが本番公開 URL で壊れないようにする
- GitHub Actions で自動デプロイできる構成を優先する

---

## GitHub Pages Type

TODO: どちらか一方を残してください。

### User / Organization Pages

公開 URL:

```text
https://<user>.github.io/
```

この場合、通常 base path は `/` です。

### Project Pages

公開 URL:

```text
https://<user>.github.io/<repo>/
```

この場合、通常 base path は `/<repo>/` です。

Vite、Astro、Next.js などを使う場合は、base path や asset path の設定を確認してください。

---

## Framework Notes

### Vite

Project Pages の場合は、`vite.config.*` の `base` を確認してください。

```ts
export default defineConfig({
  base: "/<repo>/",
});
```

User / Organization Pages の場合は、通常以下です。

```ts
export default defineConfig({
  base: "/",
});
```

### Astro

Project Pages の場合は、`astro.config.*` の `site` と `base` を確認してください。

```ts
export default defineConfig({
  site: "https://<user>.github.io",
  base: "/<repo>",
});
```

### Next.js

GitHub Pages で使う場合は、静的エクスポート前提にしてください。

- `output: "export"` を使う
- SSR を使わない
- API Routes を使わない
- サーバー上での動的処理を前提にしない
- 必要に応じて `basePath` と `assetPrefix` を設定する
- 画像最適化など、Node.js サーバー前提の機能に注意する

---

## GitHub Actions

GitHub Pages へのデプロイは、原則として GitHub Actions を使ってください。

workflow を追加または修正する場合は、以下を満たしてください。

- `main` ブランチへの push で実行する
- 依存関係をインストールする
- production build を実行する
- ビルド成果物を GitHub Pages にデプロイする
- フレームワークに応じた成果物ディレクトリを使う

一般的な成果物ディレクトリ:

- Vite: `dist`
- Astro: `dist`
- Next.js static export: `out`

workflow を追加・変更した場合は、README にデプロイ方法を追記してください。

---

## Environment Variables and Secrets

環境変数や秘密情報の扱いには注意してください。

- `.env` を Git にコミットしない
- `.env.local` を Git にコミットしない
- `.gitignore` に `.env` 系ファイルが含まれていることを確認する
- API キーや秘密鍵をソースコードに直接書かない
- ログやエラー出力に秘密情報を表示しない
- 本番用の秘密鍵をフロントエンドに埋め込まない
- GitHub Pages 上で動くフロントエンドの環境変数は、公開情報として扱う
- 必要な環境変数名は README に書いてよい
- 値そのものは README やコードに書かない

例:

```env
VITE_API_BASE_URL=
VITE_PUBLIC_API_KEY=
```

秘密鍵が必要な処理は、GitHub Pages 上のフロントエンドだけでは実装しないでください。

---

## Security Rules

セキュリティ上、以下を守ってください。

- 秘密情報をハードコードしない
- 不要な依存関係を追加しない
- 外部入力を扱う場合は XSS やインジェクションに注意する
- ユーザー生成コンテンツを表示する場合はサニタイズする
- `dangerouslySetInnerHTML` など危険な API は原則避ける
- 外部リンクで新しいタブを開く場合は、必要に応じて `rel="noopener noreferrer"` を付ける
- 認証・認可・課金・個人情報に関わる変更は慎重に扱う
- セキュリティ上の判断が必要な場合は、作業前に質問する

---

## Accessibility

UI を実装または変更する場合は、アクセシビリティを考慮してください。

- ボタン、リンク、見出し、フォームには適切な HTML 要素を使う
- 画像には必要に応じて `alt` を付ける
- フォーム入力には label を関連付ける
- キーボード操作を妨げない
- 色だけに依存した情報表現を避ける
- 十分なコントラストを確保する
- 見出し階層を不自然に飛ばさない
- フォーカス状態を見えるようにする

---

## Design and UI

デザイン作業では以下を意識してください。

- シンプルで読みやすい UI にする
- 余白、行間、コントラストを整える
- モバイル表示を考慮する
- レスポンシブ対応を行う
- 不要なアニメーションを避ける
- アニメーションを使う場合は控えめにする
- 既存のデザイン方針がある場合はそれを優先する
- UI 変更後は主要画面の表示崩れを確認する

---

## Testing and Verification

変更後は、可能な範囲で以下を確認してください。

1. 最小限の対象テスト
2. lint
3. typecheck
4. production build
5. 必要に応じたブラウザ確認

標準的な確認コマンド:

```bash
npm run build
npm test
npm run lint
npm run typecheck
```

コマンドが存在しない場合は、実行せず、その旨を最終報告に明記してください。

テストが存在しない場合でも、以下を確認してください。

- production build が成功する
- 主要画面が表示される
- 主要なリンクやボタンが動く
- コンソールエラーがない
- GitHub Pages の base path でアセットが壊れない

---

## Documentation

以下の場合は README または関連ドキュメントを更新してください。

- セットアップ手順が変わった
- 開発コマンドが変わった
- ビルド方法が変わった
- デプロイ方法が変わった
- 環境変数が追加・変更された
- 使い方が変わった
- 重要な設計判断を追加した

README には、可能な範囲で以下を含めてください。

- プロジェクト概要
- ローカル起動方法
- ビルド方法
- テスト方法
- デプロイ方法
- 必要な環境変数名
- 公開 URL

---

## Git and Commit Policy

Git 操作では以下を守ってください。

- 変更前に現在の状態を確認する
- 関係ないファイルを変更しない
- 生成物や不要なファイルをコミット対象にしない
- `.env` や秘密情報をコミットしない
- 大きな変更は論理的に分ける
- ユーザーが明示的に求めない限り `git push` しない
- ユーザーが明示的に求めない限り PR を作らない
- `git push --force` は明示的な許可なしに実行しない

---

## When to Ask Questions

以下の場合は、実装前に質問してください。

- 完了条件が曖昧な場合
- 複数の実装方針があり、影響が大きく異なる場合
- データ削除や破壊的変更が必要な場合
- セキュリティ上の判断が必要な場合
- 外部サービスの認証、課金、権限が必要な場合
- GitHub Pages だけでは要件を満たせない場合
- デザインの方向性が不明で、結果に大きく影響する場合

---

## When You May Decide Autonomously

以下は、依頼範囲内であれば自律的に判断して構いません。

- 明らかなバグ修正
- 型エラーや lint エラーの修正
- 小さなリファクタリング
- README の軽微な補足
- テストの追加
- アクセシビリティ改善
- レスポンシブ対応
- 既存パターンに沿った実装詳細

---

## Prohibited Actions

明示的な許可なしに、以下を行わないでください。

- 本番環境のデータを変更・削除する
- 秘密情報を表示、保存、コミットする
- 外部サービスで課金が発生する操作を行う
- 大量の依存関係を追加する
- フレームワークを勝手に変更する
- ライセンス不明のコードをコピーする
- 既存機能を理由なく削除する
- リポジトリ設定を破壊的に変更する
- `git push --force` を実行する
- ユーザーの明示的な依頼なしにデプロイする

---

## Implementation Planning

小さな変更は、簡潔な方針を示してから実装してください。

大規模な変更、設計変更、移行作業の場合は、先に Markdown で計画を作成してください。

例:

```text
IMPLEMENTATION_PLAN.md
MIGRATION_PLAN.md
DEPLOYMENT_PLAN.md
```

計画には以下を含めてください。

- 目的
- 変更範囲
- 影響を受けるファイル
- 実装手順
- 検証方法
- リスク
- ロールバック方針

---

## Definition of Done

作業完了条件は以下です。

- 要求された機能または修正が実装されている
- 依頼範囲外の不要な変更がない
- production build が成功する
- テストがある場合は成功する
- lint がある場合は成功する
- typecheck がある場合は成功する
- README または関連ドキュメントが必要に応じて更新されている
- GitHub Pages で公開する場合、静的ビルドと base path が考慮されている
- 未解決の問題や確認できなかった項目が明示されている
- 最後に変更内容と検証結果が報告されている

---

## Final Response Format

作業完了時は、以下の形式で報告してください。

```md
## Summary

- 変更内容1
- 変更内容2
- 変更内容3

## Verification

- `npm run build`: passed / failed / not run
- `npm test`: passed / failed / not run
- `npm run lint`: passed / failed / not run
- `npm run typecheck`: passed / failed / not run
- Browser check: passed / not run

## Notes

- 残課題
- 注意点
- 次にやるとよいこと
```

実行できなかった確認項目がある場合は、理由を明記してください。
