from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor_py"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

import torch
from torch import nn

from blokus_shared import ACTION_SIZE, ORIENTATION_COUNT, STATE_PLANES


class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
        )
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x):
        return self.relu(x + self.block(x))


class Trunk(nn.Module):
    def __init__(self, channels: int = 64, residual_blocks: int = 4):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(STATE_PLANES, channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(inplace=True),
        )
        self.trunk = nn.Sequential(*[ResidualBlock(channels) for _ in range(residual_blocks)])

    def forward(self, x):
        return self.trunk(self.stem(x))


class PolicyHead(nn.Module):
    def __init__(self, channels: int = 64):
        super().__init__()
        self.policy_head = nn.Sequential(
            nn.Conv2d(channels, 32, kernel_size=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, ORIENTATION_COUNT, kernel_size=1, bias=True),
        )
        self.pass_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(channels, 32),
            nn.ReLU(inplace=True),
            nn.Linear(32, 1),
        )

    def forward(self, features):
        policy_logits = self.policy_head(features).flatten(start_dim=1)
        pass_logit = self.pass_head(features)
        return torch.cat([policy_logits, pass_logit], dim=1)


class PolicyNet(nn.Module):
    def __init__(self, channels: int = 64, residual_blocks: int = 4):
        super().__init__()
        self.trunk = Trunk(channels, residual_blocks)
        self.policy = PolicyHead(channels)

    def forward(self, x):
        features = self.trunk(x)
        return self.policy(features)


class ValueHead(nn.Module):
    def __init__(self, channels: int = 64):
        super().__init__()
        self.value_head = nn.Sequential(
            nn.Conv2d(channels, 32, kernel_size=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(32, 64),
            nn.ReLU(inplace=True),
            nn.Linear(64, 1),
            nn.Tanh(),
        )

    def forward(self, features):
        return self.value_head(features)


class PolicyValueNet(nn.Module):
    def __init__(self, channels: int = 64, residual_blocks: int = 4):
        super().__init__()
        self.trunk = Trunk(channels, residual_blocks)
        self.policy = PolicyHead(channels)
        self.value = ValueHead(channels)

    def forward(self, x):
        features = self.trunk(x)
        policy_logits = self.policy(features)
        value = self.value(features)
        return policy_logits, value
