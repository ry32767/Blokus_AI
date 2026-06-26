//! Runnable parity checker (no test harness required).
//!
//! Loads `training/native/parity/golden.json` and prints PASS/FAIL per check, then a
//! summary. Exits non-zero if any check fails. Mirrors `tests/parity.rs` so it can be
//! used as a quick smoke without `cargo test`.
//!
//! Usage: cargo run --bin parity_check
//!        cargo run --bin parity_check -- path/to/golden.json

use std::path::PathBuf;

use blokus_selfplay::{
    action_size, apply_move, create_initial_state, decode_action, encode_action,
    encode_state_tensor, generate_legal_moves, orientation_count, pass_action, score_player,
    score_state, GameState, Move, StartId, StartPolicy, Status,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn board_bytes(state: &GameState) -> Vec<u8> {
    state
        .board
        .iter()
        .map(|&cell| if cell < 0 { 0u8 } else { (cell + 1) as u8 })
        .collect()
}

fn state_bytes(state: &GameState, player: u8) -> Vec<u8> {
    let tensor = encode_state_tensor(state, player);
    let mut bytes = Vec::with_capacity(tensor.len() * 4);
    for v in tensor {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

struct Report {
    passed: usize,
    failed: usize,
}

impl Report {
    fn new() -> Self {
        Report { passed: 0, failed: 0 }
    }
    fn check(&mut self, name: &str, ok: bool, detail: impl FnOnce() -> String) {
        if ok {
            self.passed += 1;
            println!("PASS  {name}");
        } else {
            self.failed += 1;
            println!("FAIL  {name}  -- {}", detail());
        }
    }
}

fn u(v: &Value) -> usize {
    v.as_u64().expect("expected unsigned integer") as usize
}
fn i(v: &Value) -> i64 {
    v.as_i64().expect("expected integer")
}
fn s(v: &Value) -> &str {
    v.as_str().expect("expected string")
}

fn parse_policy(name: &str) -> StartPolicy {
    StartPolicy::parse(name).unwrap_or_else(|| panic!("unknown start policy {name}"))
}

fn main() {
    let arg_path = std::env::args().nth(1);
    let path = match arg_path {
        Some(p) => PathBuf::from(p),
        None => {
            let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            p.push("../parity/golden.json");
            p
        }
    };

    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    let g: Value = serde_json::from_str(&text).expect("failed to parse golden.json");

    let mut r = Report::new();

    // ---- constants ----
    r.check(
        "orientationCount==91",
        u(&g["orientationCount"]) == 91 && orientation_count() == 91,
        || format!("golden={} native={}", u(&g["orientationCount"]), orientation_count()),
    );
    r.check(
        "actionSize==17837",
        u(&g["actionSize"]) == 17837 && action_size() == 17837,
        || format!("golden={} native={}", u(&g["actionSize"]), action_size()),
    );
    r.check(
        "passAction==17836",
        u(&g["passAction"]) == 17836 && pass_action() == 17836,
        || format!("golden={} native={}", u(&g["passAction"]), pass_action()),
    );
    r.check(
        "startPoints A(4,4)/B(9,9)",
        u(&g["startPoints"]["A"]["x"]) == 4
            && u(&g["startPoints"]["A"]["y"]) == 4
            && u(&g["startPoints"]["B"]["x"]) == 9
            && u(&g["startPoints"]["B"]["y"]) == 9
            && StartId::A.point() == (4, 4)
            && StartId::B.point() == (9, 9),
        || "start point mismatch".to_string(),
    );

    // ---- initial legal move counts ----
    let choose = generate_legal_moves(&create_initial_state(StartPolicy::ChooseStart)).len();
    let fixed = generate_legal_moves(&create_initial_state(StartPolicy::FixedStart)).len();
    r.check(
        "initialLegalMoves.chooseStart==828",
        choose == 828 && u(&g["initialLegalMoveCounts"]["chooseStart"]) == 828,
        || format!("native={choose} golden={}", u(&g["initialLegalMoveCounts"]["chooseStart"])),
    );
    r.check(
        "initialLegalMoves.fixedStart==414",
        fixed == 414 && u(&g["initialLegalMoveCounts"]["fixedStart"]) == 414,
        || format!("native={fixed} golden={}", u(&g["initialLegalMoveCounts"]["fixedStart"])),
    );

    // ---- action round trips ----
    {
        let mut all_ok = true;
        let mut first_detail = String::new();
        for entry in g["actionRoundTrips"].as_array().expect("actionRoundTrips array") {
            let action = u(&entry["action"]);
            let player = u(&entry["player"]) as u8;
            let decoded = decode_action(action, player);
            let reencoded = encode_action(&decoded);
            let mut ok = reencoded == u(&entry["reencoded"]) && reencoded == action;
            match (&decoded, s(&entry["decoded"]["kind"])) {
                (Move::Pass { .. }, "pass") => {}
                (
                    Move::Place {
                        piece_id,
                        orientation_global_id,
                        x,
                        y,
                        ..
                    },
                    "place",
                ) => {
                    ok = ok
                        && piece_id.as_str() == s(&entry["decoded"]["pieceId"])
                        && *orientation_global_id == u(&entry["decoded"]["orientationGlobalId"])
                        && *x == u(&entry["decoded"]["x"])
                        && *y == u(&entry["decoded"]["y"]);
                }
                _ => ok = false,
            }
            if !ok && first_detail.is_empty() {
                first_detail = format!("action {action} decoded {decoded:?}");
            }
            all_ok &= ok;
        }
        r.check("actionRoundTrips", all_ok, || first_detail.clone());
    }

    // ---- scoring samples ----
    {
        let mut blank = create_initial_state(StartPolicy::FixedStart);
        blank.status = Status::Finished;
        let blank_score = score_player(&blank, 0);

        let mut i1 = create_initial_state(StartPolicy::FixedStart);
        i1.remaining_pieces[0] = Vec::new();
        i1.last_placed_piece[0] = Some("I1".to_string());
        let i1_score = score_player(&i1, 0);

        let mut i2 = create_initial_state(StartPolicy::FixedStart);
        i2.remaining_pieces[0] = Vec::new();
        i2.last_placed_piece[0] = Some("I2".to_string());
        let i2_score = score_player(&i2, 0);

        let ss = &g["scoringSamples"];
        r.check(
            "scoring.blankFinishedP0==-89",
            blank_score == -89 && i(&ss["blankFinishedP0"]) == -89,
            || format!("native={blank_score} golden={}", i(&ss["blankFinishedP0"])),
        );
        r.check(
            "scoring.allPlacedLastI1==20",
            i1_score == 20 && i(&ss["allPlacedLastI1"]) == 20,
            || format!("native={i1_score} golden={}", i(&ss["allPlacedLastI1"])),
        );
        r.check(
            "scoring.allPlacedLastI2==15",
            i2_score == 15 && i(&ss["allPlacedLastI2"]) == 15,
            || format!("native={i2_score} golden={}", i(&ss["allPlacedLastI2"])),
        );
    }

    // ---- deterministic games ----
    for game in g["deterministicGames"].as_array().expect("deterministicGames array") {
        let policy_name = s(&game["startPolicy"]).to_string();
        let policy = parse_policy(&policy_name);
        let mut state = create_initial_state(policy);
        let mut game_ok = true;
        let mut detail = String::new();

        for expected in game["positions"].as_array().expect("positions array") {
            if state.status != Status::Playing {
                game_ok = false;
                detail = format!("ply {} not playing", u(&expected["ply"]));
                break;
            }
            let moves = generate_legal_moves(&state);
            let move_index = (state.turn as usize) % moves.len();
            let mv = &moves[move_index];
            let [score_a, score_b] = score_state(&state);

            let board_sha = sha256_hex(&board_bytes(&state));
            let state_sha = sha256_hex(&state_bytes(&state, state.current_player));

            let ply_ok = state.turn == u(&expected["turn"]) as u32
                && state.current_player == u(&expected["currentPlayer"]) as u8
                && moves.len() == u(&expected["legalMoveCount"])
                && move_index == u(&expected["moveIndex"])
                && encode_action(mv) == u(&expected["selectedAction"])
                && score_a as i64 == i(&expected["scoreA"])
                && score_b as i64 == i(&expected["scoreB"])
                && board_sha == s(&expected["boardSha"])
                && state_sha == s(&expected["stateShaCurrent"]);

            if !ply_ok {
                game_ok = false;
                detail = format!(
                    "ply {} mismatch (legal native={} golden={}, action native={} golden={}, boardSha {}, stateSha {})",
                    u(&expected["ply"]),
                    moves.len(),
                    u(&expected["legalMoveCount"]),
                    encode_action(mv),
                    u(&expected["selectedAction"]),
                    if board_sha == s(&expected["boardSha"]) { "ok" } else { "DIFF" },
                    if state_sha == s(&expected["stateShaCurrent"]) { "ok" } else { "DIFF" },
                );
                break;
            }

            state = apply_move(&state, mv);
        }

        if game_ok {
            let [final_a, final_b] = score_state(&state);
            let final_board_sha = sha256_hex(&board_bytes(&state));
            let status_ok = match s(&game["status"]) {
                "finished" => state.status == Status::Finished,
                "playing" => state.status == Status::Playing,
                _ => false,
            };
            game_ok = final_a as i64 == i(&game["finalScoreA"])
                && final_b as i64 == i(&game["finalScoreB"])
                && final_board_sha == s(&game["finalBoardSha"])
                && status_ok;
            if !game_ok {
                detail = format!(
                    "final mismatch (score native={final_a}/{final_b} golden={}/{}, boardSha {}, status {})",
                    i(&game["finalScoreA"]),
                    i(&game["finalScoreB"]),
                    if final_board_sha == s(&game["finalBoardSha"]) { "ok" } else { "DIFF" },
                    if status_ok { "ok" } else { "DIFF" },
                );
            }
        }

        r.check(&format!("deterministicGame[{policy_name}]"), game_ok, || detail.clone());
    }

    println!("\n{} passed, {} failed", r.passed, r.failed);
    if r.failed > 0 {
        std::process::exit(1);
    }
}
