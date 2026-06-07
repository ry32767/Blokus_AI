from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

from blokus_shared import ACTION_SIZE, ORIENTATION_COUNT, PASS_ACTION, encode_action, decode_action, encode_state


def main() -> int:
    command = sys.argv[1]

    if command == "summary":
        print(json.dumps({
            "orientationCount": ORIENTATION_COUNT,
            "actionSize": ACTION_SIZE,
            "passAction": PASS_ACTION,
        }))
        return 0

    if command == "action":
        move = json.loads(sys.argv[2])
        action = encode_action(move)
        decoded = decode_action(action, int(move.get("player", 0)))
        print(json.dumps({"action": action, "decoded": decoded}))
        return 0

    if command == "encode_state":
        state = json.loads(sys.argv[2])
        player = int(sys.argv[3])
        tensor = encode_state(state, player)
        print(json.dumps({
            "shape": list(tensor.shape),
            "flat": tensor.reshape(-1).tolist(),
        }))
        return 0

    raise SystemExit(f"Unsupported command: {command}")


if __name__ == "__main__":
    raise SystemExit(main())
