//! Self-play data generator.
//!
//! Two policies:
//!   --policy random  (default) — deterministic uniform-random legal move; the
//!     policy target is a one-hot on the played action. SCAFFOLD behaviour,
//!     unchanged from the original.
//!   --policy mcts             — NN-guided negamax PUCT MCTS (see `mcts.rs`),
//!     writing the MCTS VISIT-COUNT DISTRIBUTION as the policy target (valid
//!     AlphaZero training data; NOT one-hot). Uses `OnnxPolicyValue` when built
//!     with `--features onnx` and `--model PATH` is given, else falls back to
//!     `UniformPolicyValue` so the binary still runs without onnxruntime.
//!
//! UNVERIFIED: authored without a local Rust toolchain. Run `cargo test`
//! (no features) and `cargo build --features onnx` before relying on this.
//!
//! Usage:
//!   cargo run --bin selfplay -- --games 10 --out games.jsonl --seed 1 --start-policy fixedStart
//!   cargo run --release --features onnx --bin selfplay -- \
//!       --policy mcts --model ../../../apps/web/public/models/blokus_policy_value.onnx \
//!       --games 50 --sims 200
//!
//! Output line schema (per position):
//!   {"player","encoded_state":[..51*196 floats..],"legal_actions":[ints],
//!    "selected_action":int,"final_score_diff":int,
//!    "policy_target_actions":[ints],"policy_target_probs":[floats],"root_value":float}

use std::fs::{create_dir_all, File};
use std::io::{BufWriter, Write};
use std::path::Path;

use blokus_selfplay::{
    apply_move, create_initial_state, encode_action, encode_state_tensor, generate_legal_moves,
    score_state, GameState, Mcts, MctsConfig, Move, PolicyValue, StartPolicy, Status,
    UniformPolicyValue,
};

#[cfg(feature = "onnx")]
use blokus_selfplay::OnnxPolicyValue;

