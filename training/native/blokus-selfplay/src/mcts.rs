//! Negamax PUCT MCTS, a faithful port of
//! `apps/web/src/ai/policyValueMctsAi.js` (the rewritten negamax search).
//!
//! UNVERIFIED: authored without a local Rust toolchain. Run `cargo test` (no
//! features) before relying on this; the `#[cfg(test)]` invariants below mirror
//! the JS test "master mcts grows a multi-ply tree (no depth-0 collapse)".
//!
//! Conventions (MUST match the JS exactly):
//!   - Node value is in the TO-MOVE player's perspective. A node's
//!     `value_sum / visits` is the average value for the player to move at that
//!     node.
//!   - Leaf NN value = inference value for `state.current_player`.
//!   - Backup negates once per ply (negamax): `value = -value` after each step
//!     up the path.
//!   - `select_child` uses
//!     `q = -(child.value_sum / child.visits)` (child is opponent perspective)
//!     `+ exploration_c * child.prior * sqrt(parent.visits + 1) / (1 + child.visits)`.
//!     Unvisited child contributes `q = 0`.
//!   - Expansion is lazy: a child's state is materialised on first visit.
//!     Expanding a leaf runs the NN once and sets children with priors =
//!     softmax(policy logits over legal moves), truncated to `candidate_limit`
//!     (default 120). Terminal leaf value = `normalize(score_diff)/89` clamped
//!     to `[-1, 1]`.
//!   - The transposition table caches NN OUTPUTS (value + ranked priors) keyed by
//!     `hash_state`. It is an inference cache, NOT a tree gate — do NOT skip
//!     expansion based on it (that was the depth-0 collapse bug).
//!   - Root: expand once, then optionally mix Dirichlet noise into child priors.
//!   - Final move: argmax visits, or visit-proportional `visits^(1/T)` sampling
//!     when `move_sampling_temperature > 0` and `turn < move_sampling_plies`.
//!   - Policy target = the visit-count distribution (NOT a one-hot).

use std::collections::HashMap;

use crate::action::encode_action;
use crate::encoding::encode_state_tensor;
use crate::inference::PolicyValue;
use crate::rules::{apply_move, generate_legal_moves, GameState, Move, Status};
use crate::scoring::score_state;

/// Deterministic PRNG (SplitMix64). Mirrors the one in `bin/selfplay.rs`; kept
/// here so MCTS owns its reproducible randomness without a cross-module dep.
#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        SplitMix64 { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform f64 in `[0, 1)`, the analogue of JS `rng()` (`Math.random`).
    pub fn next_f64(&mut self) -> f64 {
        // 53-bit mantissa precision, matching standard `[0,1)` generators.
        (self.next_u64() >> 11) as f64 / ((1u64 << 53) as f64)
    }
}

/// MCTS configuration. Field defaults match the JS (`config.* ?? default`).
#[derive(Debug, Clone)]
pub struct MctsConfig {
    /// Per-move wall-clock budget in ms (JS `timeLimitMs`). `0` disables the
    /// time budget (rely on `max_simulations`).
    pub time_limit_ms: u64,
    /// Hard simulation cap (JS `maxSimulations`). `None` = unbounded.
    pub max_simulations: Option<u64>,
    /// PUCT exploration constant (JS `explorationC`, default 1.5).
    pub exploration_c: f64,
    /// Max children kept after ranking by prior (JS `candidateLimit`, default 120).
    pub candidate_limit: usize,
    /// Dirichlet root-noise weight (JS `rootDirichletWeight`; self-play 0.25).
    pub root_dirichlet_weight: f64,
    /// Dirichlet concentration (JS `rootDirichletAlpha`, default 0.3).
    pub root_dirichlet_alpha: f64,
    /// Move-sampling temperature (JS `moveSamplingTemperature`).
    pub move_sampling_temperature: f64,
    /// Sample (vs argmax) only while `state.turn < move_sampling_plies`.
    pub move_sampling_plies: u32,
    /// Seed for the search PRNG (Dirichlet noise, tie-breaks, sampling).
    pub seed: u64,
}

impl Default for MctsConfig {
    fn default() -> Self {
        MctsConfig {
            time_limit_ms: 2500,
            max_simulations: None,
            exploration_c: 1.5,
            candidate_limit: 120,
            root_dirichlet_weight: 0.0,
            root_dirichlet_alpha: 0.3,
            move_sampling_temperature: 0.0,
            move_sampling_plies: 0,
            seed: 0,
        }
    }
}

