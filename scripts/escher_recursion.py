#!/usr/bin/env python3
"""Generate an Escher-style recursive transform around a chosen focal point.

Usage example:
  python3 scripts/escher_recursion.py \
      --input lecture.png \
      --output lecture-escher.png \
      --center 567 289 \
      --branch-dir 160 \
      --q 22.5836845286 \
      --zoom 0.95
"""

from __future__ import annotations

import argparse
import cmath
import math
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path, help="Input image path")
    p.add_argument("--output", required=True, type=Path, help="Output image path")
    p.add_argument(
        "--center",
        nargs=2,
        type=float,
        metavar=("X", "Y"),
        required=True,
        help="Focal center in pixel coordinates (x y)",
    )
    p.add_argument(
        "--q",
        type=float,
        default=22.5836845286,
        help="Scale factor from Escher model (default: 22.5836845286)",
    )
    p.add_argument(
        "--zoom",
        type=float,
        default=0.95,
        help="Additional zoom around focal point (default: 0.95)",
    )
    p.add_argument(
        "--branch-dir",
        type=float,
        default=160.0,
        help="Branch/opening direction in degrees (default: 160)",
    )
    p.add_argument("--eps", type=float, default=1e-12, help="Epsilon to avoid log(0)")
    p.add_argument(
        "--center-patch",
        type=float,
        default=0.0,
        help="Optional white patch radius in pixels around center",
    )
    return p.parse_args()


def bilinear_sample(pix, w: int, h: int, x: float, y: float) -> tuple[int, int, int]:
    if x < 0:
        x = 0.0
    elif x > w - 1:
        x = w - 1.0
    if y < 0:
        y = 0.0
    elif y > h - 1:
        y = h - 1.0

    x0 = int(math.floor(x))
    y0 = int(math.floor(y))
    x1 = min(x0 + 1, w - 1)
    y1 = min(y0 + 1, h - 1)

    dx = x - x0
    dy = y - y0

    c00 = pix[x0, y0]
    c10 = pix[x1, y0]
    c01 = pix[x0, y1]
    c11 = pix[x1, y1]

    out = []
    for i in range(3):
        v = (
            c00[i] * (1 - dx) * (1 - dy)
            + c10[i] * dx * (1 - dy)
            + c01[i] * (1 - dx) * dy
            + c11[i] * dx * dy
        )
        out.append(max(0, min(255, int(round(v)))))
    return tuple(out)


def main() -> None:
    args = parse_args()

    src = Image.open(args.input).convert("RGB")
    w, h = src.size
    src_pix = src.load()

    out = Image.new("RGB", (w, h), "white")
    out_pix = out.load()

    cx, cy = args.center
    q = args.q
    zoom = args.zoom
    branch = math.radians(args.branch_dir)
    eps = args.eps

    # alpha = 1 - i*log(q)/(2*pi)
    alpha = 1.0 - 1j * (math.log(q) / (2.0 * math.pi))

    # center in complex normalized plane
    uc = -1.0 + 2.0 * cx / (w - 1.0)
    vc = 1.0 - 2.0 * cy / (h - 1.0)
    z_center = complex(uc, vc)

    rot_neg = cmath.exp(-1j * branch)
    rot_pos = cmath.exp(1j * branch)

    for y in range(h):
        v = 1.0 - 2.0 * y / (h - 1.0)
        for x in range(w):
            u = -1.0 + 2.0 * x / (w - 1.0)
            w_complex = complex(u, v)

            z = (w_complex - z_center) * rot_neg
            if abs(z) < eps:
                sx, sy = cx, cy
            else:
                mapped = z_center + rot_pos * zoom * cmath.exp(cmath.log(z) / alpha)
                sx = ((mapped.real + 1.0) * 0.5) * (w - 1.0)
                sy = ((1.0 - mapped.imag) * 0.5) * (h - 1.0)

            out_pix[x, y] = bilinear_sample(src_pix, w, h, sx, sy)

    if args.center_patch > 0:
        r2 = args.center_patch * args.center_patch
        for y in range(h):
            dy = y - cy
            for x in range(w):
                dx = x - cx
                if dx * dx + dy * dy <= r2:
                    out_pix[x, y] = (255, 255, 255)

    out.save(args.output)
    print(f"Saved: {args.output}")


if __name__ == "__main__":
    main()