/// Small deterministic PRNG (SplitMix64) — std-only, reproducible across platforms.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }
    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    /// Uniform integer in [0, n). Uses Lemire-free rejection-light modulo; fine for a
    /// scaffold (slight bias negligible and not parity-relevant).
    fn next_below(&mut self, n: usize) -> usize {
        debug_assert!(n > 0);
        (self.next_u64() % n as u64) as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Policy {
    Random,
    Mcts,
}

impl Policy {
    fn parse(s: &str) -> Option<Policy> {
        match s {
            "random" => Some(Policy::Random),
            "mcts" => Some(Policy::Mcts),
            _ => None,
        }
    }
}

struct Args {
    games: usize,
    out: String,
    seed: u64,
    start_policy: StartPolicy,
    policy: Policy,
    model: Option<String>,
    sims: Option<u64>,
    time_ms: u64,
    candidate_limit: usize,
    exploration_c: f64,
    root_dirichlet_weight: f64,
    root_dirichlet_alpha: f64,
    mcts_sampling_temperature: f64,
    mcts_sampling_plies: u32,
}

fn parse_args() -> Args {
    let mut games = 10usize;
    let mut out = "games.jsonl".to_string();
    let mut seed = 0u64;
    let mut start_policy = StartPolicy::FixedStart;
    let mut policy = Policy::Random;
    let mut model: Option<String> = None;
    let mut sims: Option<u64> = None;
    let mut time_ms = 0u64;
    let mut candidate_limit = 120usize;
    let mut exploration_c = 1.5f64;
    let mut root_dirichlet_weight = 0.25f64;
    let mut root_dirichlet_alpha = 0.3f64;
    let mut mcts_sampling_temperature = 0.0f64;
    let mut mcts_sampling_plies = 0u32;

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--games" => {
                i += 1;
                games = argv.get(i).and_then(|s| s.parse().ok()).unwrap_or(games);
            }
            "--out" => {
                i += 1;
                if let Some(v) = argv.get(i) {
                    out = v.clone();
                }
            }
            "--seed" => {
                i += 1;
                seed = argv.get(i).and_then(|s| s.parse().ok()).unwrap_or(seed);
            }
            "--start-policy" => {
                i += 1;
                if let Some(v) = argv.get(i) {
                    start_policy = StartPolicy::parse(v)
                        .unwrap_or_else(|| panic!("unknown --start-policy {v}"));
                }
            }
            "--policy" => {
                i += 1;
                if let Some(v) = argv.get(i) {
                    policy = Policy::parse(v).unwrap_or_else(|| panic!("unknown --policy {v}"));
                }
            }
            "--model" => {
                i += 1;
                model = argv.get(i).cloned();
            }
            "--sims" => {
                i += 1;
                sims = argv.get(i).and_then(|s| s.parse().ok());
            }
            "--time-ms" => {
                i += 1;
                time_ms = argv.get(i).and_then(|s| s.parse().ok()).unwrap_or(time_ms);
            }
            "--candidate-limit" => {
                i += 1;
                candidate_limit = argv
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(candidate_limit);
            }
            "--exploration-c" => {
                i += 1;
                exploration_c = argv
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(exploration_c);
            }
            "--root-dirichlet-weight" => {
                i += 1;
                root_dirichlet_weight = argv
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(root_dirichlet_weight);
            }
            "--root-dirichlet-alpha" => {
                i += 1;
                root_dirichlet_alpha = argv
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(root_dirichlet_alpha);
            }
            "--mcts-sampling-temperature" => {
                i += 1;
                mcts_sampling_temperature = argv
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(mcts_sampling_temperature);
            }
            "--mcts-sampling-plies" => {
                i += 1;
                mcts_sampling_plies = argv
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(mcts_sampling_plies);
            }
            "--help" | "-h" => {
                eprintln!(
                    "Usage: selfplay [options]\n\
                     \n\
                     General:\n\
                     \x20 --games N                 number of games (default 10)\n\
                     \x20 --out FILE                JSONL output path (default games.jsonl)\n\
                     \x20 --seed S                  base seed (default 0)\n\
                     \x20 --start-policy P          chooseStart | fixedStart (default fixedStart)\n\
                     \x20 --policy P                random | mcts (default random)\n\
                     \n\
                     MCTS (--policy mcts):\n\
                     \x20 --model PATH              ONNX model path (requires --features onnx)\n\
                     \x20 --sims N                  max simulations per move (default 200 if unset)\n\
                     \x20 --time-ms MS              per-move time budget (0 = unbounded; default 0)\n\
                     \x20 --candidate-limit N       max children kept per node (default 120)\n\
                     \x20 --exploration-c F         PUCT exploration constant (default 1.5)\n\
                     \x20 --root-dirichlet-weight F root noise weight (default 0.25)\n\
                     \x20 --root-dirichlet-alpha F  Dirichlet alpha (default 0.3)\n\
                     \x20 --mcts-sampling-temperature F   move-sampling T (default 0)\n\
                     \x20 --mcts-sampling-plies N         sample while turn < N (default 0)"
                );
                std::process::exit(0);
            }
            other => {
                eprintln!("[selfplay] ignoring unknown argument: {other}");
            }
        }
        i += 1;
    }

    Args {
        games,
        out,
        seed,
        start_policy,
        policy,
        model,
        sims,
        time_ms,
        candidate_limit,
        exploration_c,
        root_dirichlet_weight,
        root_dirichlet_alpha,
        mcts_sampling_temperature,
        mcts_sampling_plies,
    }
}

/// A position recorded during a game, before the final score diff is known.
struct PendingSample {
    player: u8,
    encoded_state: Vec<f32>,
    legal_actions: Vec<usize>,
    selected_action: usize,
    /// MCTS visit-distribution policy target (random mode: one-hot on selected).
    policy_target_actions: Vec<usize>,
    policy_target_probs: Vec<f64>,
    /// Root value from this position's player perspective (random mode: 0).
    root_value: f64,
}