/// Result of a search: the chosen move plus stats and the policy target.
#[derive(Debug, Clone)]
pub struct MctsResult {
    pub chosen_move: Move,
    /// Action ids ordered by visit count desc (the policy-target support).
    pub policy_target_actions: Vec<usize>,
    /// Visit-proportional probabilities aligned with `policy_target_actions`
    /// (sum ~= 1). This is the AlphaZero policy target — NOT a one-hot.
    pub policy_target_probs: Vec<f64>,
    /// Raw visit counts aligned with `policy_target_actions`.
    pub policy_target_visits: Vec<u64>,
    /// Total visits over root children.
    pub total_visits: u64,
    /// Root NN/terminal value in the root player's perspective.
    pub root_value: f64,
    /// Root averaged Q after search (root player's perspective).
    pub root_q: f64,
    /// Simulations actually run.
    pub simulations: u64,
    /// Total tree nodes materialised (root + every child whose state was built).
    pub nodes: u64,
}

// --- Tree (arena of nodes; children referenced by index) ---
//
// The JS uses object references and lazy child `state`. Rust borrow rules make a
// pointer tree awkward, so we use an arena `Vec<Node>` and store child node ids.
// `state` is materialised lazily exactly like the JS (`child.state === null`).

struct Node {
    /// The move leading INTO this node (None for the root).
    mv: Option<Move>,
    /// Action id of `mv` (None for the root).
    action: Option<usize>,
    /// Prior probability of `mv` under the parent's NN policy.
    prior: f64,
    /// Materialised state, or None until first visited (lazy, like JS).
    state: Option<GameState>,
    visits: u64,
    value_sum: f64,
    /// Child node ids; None = unexpanded leaf, Some(empty) = terminal leaf.
    children: Option<Vec<usize>>,
    /// Cached terminal value (to-move perspective) for terminal leaves.
    terminal_value: Option<f64>,
}

impl Node {
    fn new_root(state: GameState) -> Self {
        Node {
            mv: None,
            action: None,
            prior: 0.0,
            state: Some(state),
            visits: 0,
            value_sum: 0.0,
            children: None,
            terminal_value: None,
        }
    }

    fn new_child(mv: Move, action: usize, prior: f64) -> Self {
        Node {
            mv: Some(mv),
            action: Some(action),
            prior,
            state: None,
            visits: 0,
            value_sum: 0.0,
            children: None,
            terminal_value: None,
        }
    }
}

/// Cached NN output for a state hash: value (to-move perspective) + ranked
/// (move, action, prior) candidates. Mirrors the JS table entry `{kind:"nn", ...}`.
#[derive(Clone)]
struct NnCacheEntry {
    value: f64,
    ranked: Vec<(Move, usize, f64)>,
}

fn normalize_value(score_diff: i32) -> f64 {
    (score_diff as f64 / 89.0).clamp(-1.0, 1.0)
}

/// Terminal value from the perspective of the player to move at `state`.
fn final_value_for_to_move(state: &GameState) -> f64 {
    let [score_a, score_b] = score_state(state);
    let diff = if state.current_player == 0 {
        score_a - score_b
    } else {
        score_b - score_a
    };
    normalize_value(diff)
}

