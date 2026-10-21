#!/usr/bin/env python3
"""生成演示用的真实图表（不是色块）：三种优化器的有效学习率随步数变化。"""
import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

out = sys.argv[1] if len(sys.argv) > 1 else "fig1.png"
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

steps = list(range(0, 12001, 250))


def curve(scale, decay, noise):
    return [scale / (1.0 + decay * s / 1000.0) * (1.0 + noise * math.sin(s / 700.0)) for s in steps]


fig, ax = plt.subplots(figsize=(4.2, 2.7), dpi=200)
ax.plot(steps, curve(0.31, 0.55, 0.03), label="Muon", linewidth=1.6)
ax.plot(steps, curve(0.10, 1.15, 0.05), label="SGD", linewidth=1.2, linestyle="--")
ax.plot(steps, curve(0.08, 0.95, 0.04), label="Adam", linewidth=1.2, linestyle=":")
ax.set_xlabel("Training step", fontsize=8)
ax.set_ylabel(r"Effective learning rate $\eta_{\mathrm{eff}}$", fontsize=8)
ax.tick_params(labelsize=7)
ax.legend(fontsize=7, frameon=False)
ax.grid(alpha=0.25, linewidth=0.5)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
fig.tight_layout()
fig.savefig(out, bbox_inches="tight")
print(out)