/// Play one game with the uniform-random legal policy (unchanged scaffold).
fn play_game_random(
    start_policy: StartPolicy,
    rng: &mut SplitMix64,
) -> (Vec<PendingSample>, [i32; 2]) {
    let mut state: GameState = create_initial_state(start_policy);
    let mut samples: Vec<PendingSample> = Vec::new();

    while state.status == Status::Playing {
        let current_player = state.current_player;
        let moves = generate_legal_moves(&state);
        let legal_actions: Vec<usize> = moves.iter().map(encode_action).collect();

        let idx = rng.next_below(moves.len());
        let selected_move: &Move = &moves[idx];
        let selected_action = encode_action(selected_move);

        samples.push(PendingSample {
            player: current_player,
            encoded_state: encode_state_tensor(&state, current_player),
            legal_actions,
            selected_action,
            policy_target_actions: vec![selected_action],
            policy_target_probs: vec![1.0],
            root_value: 0.0,
        });

        state = apply_move(&state, selected_move);
    }

    (samples, score_state(&state))
}

/// Play one game driven by NN-guided PUCT MCTS. Each position's policy target is
/// the MCTS visit distribution (valid training data, not one-hot).
fn play_game_mcts(
    start_policy: StartPolicy,
    nn: &dyn PolicyValue,
    base_config: &MctsConfig,
    game_seed: u64,
) -> (Vec<PendingSample>, [i32; 2]) {
    let mut state: GameState = create_initial_state(start_policy);
    let mut samples: Vec<PendingSample> = Vec::new();
    let mut move_index: u64 = 0;

    while state.status == Status::Playing {
        let current_player = state.current_player;
        let moves = generate_legal_moves(&state);
        let legal_actions: Vec<usize> = moves.iter().map(encode_action).collect();

        // Per-move seed: deterministic yet distinct across plies of a game.
        let mut config = base_config.clone();
        config.seed = game_seed
            .wrapping_mul(0x100_0000_01B3)
            .wrapping_add(move_index.wrapping_mul(0x9E37_79B9_7F4A_7C15));

        let mcts = Mcts::new(nn, config);
        let result = mcts.search(&state);

        let selected_move = result.chosen_move.clone();
        let selected_action = encode_action(&selected_move);

        samples.push(PendingSample {
            player: current_player,
            encoded_state: encode_state_tensor(&state, current_player),
            legal_actions,
            selected_action,
            policy_target_actions: result.policy_target_actions.clone(),
            policy_target_probs: result.policy_target_probs.clone(),
            root_value: result.root_value,
        });

        state = apply_move(&state, &selected_move);
        move_index += 1;
    }

    (samples, score_state(&state))
}

/// Serialise an f32 plane value compactly: encoder values are always 0.0 or 1.0.
fn write_floats(buf: &mut String, values: &[f32]) {
    buf.push('[');
    for (i, v) in values.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        if *v == 0.0 {
            buf.push('0');
        } else if *v == 1.0 {
            buf.push('1');
        } else {
            buf.push_str(&format!("{v}"));
        }
    }
    buf.push(']');
}

fn write_ints(buf: &mut String, values: &[usize]) {
    buf.push('[');
    for (i, v) in values.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        buf.push_str(&v.to_string());
    }
    buf.push(']');
}

/// Write probabilities with 6 decimals (matches the JS `toFixed(6)` target).
fn write_probs(buf: &mut String, values: &[f64]) {
    buf.push('[');
    for (i, v) in values.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        buf.push_str(&format!("{:.6}", v));
    }
    buf.push(']');
}