/// Port of `hashState` from `apps/web/src/ai/transpositionTable.js`. The fields
/// and separators must match so the cache keys on the same logical state.
///   board: cells joined by ","        (here the i8 cell values directly)
///   starts: startAssignment joined by ","
///   remaining/placed: per-player piece lists joined by "." then "|" between players
///   lastPlaced: per-player joined by ","
///   forced: per-player booleans joined by ","
/// Top-level fields joined by "#".
fn hash_state(state: &GameState) -> String {
    let board = state
        .board
        .iter()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let starts = state
        .start_assignment
        .iter()
        .map(|s| match s {
            Some(crate::rules::StartId::A) => "A".to_string(),
            Some(crate::rules::StartId::B) => "B".to_string(),
            None => String::new(),
        })
        .collect::<Vec<_>>()
        .join(",");
    let remaining = state
        .remaining_pieces
        .iter()
        .map(|pieces| pieces.join("."))
        .collect::<Vec<_>>()
        .join("|");
    let placed = state
        .placed_pieces
        .iter()
        .map(|pieces| pieces.join("."))
        .collect::<Vec<_>>()
        .join("|");
    let last_placed = state
        .last_placed_piece
        .iter()
        .map(|p| p.clone().unwrap_or_default())
        .collect::<Vec<_>>()
        .join(",");
    let forced = state
        .forced_passed
        .iter()
        .map(|b| if *b { "true" } else { "false" })
        .collect::<Vec<_>>()
        .join(",");
    let status = match state.status {
        Status::Playing => "playing",
        Status::Finished => "finished",
    };
    let start_policy = match state.start_policy {
        crate::rules::StartPolicy::ChooseStart => "chooseStart",
        crate::rules::StartPolicy::FixedStart => "fixedStart",
    };
    [
        state.current_player.to_string(),
        state.turn.to_string(),
        status.to_string(),
        start_policy.to_string(),
        starts,
        last_placed,
        forced,
        state.consecutive_passes.to_string(),
        remaining,
        placed,
        board,
    ]
    .join("#")
}

/// Rank legal moves by policy logits and convert to softmax priors over the kept
/// candidates. Mirrors `rankByPolicy` + the `.slice(0, candidateLimit)` in
/// `expandLeaf`:
///   1. score each move by `logits[encodeAction(move)]`,
///   2. sort by score desc (seeded random tie-break),
///   3. softmax over the FULL sorted list (max-subtracted for stability),
///   4. truncate to `candidate_limit`.
/// Note the JS softmaxes over the full list then slices; we do the same so kept
/// priors are identical to the JS for the same logits and tie draws.
fn rank_by_policy(
    logits: &[f32],
    moves: &[Move],
    candidate_limit: usize,
    rng: &mut SplitMix64,
) -> Vec<(Move, usize, f64)> {
    // scoredDescending: (score, tie) with tie = rng() drawn in input order.
    let mut scored: Vec<(Move, usize, f64, f64)> = moves
        .iter()
        .map(|mv| {
            let action = encode_action(mv);
            let score = *logits.get(action).unwrap_or(&f32::NEG_INFINITY) as f64;
            let tie = rng.next_f64();
            (mv.clone(), action, score, tie)
        })
        .collect();
    // sort by (score desc) then (tie asc) — matches `(b.score - a.score) || (a.tie - b.tie)`.
    scored.sort_by(|a, b| {
        b.2.partial_cmp(&a.2)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });

    let max_logit = scored.first().map(|e| e.2).unwrap_or(0.0);
    let weights: Vec<f64> = scored.iter().map(|e| (e.2 - max_logit).exp()).collect();
    let total: f64 = {
        let s: f64 = weights.iter().sum();
        if s == 0.0 {
            1.0
        } else {
            s
        }
    };

    scored
        .into_iter()
        .zip(weights)
        .map(|((mv, action, _score, _tie), w)| (mv, action, w / total))
        .take(candidate_limit)
        .collect()
}

// --- Seeded sampling helpers (Dirichlet root noise + temperature). Ported from
//     policyValueMctsAi.js so reproducibility matches the JS for a given seed. ---

fn sample_normal(rng: &mut SplitMix64) -> f64 {
    let mut u1 = rng.next_f64();
    let u2 = rng.next_f64();
    if u1 < 1e-12 {
        u1 = 1e-12;
    }
    (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
}

fn sample_gamma(alpha: f64, rng: &mut SplitMix64) -> f64 {
    if alpha < 1.0 {
        let u = rng.next_f64().max(1e-12);
        return sample_gamma(alpha + 1.0, rng) * u.powf(1.0 / alpha);
    }
    let d = alpha - 1.0 / 3.0;
    let c = 1.0 / (9.0 * d).sqrt();
    for _ in 0..64 {
        let x = sample_normal(rng);
        let v = (1.0 + c * x).powi(3);
        if v <= 0.0 {
            continue;
        }
        let u = rng.next_f64().max(1e-12);
        if u.ln() < 0.5 * x * x + d - d * v + d * v.ln() {
            return d * v;
        }
    }
    d
}

fn sample_dirichlet(count: usize, alpha: f64, rng: &mut SplitMix64) -> Vec<f64> {
    let mut draws = Vec::with_capacity(count);
    let mut total = 0.0;
    for _ in 0..count {
        let g = sample_gamma(alpha, rng);
        draws.push(g);
        total += g;
    }
    if total <= 0.0 {
        return vec![1.0 / count as f64; count];
    }
    draws.iter().map(|v| v / total).collect()
}

/// The search driver. Generic over any [`PolicyValue`] backend.
pub struct Mcts<'a> {
    nn: &'a dyn PolicyValue,
    config: MctsConfig,
}

