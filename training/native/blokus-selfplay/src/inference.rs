//! Policy/value neural-network inference for the native self-play engine.
//!
//! UNVERIFIED: authored without a local Rust toolchain. Run `cargo test`
//! (no features) and `cargo build --features onnx` before relying on this.
//!
//! The trait abstracts the network so MCTS (`crate::mcts`) is generic over the
//! backend:
//!   - [`UniformPolicyValue`] — always available (no native dependency). Returns
//!     all-zero logits + value 0.0, mirroring the JS test double used in
//!     `apps/web/tests/ai.test.mjs` ("master mcts grows a multi-ply tree"). With
//!     uniform priors, PUCT still expands children and descends the tree, so the
//!     no-onnx unit tests exercise the search faithfully.
//!   - [`OnnxPolicyValue`] — behind the `onnx` cargo feature; loads
//!     `blokus_policy_value.onnx` via the [`ort`] crate and runs
//!     `[N, 51, 14, 14] -> (policy_logits[N, 17837], value[N])`.
//!
//! Tensor / shape contract (must match the JS `modelRunner.js` and the exported
//! ONNX graph):
//!   - input:  `float32`, shape `[N, STATE_PLANES(51), BOARD_SIZE(14), BOARD_SIZE(14)]`
//!             flattened plane -> y -> x, i.e. exactly `encode_state_tensor` per row.
//!   - output 0: policy logits, `[N, ACTION_SIZE(17837)]`.
//!   - output 1: value, `[N]` (or `[N, 1]`), in the to-move player's perspective,
//!               already in `[-1, 1]` for a trained net.

use crate::action::action_size;
use crate::constants::{BOARD_SIZE, STATE_PLANES};

/// Length of a single encoded state (51 * 14 * 14 = 9996).
pub const STATE_TENSOR_LEN: usize = STATE_PLANES * BOARD_SIZE * BOARD_SIZE;

/// A policy/value evaluator. `infer` takes ONE flattened state tensor of length
/// [`STATE_TENSOR_LEN`] and returns `(logits, value)` where `logits.len() ==
/// action_size()` and `value` is in the to-move player's perspective.
///
/// Backends should implement [`infer_batch`]; [`infer`] has a default that wraps
/// it for a single sample.
pub trait PolicyValue {
    /// Evaluate a batch of `n` states (concatenated, each [`STATE_TENSOR_LEN`]
    /// floats; `tensors.len() == n * STATE_TENSOR_LEN`). Returns one
    /// `(logits, value)` per input row, in order.
    fn infer_batch(&self, tensors: &[f32], n: usize) -> Vec<(Vec<f32>, f32)>;

    /// Evaluate a single state. Default: delegate to [`infer_batch`] with n = 1.
    fn infer(&self, tensor: &[f32]) -> (Vec<f32>, f32) {
        debug_assert_eq!(
            tensor.len(),
            STATE_TENSOR_LEN,
            "infer expects a single flattened state tensor"
        );
        let mut out = self.infer_batch(tensor, 1);
        out.pop()
            .expect("infer_batch must return one result per input row")
    }
}

/// No-network baseline: zero logits (uniform priors after softmax) and value 0.0.
/// Always compiles — used by the `cargo test` MCTS invariants and as the fallback
/// when the crate is built without the `onnx` feature.
#[derive(Debug, Default, Clone, Copy)]
pub struct UniformPolicyValue;

impl PolicyValue for UniformPolicyValue {
    fn infer_batch(&self, tensors: &[f32], n: usize) -> Vec<(Vec<f32>, f32)> {
        debug_assert!(
            n == 0 || tensors.len() == n * STATE_TENSOR_LEN,
            "tensors length {} != n({}) * STATE_TENSOR_LEN({})",
            tensors.len(),
            n,
            STATE_TENSOR_LEN
        );
        let action_size = action_size();
        (0..n).map(|_| (vec![0.0f32; action_size], 0.0f32)).collect()
    }

    fn infer(&self, _tensor: &[f32]) -> (Vec<f32>, f32) {
        (vec![0.0f32; action_size()], 0.0f32)
    }
}

// ---------------------------------------------------------------------------
// ONNX backend (feature = "onnx")
// ---------------------------------------------------------------------------

#[cfg(feature = "onnx")]
mod onnx_backend {
    use super::{PolicyValue, STATE_TENSOR_LEN};
    use crate::action::action_size;
    use crate::constants::{BOARD_SIZE, STATE_PLANES};