/// Build the NN backend. With `--features onnx` and a `--model` path, loads the
/// ONNX network; otherwise (or without the feature) uses the uniform baseline so
/// the binary still runs everywhere.
fn build_backend(model: &Option<String>) -> Box<dyn PolicyValue> {
    #[cfg(feature = "onnx")]
    {
        if let Some(path) = model {
            match OnnxPolicyValue::load(path) {
                Ok(net) => {
                    eprintln!("[selfplay] loaded ONNX model: {path}");
                    return Box::new(net);
                }
                Err(e) => {
                    eprintln!("[selfplay] failed to load model '{path}': {e}");
                    eprintln!("[selfplay] falling back to UniformPolicyValue");
                    return Box::new(UniformPolicyValue);
                }
            }
        }
        eprintln!("[selfplay] --policy mcts without --model: using UniformPolicyValue");
        Box::new(UniformPolicyValue)
    }
    #[cfg(not(feature = "onnx"))]
    {
        if model.is_some() {
            eprintln!(
                "[selfplay] --model given but crate built without `--features onnx`; \
                 using UniformPolicyValue"
            );
        }
        Box::new(UniformPolicyValue)
    }
}

fn main() -> std::io::Result<()> {
    let args = parse_args();

    if let Some(parent) = Path::new(&args.out).parent() {
        if !parent.as_os_str().is_empty() {
            create_dir_all(parent)?;
        }
    }
    let file = File::create(&args.out)?;
    let mut writer = BufWriter::new(file);

    let mut total_positions = 0usize;
    let mut rng = SplitMix64::new(args.seed.wrapping_add(0x1234_5678_9ABC_DEF0));

    // Backend + base MCTS config (only used in mcts mode).
    let backend = if args.policy == Policy::Mcts {
        Some(build_backend(&args.model))
    } else {
        None
    };
    let base_config = MctsConfig {
        time_limit_ms: args.time_ms,
        // When neither --time-ms nor --sims is given, default to 200 sims so the
        // run terminates (an unbounded time budget with no cap would spin).
        max_simulations: Some(args.sims.unwrap_or(if args.time_ms == 0 { 200 } else { u64::MAX })),
        exploration_c: args.exploration_c,
        candidate_limit: args.candidate_limit,
        root_dirichlet_weight: args.root_dirichlet_weight,
        root_dirichlet_alpha: args.root_dirichlet_alpha,
        move_sampling_temperature: args.mcts_sampling_temperature,
        move_sampling_plies: args.mcts_sampling_plies,
        seed: 0, // overridden per move
    };

    for game_index in 0..args.games {
        let game_seed = rng.next_u64();
        let (samples, score) = match args.policy {
            Policy::Random => {
                let mut game_rng = SplitMix64::new(game_seed);
                play_game_random(args.start_policy, &mut game_rng)
            }
            Policy::Mcts => {
                let nn = backend.as_ref().expect("mcts mode has a backend");
                play_game_mcts(args.start_policy, nn.as_ref(), &base_config, game_seed)
            }
        };
        let [black_score, white_score] = score;

        for s in &samples {
            let final_score_diff = if s.player == 0 {
                black_score - white_score
            } else {
                white_score - black_score
            };

            let mut line = String::with_capacity(s.encoded_state.len() * 2 + 256);
            line.push_str("{\"player\":");
            line.push_str(&s.player.to_string());
            line.push_str(",\"encoded_state\":");
            write_floats(&mut line, &s.encoded_state);
            line.push_str(",\"legal_actions\":");
            write_ints(&mut line, &s.legal_actions);
            line.push_str(",\"selected_action\":");
            line.push_str(&s.selected_action.to_string());
            line.push_str(",\"final_score_diff\":");
            line.push_str(&final_score_diff.to_string());
            line.push_str(",\"policy_target_actions\":");
            write_ints(&mut line, &s.policy_target_actions);
            line.push_str(",\"policy_target_probs\":");
            write_probs(&mut line, &s.policy_target_probs);
            line.push_str(",\"root_value\":");
            line.push_str(&format!("{:.6}", s.root_value));
            line.push('}');
            line.push('\n');
            writer.write_all(line.as_bytes())?;
        }

        total_positions += samples.len();
        eprintln!(
            "[selfplay] game={} positions={} score={}-{}",
            game_index,
            samples.len(),
            black_score,
            white_score
        );
    }

    writer.flush()?;
    eprintln!(
        "[selfplay] wrote {} positions across {} games to {} (policy={:?})",
        total_positions, args.games, args.out, args.policy
    );
    Ok(())
}