impl<'a> Mcts<'a> {
    pub fn new(nn: &'a dyn PolicyValue, config: MctsConfig) -> Self {
        Mcts { nn, config }
    }

    /// Run a search from `state` and return the chosen move + policy target.
    pub fn search(&self, state: &GameState) -> MctsResult {
        let mut rng = SplitMix64::new(self.config.seed);
        let mut nodes: Vec<Node> = Vec::new();
        let mut table: HashMap<String, NnCacheEntry> = HashMap::new();

        let legal_moves = generate_legal_moves(state);

        // Single forced pass: short-circuit exactly like the JS.
        if legal_moves.len() == 1 && matches!(legal_moves[0], Move::Pass { .. }) {
            let mv = legal_moves[0].clone();
            let action = encode_action(&mv);
            return MctsResult {
                chosen_move: mv,
                policy_target_actions: vec![action],
                policy_target_probs: vec![1.0],
                policy_target_visits: vec![1],
                total_visits: 1,
                root_value: 0.0,
                root_q: 0.0,
                simulations: 0,
                nodes: 1,
            };
        }

        // Root node (arena index 0).
        nodes.push(Node::new_root(state.clone()));
        let mut node_count: u64 = 1;

        // Expand the root once.
        let root_value = self.expand_leaf(0, &mut nodes, &mut table, &mut rng);
        self.apply_root_noise(0, &mut nodes, &mut rng);

        let start = std::time::Instant::now();
        let max_sims = self.config.max_simulations.unwrap_or(u64::MAX);
        let time_budget = self.config.time_limit_ms;
        let mut simulations: u64 = 0;

        loop {
            if simulations >= max_sims {
                break;
            }
            if time_budget > 0 && start.elapsed().as_millis() as u64 >= time_budget {
                break;
            }

            // --- Selection: descend to a leaf, materialising states lazily. ---
            let mut path: Vec<usize> = vec![0];
            let mut node_id = 0usize;
            loop {
                let has_children = matches!(&nodes[node_id].children, Some(c) if !c.is_empty());
                if !has_children {
                    break;
                }
                let child_id = self.select_child(node_id, &nodes);
                // Materialise the child state on first visit.
                if nodes[child_id].state.is_none() {
                    let parent_state = nodes[node_id]
                        .state
                        .clone()
                        .expect("parent state must exist during selection");
                    let mv = nodes[child_id]
                        .mv
                        .clone()
                        .expect("non-root child must carry a move");
                    nodes[child_id].state = Some(apply_move(&parent_state, &mv));
                    node_count += 1;
                }
                path.push(child_id);
                node_id = child_id;
            }

            // --- Evaluation: terminal re-selection vs. expansion. ---
            let is_terminal_leaf = matches!(&nodes[node_id].children, Some(c) if c.is_empty());
            let value = if is_terminal_leaf {
                // Re-selected terminal leaf.
                match nodes[node_id].terminal_value {
                    Some(tv) => tv,
                    None => {
                        let st = nodes[node_id]
                            .state
                            .as_ref()
                            .expect("terminal leaf has a state");
                        final_value_for_to_move(st)
                    }
                }
            } else {
                self.expand_leaf(node_id, &mut nodes, &mut table, &mut rng)
            };

            // --- Backup (negamax): negate once per ply on the way up. ---
            let mut v = value;
            for &nid in path.iter().rev() {
                nodes[nid].visits += 1;
                nodes[nid].value_sum += v;
                v = -v;
            }

            simulations += 1;
        }

        // --- Final move + policy target from the root's children. ---
        let chosen_id = self.choose_final_child(0, &nodes, &mut rng);
        let (policy_actions, policy_probs, policy_visits, total_visits) =
            self.build_policy_targets(0, &nodes, &legal_moves, &mut rng);

        let chosen_move = match chosen_id {
            Some(cid) => nodes[cid]
                .mv
                .clone()
                .expect("chosen child carries a move"),
            None => legal_moves[0].clone(),
        };

        let root_visits = nodes[0].visits;
        let root_q = if root_visits > 0 {
            nodes[0].value_sum / root_visits as f64
        } else {
            root_value
        };

        MctsResult {
            chosen_move,
            policy_target_actions: policy_actions,
            policy_target_probs: policy_probs,
            policy_target_visits: policy_visits,
            total_visits,
            root_value,
            root_q,
            simulations,
            nodes: node_count,
        }
    }

