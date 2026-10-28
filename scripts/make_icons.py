#!/usr/bin/env python3
"""Render the home-screen icons: an amber barbell on Mono charcoal.

Stdlib only, so it needs no image library. Shapes are signed-distance rounded rects,
anti-aliased by 4x4 supersampling. Writes the four PNGs into the repo root, overwriting
them; takes ~15 seconds.

  python3 scripts/make_icons.py

BG and AMBER are Mono's dark --bg and default --accent in index.html; change them
together. Each platform gets the shape it expects: the `any` icons are rounded squares,
the maskable one is full-bleed with the glyph inside the central safe zone (Android
crops it), and the iOS one is a full-bleed square (iOS rounds it and fills transparent
corners black).
"""

from pathlib import Path
import struct
import zlib


root = Path(__file__).resolve().parents[1]

BG = (0x1F, 0x1F, 0x21)
AMBER = (0xFC, 0xA3, 0x11)
SS = 4

ICONS = (
    ("icon-192.png", 192, "rounded"),
    ("icon-512.png", 512, "rounded"),
    ("icon-512-maskable.png", 512, "maskable"),
    ("apple-touch-icon.png", 180, "full"),
)


def rr(px, py, cx, cy, hw, hh, r):
    """Signed distance to a rounded rect centred at (cx, cy); <= 0 is inside."""
    qx, qy = abs(px - cx) - (hw - r), abs(py - cy) - (hh - r)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    return (ox * ox + oy * oy) ** 0.5 + min(max(qx, qy), 0.0) - r


def barbell(k):
    """Pills in unit coords, scaled about the centre by k: a bar, then a tall inner
    plate and a shorter outer plate on each side."""
    shapes = [(0.5, 0.5, 0.33 * k, 0.025 * k)]
    for dx, w, h in ((0.165, 0.085, 0.34), (0.255, 0.065, 0.22)):
        for side in (-1, 1):
            shapes.append((0.5 + side * dx * k, 0.5, w / 2 * k, h / 2 * k))
    return [(cx, cy, hw, hh, min(hw, hh)) for cx, cy, hw, hh in shapes]


def render(size, mode):
    corner = 0.225 if mode == "rounded" else 0.0
    # 0.82 keeps the plates' corners inside the maskable safe zone (radius 0.4).
    pills = barbell(0.82 if mode == "maskable" else 1.0)
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter type: none
        for x in range(size):
            bg_hits = fg_hits = 0
            for sy in range(SS):
                py = (y + (sy + 0.5) / SS) / size
                for sx in range(SS):
                    px = (x + (sx + 0.5) / SS) / size
                    if corner and rr(px, py, 0.5, 0.5, 0.5, 0.5, corner) > 0:
                        continue
                    bg_hits += 1
                    if any(rr(px, py, *p) <= 0 for p in pills):
                        fg_hits += 1
            if bg_hits:
                t = fg_hits / bg_hits
                rgb = [round(BG[i] + (AMBER[i] - BG[i]) * t) for i in range(3)]
            else:
                rgb = [0, 0, 0]
            row += bytes(rgb + [round(bg_hits / (SS * SS) * 255)])
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    for name, size, mode in ICONS:
        (root / name).write_bytes(render(size, mode))
        print(name)
