#!/usr/bin/env -S uv run --with matplotlib --with numpy python
"""Regenerate the depth-compounding figure for the Nearby Prompts post.

Source: Li et al. 2025, "Cognitive Activation and Chaotic Dynamics in Large
Language Models: A Quasi-Lyapunov Analysis of Reasoning Mechanisms"
(arXiv:2503.13530), Figure 2(a)/(c).

The paper normalizes the input encoding, then for each layer computes the
modulus ratio R = ||h_i|| / ||h_0|| and takes the log-mean over token vectors.
That series is piecewise linear in log space, fit in the paper as:

    layers  0-9   slope 0.27   -> 1.32x per layer
    layers 10-38  slope 0.075  -> 1.08x per layer

This plots that fit. It is hidden-state magnitude growth, not perturbation
growth, and not the QLE heatmap (Figure 6) which reports the opposite
depth trend: shallow layers convergent, deep layers divergent.
"""

import matplotlib.pyplot as plt
import numpy as np

SLOPE_EARLY = 0.27
SLOPE_LATE = 0.075
BREAK = 10
LAST = 38

OUT = (
    "content/blog/nearby-prompts-distant-trajectories/"
    "assets/figures/depth-compounding.png"
)

layers = np.arange(0, LAST + 1)
log_ratio = np.where(
    layers < BREAK,
    SLOPE_EARLY * layers,
    SLOPE_EARLY * BREAK + SLOPE_LATE * (layers - BREAK),
)
ratio = np.exp(log_ratio)

plt.rcParams.update({
    "figure.facecolor": "#faf9f7",
    "axes.facecolor": "#faf9f7",
    "font.size": 13,
    "axes.edgecolor": "#333333",
})

fig, ax = plt.subplots(figsize=(11, 5.5), dpi=170)

ax.axvspan(-0.6, BREAK - 0.5, color="#c0392b", alpha=0.07)
ax.axvspan(BREAK - 0.5, LAST + 0.6, color="#2c3e50", alpha=0.05)

ax.plot(layers, ratio, color="#c0392b", lw=2.4, marker="o", ms=4.5,
        markerfacecolor="#c0392b", markeredgecolor="none", zorder=3)

ax.set_yscale("log")
ax.set_xlim(-0.6, LAST + 4.5)
ax.set_xlabel("Transformer layer (depth)")
ax.set_ylabel("Hidden-state magnitude ÷ input magnitude  (log)")
ax.set_title(
    "Hidden-state magnitude compounds through depth, but the rate drops off\n"
    "Li et al. 2025 (arXiv:2503.13530), Qwen2, piecewise fit of Figure 2",
    fontsize=14, loc="left", pad=14,
)

ax.grid(axis="y", color="#cccccc", ls=":", lw=0.7, alpha=0.7)
ax.set_axisbelow(True)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)

ax.axvline(BREAK - 0.5, color="#555555", ls="--", lw=1.1, alpha=0.8)

ax.annotate(
    "layers 0–9\n1.32× per layer",
    xy=(4, ratio[4]), xytext=(1.2, 26),
    color="#c0392b", fontsize=12.5, fontweight="bold", ha="left",
    arrowprops=dict(arrowstyle="->", color="#c0392b", lw=1.2,
                    connectionstyle="arc3,rad=-0.2"),
)

ax.annotate(
    "layers 10–38\n1.08× per layer",
    xy=(26, ratio[26]), xytext=(17, 2.6),
    color="#2c3e50", fontsize=12.5, fontweight="bold", ha="left",
    arrowprops=dict(arrowstyle="->", color="#2c3e50", lw=1.2,
                    connectionstyle="arc3,rad=0.25"),
)

ax.annotate(
    f"×{ratio[-1]:.0f}\nby layer {LAST}",
    xy=(LAST, ratio[-1]), xytext=(LAST + 1.2, ratio[-1] * 0.62),
    color="#2c3e50", fontsize=12.5, fontweight="bold", ha="left", va="center",
)

fig.text(
    0.012, 0.015,
    "Log-mean modulus ratio ‖h_i‖ / ‖h_0‖ over token vectors, input encoding "
    "normalized. Magnitude growth, not perturbation growth.",
    fontsize=9.5, color="#666666",
)

fig.tight_layout(rect=(0, 0.035, 1, 1))
fig.savefig(OUT)
print(f"wrote {OUT}  (final ratio x{ratio[-1]:.1f})")