    /// Expand a leaf: set its children + return the leaf value in the leaf's
    /// to-move perspective. Mirrors `expandLeaf`.
    fn expand_leaf(
        &self,
        node_id: usize,
        nodes: &mut Vec<Node>,
        table: &mut HashMap<String, NnCacheEntry>,
        rng: &mut SplitMix64,
    ) -> f64 {
        // Terminal: no children, cache terminal value.
        let is_playing = {
            let st = nodes[node_id]
                .state
                .as_ref()
                .expect("expand_leaf requires a materialised state");
            st.status == Status::Playing
        };
        if !is_playing {
            let st = nodes[node_id].state.as_ref().unwrap();
            let tv = final_value_for_to_move(st);
            nodes[node_id].children = Some(Vec::new());
            nodes[node_id].terminal_value = Some(tv);
            return tv;
        }

        let hash = {
            let st = nodes[node_id].state.as_ref().unwrap();
            hash_state(st)
        };

        // NN-output cache (NOT a tree gate): reuse value + ranked priors only.
        if let Some(cached) = table.get(&hash).cloned() {
            let child_ids = self.attach_children(node_id, nodes, &cached.ranked);
            nodes[node_id].children = Some(child_ids);
            return cached.value;
        }

        let (moves, tensor, current_player) = {
            let st = nodes[node_id].state.as_ref().unwrap();
            let moves = generate_legal_moves(st);
            let tensor = encode_state_tensor(st, st.current_player);
            (moves, tensor, st.current_player)
        };
        let _ = current_player; // value is already in to-move perspective.

        let (logits, value) = self.nn.infer(&tensor);
        debug_assert_eq!(
            logits.len(),
            crate::action::action_size(),
            "policy logits length must equal ACTION_SIZE"
        );

        let ranked = rank_by_policy(&logits, &moves, self.config.candidate_limit, rng);
        table.insert(
            hash,
            NnCacheEntry {
                value,
                ranked: ranked.clone(),
            },
        );

        let child_ids = self.attach_children(node_id, nodes, &ranked);
        nodes[node_id].children = Some(child_ids);
        value
    }

    /// Materialise child node arena entries (states stay lazy/None) and return
    /// their ids.
    fn attach_children(
        &self,
        _parent_id: usize,
        nodes: &mut Vec<Node>,
        ranked: &[(Move, usize, f64)],
    ) -> Vec<usize> {
        let mut ids = Vec::with_capacity(ranked.len());
        for (mv, action, prior) in ranked {
            let id = nodes.len();
            nodes.push(Node::new_child(mv.clone(), *action, *prior));
            ids.push(id);
        }
        ids
    }

    /// PUCT child selection (negamax). Mirrors `selectChild` + `puctScore`.
    fn select_child(&self, node_id: usize, nodes: &[Node]) -> usize {
        let parent_visits = nodes[node_id].visits as f64;
        let children = nodes[node_id]
            .children
            .as_ref()
            .expect("select_child requires expanded children");
        let exploration_c = self.config.exploration_c;

        let mut best = children[0];
        let mut best_score = f64::NEG_INFINITY;
        for &cid in children {
            let child = &nodes[cid];
            let q = if child.visits == 0 {
                0.0
            } else {
                -(child.value_sum / child.visits as f64)
            };
            let u = exploration_c * child.prior * (parent_visits + 1.0).sqrt()
                / (1.0 + child.visits as f64);
            let score = q + u;
            if score > best_score {
                best = cid;
                best_score = score;
            }
        }
        best
    }

