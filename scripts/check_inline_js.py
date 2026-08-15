#!/usr/bin/env python3
"""Syntax-check every inline JavaScript block in index.html."""

from pathlib import Path
import re
import subprocess
import tempfile


root = Path(__file__).resolve().parents[1]
html = (root / "index.html").read_text(encoding="utf-8")
blocks = re.findall(r"<script[^>]*>(.*?)</script>", html, re.DOTALL)

if not blocks:
    raise SystemExit("No inline scripts found in index.html")

for index, block in enumerate(blocks):
    with tempfile.NamedTemporaryFile("w", suffix=f"-{index}.js", encoding="utf-8") as temp:
        temp.write(block)
        temp.flush()
        subprocess.run(["node", "--check", temp.name], check=True)

print(f"Inline JavaScript syntax: {len(blocks)} blocks passed")
