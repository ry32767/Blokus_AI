# Critical State Replay

Critical State Replay builds policy-value training samples from important positions rather than only copying a teacher move.

1. `npm run generate:trajectory -- --games 100 --ai expert --teacher-ms 50 --out training/dataset/trajectories/expert-100`
2. `npm run generate:critical-replay -- --trajectories training/dataset/trajectories/expert-100 --out training/dataset/critical_replay/expert-100 --critical-states-per-game 8 --top-k-actions 8 --playouts-per-action 2`
3. `npm run train:policy-value -- --dataset training/dataset/critical_replay/expert-100/records.jsonl --epochs 1 --cpu`

Each output record contains:

- `encoded_state`
- `legal_actions`
- `evaluated_actions`
- `q_values`
- `policy_probs`
- `best_action`
- `blunder_score`
- compatibility fields for the existing policy-value trainer