    /// Mix Dirichlet noise into the root children's priors. Mirrors
    /// `applyRootNoise`.
    fn apply_root_noise(&self, root_id: usize, nodes: &mut Vec<Node>, rng: &mut SplitMix64) {
        let weight = self.config.root_dirichlet_weight;
        let alpha = self.config.root_dirichlet_alpha;
        let count = match &nodes[root_id].children {
            Some(c) => c.len(),
            None => 0,
        };
        if !(weight > 0.0) || count <= 1 {
            return;
        }
        let noise = sample_dirichlet(count, alpha, rng);
        let child_ids = nodes[root_id].children.clone().unwrap();
        for (i, cid) in child_ids.iter().enumerate() {
            let p = nodes[*cid].prior;
            nodes[*cid].prior = (1.0 - weight) * p + weight * noise[i];
        }
    }

    /// Pick the final child: temperature sampling early, else argmax visits.
    /// Mirrors `chooseFinalChild`.
    fn choose_final_child(
        &self,
        root_id: usize,
        nodes: &[Node],
        rng: &mut SplitMix64,
    ) -> Option<usize> {
        let child_ids: Vec<usize> = match &nodes[root_id].children {
            Some(c) => c
                .iter()
                .copied()
                .filter(|&cid| nodes[cid].visits > 0 || nodes[cid].mv.is_some())
                .collect(),
            None => Vec::new(),
        };
        if child_ids.is_empty() {
            return None;
        }

        let temperature = self.config.move_sampling_temperature;
        let sampling_plies = self.config.move_sampling_plies;
        let root_turn = nodes[root_id]
            .state
            .as_ref()
            .map(|s| s.turn)
            .unwrap_or(u32::MAX);
        let use_sampling = temperature > 0.0 && root_turn < sampling_plies;

        if use_sampling {
            let weights: Vec<f64> = child_ids
                .iter()
                .map(|&cid| (nodes[cid].visits as f64).max(0.0).powf(1.0 / temperature))
                .collect();
            let total: f64 = weights.iter().sum();
            if total > 0.0 {
                let mut threshold = rng.next_f64() * total;
                for (i, &cid) in child_ids.iter().enumerate() {
                    threshold -= weights[i];
                    if threshold <= 0.0 {
                        return Some(cid);
                    }
                }
                return Some(*child_ids.last().unwrap());
            }
        }

        // argmax visits, with a seeded coin-flip tie-break (matches the JS
        // `child.visits === best.visits && rng() < 0.5`).
        let mut best = child_ids[0];
        for &cid in &child_ids {
            let cv = nodes[cid].visits;
            let bv = nodes[best].visits;
            if cv > bv || (cv == bv && rng.next_f64() < 0.5) {
                best = cid;
            }
        }
        Some(best)
    }

    /// Build the visit-distribution policy target. Mirrors `buildPolicyTargets`:
    /// children sorted by visits desc (seeded tie-break), probs = visits/total.
    fn build_policy_targets(
        &self,
        root_id: usize,
        nodes: &[Node],
        legal_moves: &[Move],
        rng: &mut SplitMix64,
    ) -> (Vec<usize>, Vec<f64>, Vec<u64>, u64) {
        let child_ids: Vec<usize> = match &nodes[root_id].children {
            Some(c) => c
                .iter()
                .copied()
                .filter(|&cid| nodes[cid].mv.is_some())
                .collect(),
            None => Vec::new(),
        };
        let total_visits: u64 = child_ids.iter().map(|&cid| nodes[cid].visits).sum();

        if total_visits == 0 {
            // Fallback: one-hot on the eventual best move (here: first legal),
            // matching the JS fallback path.
            let action = encode_action(&legal_moves[0]);
            return (vec![action], vec![1.0], vec![1], 1);
        }

        let mut entries: Vec<(usize, u64, f64)> = child_ids
            .iter()
            .map(|&cid| {
                let action = nodes[cid].action.expect("child carries an action");
                let visits = nodes[cid].visits;
                let tie = rng.next_f64();
                (action, visits, tie)
            })
            .collect();
        // sort by visits desc then tie asc — matches `(b.visits-a.visits)||(a.tie-b.tie)`.
        entries.sort_by(|a, b| {
            b.1.cmp(&a.1)
                .then(a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        });

        let actions = entries.iter().map(|e| e.0).collect();
        let visits = entries.iter().map(|e| e.1).collect();
        let probs = entries
            .iter()
            .map(|e| e.1 as f64 / total_visits as f64)
            .collect();
        (actions, probs, visits, total_visits)
    }
}

// ---------------------------------------------------------------------------
// Tests (no onnx feature required — use UniformPolicyValue).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    // `super::*` already brings `generate_legal_moves`, `GameState`,
    // `encode_action`, `Mcts`, `MctsConfig`, etc. into scope; only pull the
    // extra rules items the tests need.
    use super::*;
    use crate::inference::UniformPolicyValue;
    use crate::rules::{create_initial_state, StartPolicy};

