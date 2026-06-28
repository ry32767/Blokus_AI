# training/native — native (Rust) self-play engine

A fast local Blokus Duo self-play engine, intended to eventually replace the slower
Node + `onnxruntime-web` self-play path for the heavy self-play loop.

- **Design rationale, parity contract, build steps, roadmap** → [../../docs/NATIVE_SELFPLAY.md](../../docs/NATIVE_SELFPLAY.md)
- **Crate API, JSONL schema, full CLI flags** → [blokus-selfplay/README.md](blokus-selfplay/README.md)

## Layout

- **`parity/`** — language-agnostic **golden parity vectors** (`golden.json`) and their
  JS generator (`gen_golden.mjs`). `golden.json` is the contract the Rust crate must
  reproduce byte-for-byte (orientation/action constants, initial legal-move counts,
  action round-trips, scoring edge cases, and deterministic games with SHA-256 of the
  board and per-player state tensor at every ply). Regenerate with `npm run parity:golden`.
- **`blokus-selfplay/`** — the **Rust crate**: parity-verified deterministic core +
  state encoder, ONNX policy/value inference (`onnx` feature), and a negamax PUCT MCTS
  self-play actor. It loads `packages/core/src/orientations.json` directly and is
  validated against `parity/golden.json`.

## Quick start

```bash
npm run parity:golden        # (re)generate the golden vectors from the JS reference (optional; checked in)
npm run native:test          # validate Rust parity FIRST — must pass before trusting native output
npm run native:selfplay -- --games 10 --out games.jsonl --seed 1
```

> ⚠️ The crate was authored without a Rust toolchain. Until `npm run native:test` passes
> locally, do not feed native self-play output into training (see [AGENTS.md](../../AGENTS.md)).
