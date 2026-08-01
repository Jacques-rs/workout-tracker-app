#!/usr/bin/env python3
"""
snapshot_revision.py - preserve the current programme before a revision overwrites it.

Run this FIRST, before editing rows.json and rebuilding. It is the one step in a
revision that cannot be repaired afterwards: once program.json has been rebuilt
over the top, the prescription the athlete actually trained off is gone, and with
it the record the next block's planning depends on.

What it does, and nothing else:

  1. reads meta.version from the current program.json (absent => 1)
  2. copies program.json      -> <block>/revisions/program-v<N>.json
     and  rows.json (if any)  -> <block>/revisions/rows-v<N>.json
  3. appends a dated entry to <block>/CHANGELOG.md with WHAT changed and WHY
  4. prints N+1, the version to pass to build_program_json.py --version

It deliberately does NOT touch program.json. Snapshot (safe, reversible) and
rebuild (destructive) stay separate steps so a half-finished revision leaves a
consistent tree.

The "block folder" is simply the directory containing program.json, so this works
whether a block lives flat in programs/ or in its own subfolder.

Usage:
  python3 snapshot_revision.py --program athlete/jacques/programs/b1/program.json \
    --changed "W5 Day 1: front squat -> low-bar primary; sled held at 80 kg" \
    --reason  "Sharp 6/10 knee pain on the W4 sled progression"
"""
import argparse
import datetime
import json
import os
import shutil
import sys

CHANGELOG_HEADER = """# Revision changelog

One entry per revision of this block, newest first. Each records what changed and
**why** - the why is what makes the next block's planning better.

After any entry below, the athlete must re-import `program.json` into the tracker
app; it keeps showing the previous prescription until they do.
"""


def die(msg):
    sys.exit("error: " + msg)


def read_program(path):
    try:
        with open(path, encoding="utf-8") as f:
            prog = json.load(f)
    except FileNotFoundError:
        die(f"no such programme: {path}")
    except json.JSONDecodeError as e:
        die(f"{path} is not valid JSON: {e}")

    meta = prog.get("meta")
    if not isinstance(meta, dict):
        die(f"{path} has no meta object - is it really a program.json?")
    schema = meta.get("schema", "")
    if not str(schema).startswith("tp-program-"):
        die(f"{path} has schema {schema!r}, expected a tp-program-* file")
    return prog, meta


def current_version(meta, path):
    v = meta.get("version")
    if v is None:
        print(f"note: {os.path.basename(path)} has no meta.version - it predates "
              "the revision convention; treating it as v1", file=sys.stderr)
        return 1
    if not isinstance(v, int) or isinstance(v, bool) or v < 1:
        die(f"meta.version is {v!r}; it must be a positive integer")
    return v


def prepend_changelog(path, entry):
    """Newest entry first, below the whole header block.

    The split point is the first '## ' line - the header is prose that explains
    the file and must stay intact above every entry, so splitting on the first
    blank line (which lands mid-header) is wrong.
    """
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(CHANGELOG_HEADER + "\n" + entry)
        return

    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if line.startswith("## "):
            head, tail = "".join(lines[:i]), "".join(lines[i:])
            break
    else:                                    # header only, no entries yet
        head, tail = "".join(lines), ""
    head = (head.rstrip("\n") + "\n\n") if head.strip() else ""

    with open(path, "w", encoding="utf-8") as f:
        f.write(head + entry + tail)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--program", required=True,
                    help="path to the block's current program.json")
    ap.add_argument("--changed", required=True,
                    help="WHAT changed, one line: 'W5 Day 1: front squat -> low-bar'")
    ap.add_argument("--reason", required=True,
                    help="WHY, tied to logged data: 'sharp 6/10 knee pain on W4 sled'")
    ap.add_argument("--rows", default=None,
                    help="rows.json to snapshot too (default: alongside program.json)")
    ap.add_argument("--date", default=None, help="override the entry date (YYYY-MM-DD)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would happen and write nothing")
    a = ap.parse_args()

    for name, val in (("--changed", a.changed), ("--reason", a.reason)):
        if not val.strip():
            die(f"{name} is empty; a changelog entry without it is worthless")

    prog, meta = read_program(a.program)
    version = current_version(meta, a.program)
    nxt = version + 1

    block_dir = os.path.dirname(os.path.abspath(a.program))
    rev_dir = os.path.join(block_dir, "revisions")
    snap = os.path.join(rev_dir, f"program-v{version}.json")

    rows = a.rows if a.rows else os.path.join(block_dir, "rows.json")
    rows = rows if os.path.exists(rows) else None
    rows_snap = os.path.join(rev_dir, f"rows-v{version}.json") if rows else None

    if os.path.exists(snap) and not a.dry_run:
        die(f"{snap} already exists.\n"
            f"  meta.version says v{version} but v{version} is already archived - a previous "
            "revision was snapshotted and never rebuilt.\n"
            "  Stop and reconcile by hand; do not overwrite the archive.")

    date = a.date or datetime.date.today().isoformat()
    entry = (f"## v{nxt} - {date} (supersedes v{version})\n\n"
             f"**Changed:** {a.changed.strip()}\n\n"
             f"**Why:** {a.reason.strip()}\n\n"
             f"**Athlete action:** re-import `program.json` into the tracker.\n\n")
    changelog = os.path.join(block_dir, "CHANGELOG.md")

    if a.dry_run:
        print(f"would archive {a.program} -> {snap}")
        if rows:
            print(f"would archive {rows} -> {rows_snap}")
        print(f"would {'append to' if os.path.exists(changelog) else 'create'} {changelog}:")
        print("  " + entry.replace("\n", "\n  ").rstrip())
        print(f"next version: {nxt}")
        return

    os.makedirs(rev_dir, exist_ok=True)
    shutil.copy2(a.program, snap)
    print(f"OK: archived v{version} -> {snap}")
    if rows:
        shutil.copy2(rows, rows_snap)
        print(f"OK: archived rows   -> {rows_snap}")
    else:
        print("note: no rows.json beside program.json - the workbook for v"
              f"{version} cannot be rebuilt from the archive", file=sys.stderr)

    prepend_changelog(changelog, entry)
    print(f"OK: changelog entry for v{nxt} -> {changelog}")

    print(f"\nNext version: {nxt}")
    print("Now edit rows.json, then rebuild BOTH outputs:")
    print(f"  build_program_json.py --input rows.json --output program.json \\\n"
          f"    --block {meta.get('block', '<block>')!r} "
          f"--athlete {meta.get('athlete', '<athlete>')!r} "
          f"--weeks {meta.get('weeks', '<n>')} --version {nxt}")
    print("  build_xlsx.py --input rows.json --output '<Block name> - Programme.xlsx'")
    print("Then tell the athlete to re-import program.json.")


if __name__ == "__main__":
    main()