    use ort::session::{builder::GraphOptimizationLevel, Session};
    use ort::value::Tensor;

    /// ONNX-backed policy/value network loaded from `blokus_policy_value.onnx`.
    ///
    /// The session is `Send + Sync`-shareable for read-only `run`; we keep a
    /// `Mutex` because `ort::Session::run` takes `&mut self`. Self-play is
    /// effectively single-threaded per actor, so contention is not a concern.
    pub struct OnnxPolicyValue {
        session: std::sync::Mutex<Session>,
        action_size: usize,
    }

    impl OnnxPolicyValue {
        /// Load a model from `model_path`. The graph must accept input
        /// `[N, 51, 14, 14]` and produce policy logits `[N, ACTION_SIZE]` plus a
        /// value `[N]`/`[N, 1]` (outputs taken positionally: index 0 = policy,
        /// index 1 = value — matching `modelRunner.js`).
        pub fn load(model_path: &str) -> Result<Self, String> {
            let session = Session::builder()
                .map_err(|e| format!("ort: failed to create session builder: {e}"))?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(|e| format!("ort: failed to set optimization level: {e}"))?
                .commit_from_file(model_path)
                .map_err(|e| format!("ort: failed to load model '{model_path}': {e}"))?;
            Ok(OnnxPolicyValue {
                session: std::sync::Mutex::new(session),
                action_size: action_size(),
            })
        }

        fn run_batch(&self, tensors: &[f32], n: usize) -> Result<Vec<(Vec<f32>, f32)>, String> {
            if n == 0 {
                return Ok(Vec::new());
            }
            if tensors.len() != n * STATE_TENSOR_LEN {
                return Err(format!(
                    "input length {} != n({}) * STATE_TENSOR_LEN({})",
                    tensors.len(),
                    n,
                    STATE_TENSOR_LEN
                ));
            }

            // Shape as `usize` dims (ort `Tensor::from_array` takes a shape tuple
            // of usize dims + the data buffer).
            let shape: [usize; 4] = [n, STATE_PLANES, BOARD_SIZE, BOARD_SIZE];
            let input = Tensor::from_array((shape, tensors.to_vec().into_boxed_slice()))
                .map_err(|e| format!("ort: failed to build input tensor: {e}"))?;

            let mut session = self
                .session
                .lock()
                .map_err(|_| "ort: session mutex poisoned".to_string())?;

            // Bind by the model's declared input name (index 0), mirroring
            // `session.inputNames[0]` in modelRunner.js. The `inputs!` macro's
            // map form takes `"name" => value` and returns the value directly.
            let input_name = session.inputs[0].name.clone();
            let outputs = session
                .run(ort::inputs! { input_name.as_str() => input })
                .map_err(|e| format!("ort: inference failed: {e}"))?;

            // Output 0 = policy logits, output 1 = value (positional, like the JS).
            let policy_name = session.outputs[0].name.clone();
            let value_name = session.outputs[1].name.clone();

            let (_p_shape, policy_data) = outputs[policy_name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("ort: failed to extract policy tensor: {e}"))?;
            let (_v_shape, value_data) = outputs[value_name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("ort: failed to extract value tensor: {e}"))?;

            let action_size = self.action_size;
            if policy_data.len() != n * action_size {
                return Err(format!(
                    "policy output length {} != n({}) * action_size({})",
                    policy_data.len(),
                    n,
                    action_size
                ));
            }
            if value_data.len() != n {
                return Err(format!(
                    "value output length {} != n({})",
                    value_data.len(),
                    n
                ));
            }

            let mut results = Vec::with_capacity(n);
            for row in 0..n {
                let start = row * action_size;
                let logits = policy_data[start..start + action_size].to_vec();
                results.push((logits, value_data[row]));
            }
            Ok(results)
        }
    }

    impl PolicyValue for OnnxPolicyValue {
        fn infer_batch(&self, tensors: &[f32], n: usize) -> Vec<(Vec<f32>, f32)> {
            // The trait method is infallible; surface backend failures via panic
            // (matches the JS, where a broken model throws and the master wrapper
            // catches it to fall back). Self-play callers should treat a panic
            // here as "model is broken" and abort the run.
            self.run_batch(tensors, n)
                .unwrap_or_else(|e| panic!("OnnxPolicyValue inference error: {e}"))
        }
    }
}

#[cfg(feature = "onnx")]
pub use onnx_backend::OnnxPolicyValue;
