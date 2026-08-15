#!/usr/bin/env python3
"""Syntax-check browser JavaScript and verify the vendored SDK checksum."""

from pathlib import Path
import hashlib
import re
import subprocess
import tempfile


root = Path(__file__).resolve().parents[1]
html = (root / "index.html").read_text(encoding="utf-8")
blocks = [match.group(2) for match in re.finditer(
    r"<script([^>]*)>(.*?)</script>", html, re.DOTALL
) if not re.search(r"\bsrc\s*=", match.group(1))]

if not blocks:
    raise SystemExit("No inline scripts found in index.html")

for index, block in enumerate(blocks):
    with tempfile.NamedTemporaryFile("w", suffix=f"-{index}.js", encoding="utf-8") as temp:
        temp.write(block)
        temp.flush()
        subprocess.run(["node", "--check", temp.name], check=True)

browser_scripts = [root / "sw.js", *(root / "js").glob("*.js")]
for path in browser_scripts:
    subprocess.run(["node", "--check", path], check=True)

vendor = root / "vendor" / "supabase-js-2.111.0.min.js"
expected = "0c2562701c7ac6da5f79607f1e001c5d7fa1a56a591cf383996c4212267a925d"
actual = hashlib.sha256(vendor.read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit(f"Vendored Supabase SDK checksum mismatch: {actual}")

print(
    f"Browser JavaScript syntax: {len(blocks)} inline + "
    f"{len(browser_scripts)} local files passed; vendor checksum passed"
)