    fn legal_move_set(state: &GameState) -> Vec<usize> {
        generate_legal_moves(state)
            .iter()
            .map(encode_action)
            .collect()
    }

    #[test]
    fn returns_a_legal_move_on_fresh_state() {
        let state = create_initial_state(StartPolicy::FixedStart);
        let nn = UniformPolicyValue;
        let cfg = MctsConfig {
            time_limit_ms: 0,
            max_simulations: Some(50),
            candidate_limit: 20,
            seed: 7,
            ..MctsConfig::default()
        };
        let mcts = Mcts::new(&nn, cfg);
        let result = mcts.search(&state);
        let chosen_action = encode_action(&result.chosen_move);
        assert!(
            legal_move_set(&state).contains(&chosen_action),
            "MCTS must choose a legal move"
        );
    }

    #[test]
    fn policy_target_is_visit_distribution_not_one_hot() {
        let state = create_initial_state(StartPolicy::FixedStart);
        let nn = UniformPolicyValue;
        let cfg = MctsConfig {
            time_limit_ms: 0,
            max_simulations: Some(200),
            candidate_limit: 16,
            seed: 11,
            ..MctsConfig::default()
        };
        let mcts = Mcts::new(&nn, cfg);
        let result = mcts.search(&state);

        // Multiple distinct actions should receive visits -> not a one-hot.
        assert!(
            result.policy_target_actions.len() > 1,
            "policy target should span multiple moves, got {}",
            result.policy_target_actions.len()
        );
        // Probabilities sum to ~1 and are visit-proportional.
        let sum: f64 = result.policy_target_probs.iter().sum();
        assert!((sum - 1.0).abs() < 1e-6, "probs should sum to 1, got {sum}");
        // Visits are sorted descending.
        for w in result.policy_target_visits.windows(2) {
            assert!(w[0] >= w[1], "visits must be sorted descending");
        }
        assert_eq!(result.total_visits, result.policy_target_visits.iter().sum());
    }

    #[test]
    fn grows_a_multi_ply_tree_no_depth0_collapse() {
        // Mirrors the JS test "master mcts grows a multi-ply tree": with only
        // `candidate_limit` root candidates and many sims, PUCT must materialise
        // grandchildren, so node count exceeds 1 + candidate_limit. The old
        // depth-0 transposition gate capped this at a single ply.
        let state = create_initial_state(StartPolicy::FixedStart);
        let nn = UniformPolicyValue;
        let candidate_limit = 6;
        let simulations = 80;
        let cfg = MctsConfig {
            time_limit_ms: 0,
            max_simulations: Some(simulations),
            candidate_limit,
            exploration_c: 1.5,
            seed: 1,
            ..MctsConfig::default()
        };
        let mcts = Mcts::new(&nn, cfg);
        let result = mcts.search(&state);

        assert!(
            result.nodes > (candidate_limit as u64) + 1,
            "expected multi-ply tree growth, got nodes={}",
            result.nodes
        );
        assert!(
            result.simulations >= simulations - 1,
            "expected ~{simulations} sims, got {}",
            result.simulations
        );
        assert!(
            result.root_q.abs() <= 1.0 + 1e-9,
            "root_q must stay within [-1,1], got {}",
            result.root_q
        );
    }

    #[test]
    fn root_dirichlet_noise_is_deterministic_for_a_seed() {
        let state = create_initial_state(StartPolicy::FixedStart);
        let nn = UniformPolicyValue;
        let cfg = MctsConfig {
            time_limit_ms: 0,
            max_simulations: Some(64),
            candidate_limit: 24,
            root_dirichlet_weight: 0.25,
            root_dirichlet_alpha: 0.3,
            seed: 42,
            ..MctsConfig::default()
        };
        let a = Mcts::new(&nn, cfg.clone()).search(&state);
        let b = Mcts::new(&nn, cfg).search(&state);
        assert_eq!(
            encode_action(&a.chosen_move),
            encode_action(&b.chosen_move),
            "same seed must produce the same move"
        );
        assert_eq!(a.policy_target_actions, b.policy_target_actions);
    }
}
