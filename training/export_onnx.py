from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor_py"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

import torch

from policy_model import PolicyNet, PolicyValueNet


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", default=str(ROOT.parent / "apps" / "web" / "public" / "models" / "blokus_policy.onnx"))
    parser.add_argument("--model-kind", choices=["policy", "policy_value"], default="policy")
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu")
    model = PolicyNet() if args.model_kind == "policy" else PolicyValueNet()
    model.load_state_dict(checkpoint["model_state"])
    model.eval()

    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.zeros((1, 51, 14, 14), dtype=torch.float32)
    if args.model_kind == "policy":
        torch.onnx.export(
            model,
            dummy,
            output_path,
            input_names=["input"],
            output_names=["logits"],
            opset_version=17,
            dynamo=False,
            dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        )
    else:
        torch.onnx.export(
            model,
            dummy,
            output_path,
            input_names=["input"],
            output_names=["policy_logits", "value"],
            opset_version=17,
            dynamo=False,
            dynamic_axes={"input": {0: "batch"}, "policy_logits": {0: "batch"}, "value": {0: "batch"}},
        )
    print(output_path)


if __name__ == "__main__":
    main()
