# BlokusAI Duo 評価レポート

- 評価日: 2026-06-26
- 観点: **公式 Blokus Duo で世界ランカー（人間トップ）に勝てるか**
- 方法: コードベースを 7 次元（ルール正当性 / AI 強度 / 学習パイプライン / ML 健全性 / エンコーダ整合 / コードバグ / 構成・ドキュメント）で精査し、重大発見は独立エージェントで敵対的に検証。検証で否定された主張は本レポートから除外。

---

## 総合判定

**評価時点では、世界ランカーには勝てない。** 単発の弱さではなく、探索・ネット・学習ループの 3 層すべてに上限があった。到達ラインは「強いアマ／expert-bot」程度で、世界ランカー（公式・中央スタートの最善応手を返す相手）には中盤で明確に崩される。

世界ランカー級に必要なもの:
1. **公式ルール（中央スタート）で学習・対戦すること**（同じゲームを指す）。
2. 正しく深く読む探索（数千 sim/手）と、それを支える十分大きな value/policy ネット。
3. 探索する自己対戦（root noise＋温度）と、統計的に意味のある昇格ゲート、勝敗ベースの value 教師。
4. 大量の自己対戦計算量。

本セッションで上記の**土台となるバグ・設計欠陥を修正**した（下表）。実際に世界ランカー級へ近づけるには、これらの基盤の上で**大規模な再学習と反復**が必要。

---

## 確定した発見と対応状況

### 🔴 探索（最重要・修正済み）

| 発見 | 場所 | 状態 |
|---|---|---|
| Master MCTS が depth-0 ゲートで実質 1ply に崩壊（全ノードを depth 0 でキャッシュ→`cached.depth>=0` が常に真→子が展開されない） | `apps/web/src/ai/policyValueMctsAi.js` | ✅ negamax PUCT に全面書き直し。TT は「ツリーゲート」ではなく「NN出力キャッシュ」に分離。多ply探索を確認するテスト追加。 |
| Master MCTS の価値視点を二重適用（leaf を root視点に変換後、backprop で再反転） | 同上 | ✅ negamax に統一（各ノードは手番側視点、逆伝播で ply ごとに 1 回だけ符号反転）。 |
| expert/expert_plus 中盤の MCTS が相手手番で価値反転せず（相手が協力する前提） | `apps/web/src/ai/mctsAi.js` | ✅ negamax 木探索に書き直し（相手手番で符号反転、遅延 child state）。 |
| 1手あたり sim 数が致命的に少ない（同期 ONNX-WASM 推論） | policyValueMctsAi.js | ⚠️ NN出力の hash キャッシュで重複局面の再推論を回避。**残**: leaf バッチ評価・WASM マルチスレッド（COOP/COEP 必要）でさらに sim/手を増やす。 |

### 🔴 ネット・学習（修正済み／要再学習）

| 発見 | 状態 |
|---|---|
| ネットが ~337K params（64ch×4block）と小さすぎ、スケールする CLI も無い | ✅ `--channels` / `--residual-blocks` を `train_policy(_value).py` に追加。checkpoint に `model_arch` を記録し、`export_onnx.py` がそこから復元。**残**: 大きいネットの in-browser 推論レイテンシ検証。 |
| value target が点差ベース（`score_diff/89`、除数も範囲とズレ） | ✅ 既定を **勝敗(win/loss/draw)** 教師に変更（`--value-target-mode`、margin も選択可、除数は実レンジ 109 に修正）。 |
| 自己対戦に Dirichlet root noise も温度サンプリングも無く、exploitation のみでプラトー | ✅ MCTS 内に Dirichlet root noise＋visit分布温度サンプリングを実装。4 層（alphazero→distributed→worker→generate_dataset）に CLI 配線し、AlphaZero ループは既定 ON。**visit分布の policy 教師が有効なまま**（ヒューリスティック再サンプラの教師破壊を回避）。 |
| 昇格ゲートが 6 局で統計的に無意味（本物の改善を高確率で棄却して停滞） | ✅ 既定を評価 40 局・Elo 下限 +10 に強化。**残**: SPRT / 数百局・生成と昇格の分離（非昇格でも候補で生成）。 |
| モデル異常時に黙って heuristic へ fallback し、アリーナ評価・自己対戦を汚染 | ✅ `decideTrainingMove` に `failOnFallback` を追加（アリーナ/自己対戦で hard-fail 可能）。 |
| `train_policy.py` が sample weight を破棄（混合データの重み無効） | ✅ weight を loss に反映（`reduction='none'` ＋ 加重平均）。 |

### 🟡 ルール・整合（修正済み）

| 発見 | 状態 |
|---|---|
| 開始マスが角 `(0,0)/(13,13)`（非公式変種）。世界ランカーは中央スタートの公式を指す | ✅ 公式 `(4,4)/(9,9)` に変更（JS/Python 両方）。テスト期待値（初期合法手 chooseStart=828 / fixedStart=414、初手判定）を更新。**既存 ONNX モデル/データは無効 → 再学習・再 export 必須。** |
| JS↔Python エンコーダ整合 | ✅ 検証でビット一致を確認（変更後も parity テスト通過）。 |

### 🟡 構成・ドキュメント（修正済み）

- ルート `AGENTS.md` が未記入の React/Vite テンプレ → 本プロジェクト用に全面刷新。
- プロジェクト用 `CLAUDE.md` 不在（ワークスペースは GeoSection 用）→ 追加。
- 開始マス/スコア式が未文書化 → README・spec に明記。
- 設計ドキュメントを `docs/` に集約、`docs/ARCHITECTURE.md` 追加。`IMPLEMENTATION_PLAN` の「未実装」誤記（Critical Replay は実装済み）を修正。
- `training/.scratch/` 等を `.gitignore` に追加。

### 検証で否定された主張（対応不要）

- 「TT を root 間で共有して符号反転」→ **無効**（表は手ごと生成・rootPlayer は探索内で一定）。
- 「value scale が train と MCTS で不一致」→ **無効**（両者 `/89`、tanh 出力で一致していた。意味論=点差 vs 勝敗の問題は別途修正）。
- 「max_samples が weight を無視して mix を歪める」→ **low**（weight は設計上 loss 重み。一様抽出は比率を保存）。
- 「distributed queue の競合でデータ破損」→ **medium**（atomic rename がジョブ割当を保護。壊れるのは集計カウントのみ）。

---

## 残ロードマップ（世界ランカーへ）

1. **再学習の土台確立**: 公式ルールで dataset 再生成 → 大きいネット（例 128–256ch / 10–20 block）で学習 → ONNX 再 export → ブラウザ既定モデル更新。
2. **探索スループット**: leaf バッチ推論（virtual loss）＋ WASM マルチスレッド（COOP/COEP）で数千 sim/手を目指す。
3. **自己対戦の質**: Dirichlet/温度を活かした探索的自己対戦を反復し、SPRT/多数局ゲートで単調改善を担保。生成と昇格を分離。
4. **終盤強化**: 連結領域分解・支配手枝刈り・領域ごとの厳密解で、終盤の深い読みを実用化。
5. **評価関数/特徴**: 影響圏（two-distance）・パリティ・係争コーナーの重み付けを value 学習や heuristic に取り込む。
6. **計算量**: GPU 自己対戦・対戦相手プール・長期 Elo 安定化（CI 含む）。

> このレポートは評価時点のもの。コードは本セッションで上記「修正済み」を反映済み。最新の実装詳細は各ソースと [ARCHITECTURE.md](ARCHITECTURE.md) を参照。
