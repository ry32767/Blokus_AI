# training/native — native (Rust) self-play engine

Foundation for a **fast local Blokus Duo self-play engine** that will eventually
replace the slow Node + `onnxruntime-web` self-play path used by the rest of
`training/`. This directory holds the parity contract and the Rust crate that must
satisfy it.

## Layout

- **`parity/`** — language-agnostic **golden parity vectors** and their generator.
  - `gen_golden.mjs` — runs the JS reference (`packages/core/src/*.js`) and emits
    `golden.json`. Re-run with `node training/native/parity/gen_golden.mjs` whenever the
    rules/encoders change.
  - `golden.json` — the contract: orientation/action constants, initial legal-move
    counts, action round-trips, scoring edge cases, and two fully replayed deterministic
    games with canonical SHA-256 of the board and per-player state tensor at every ply.
- **`blokus-selfplay/`** — the **Rust crate** (deterministic core + encoders +
  self-play scaffold). It loads `packages/core/src/orientations.json` directly and is
  validated against `parity/golden.json`.

## How they relate

`gen_golden.mjs` (JS, source of truth) → `golden.json` (contract) →
`blokus-selfplay/tests/parity.rs` and `blokus-selfplay/src/bin/parity_check.rs` (Rust,
asserts byte-for-byte parity).

The JS and Rust sides share **two** on-disk artifacts directly: `orientations.json`
(the 91 orientations) and `golden.json` (the parity vectors). Keeping these in sync is
what guarantees the trained model sees identical inputs regardless of which engine
generated the self-play data.

## Quick start

```bash
# 1. (re)generate the golden vectors from the JS reference (optional; checked in)
node training/native/parity/gen_golden.mjs

# 2. validate Rust parity (do this first — the crate was authored without a toolchain)
cd training/native/blokus-selfplay
cargo test
cargo run --bin parity_check        # human-readable PASS/FAIL

# 3. generate self-play data
cargo run --release --bin selfplay -- --games 10 --out games.jsonl --seed 1
```

See `blokus-selfplay/README.md` for the crate API, JSONL schema, and roadmap (ONNX
inference → PUCT MCTS → replacing the Node self-play path).
