#!/usr/bin/env python3
"""
build_program_json.py - convert programme rows into program.json for the tracker PWA.

Reads the SAME rows.json used by build_xlsx.py (a list of 13-field rows, or
{"rows": [...]}), and emits a program.json with schema "tp-program-1".

Columns, in order:
  Week | Day | Exercise | Sets | Reps | Load | Intensity (RPE) | Tempo | Rest |
  Completed | Completed Notes | Focus / Notes | Progression Rule

Usage:
  python build_program_json.py --input rows.json --output program.json \
    --block "Block name" --athlete "Name" --weeks 6
"""
import argparse, json, datetime, sys


def load_rows(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    rows = data["rows"] if isinstance(data, dict) else data
    for i, r in enumerate(rows):
        if len(r) != 13:
            sys.exit(f"row {i} has {len(r)} fields (need 13)")
    return rows


def build(rows, block, athlete, weeks):
    order, exercises = [], []
    for v in rows:
        v = ["" if c is None else str(c) for c in v]
        day = v[1]
        if day not in order:
            order.append(day)
        di = order.index(day)
        ei = sum(1 for e in exercises if e["day"] == day) + 1
        week = int(v[0]) if v[0].strip().isdigit() else 1
        exercises.append({
            "id": f"d{di+1}e{ei}", "week": week, "day": day, "name": v[2],
            "sets": v[3], "reps": v[4], "load": v[5], "rpe": v[6],
            "tempo": v[7], "rest": v[8],
            "logHint": v[10], "focus": v[11], "progression": v[12],
        })
    return {
        "meta": {
            "block": block, "athlete": athlete, "weeks": int(weeks),
            "generated": datetime.date.today().isoformat(),
            "days": order, "schema": "tp-program-1",
        },
        "exercises": exercises,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--block", required=True)
    ap.add_argument("--athlete", default="")
    ap.add_argument("--weeks", default="6")
    a = ap.parse_args()
    prog = build(load_rows(a.input), a.block, a.athlete, a.weeks)
    with open(a.output, "w", encoding="utf-8") as f:
        json.dump(prog, f, ensure_ascii=False, indent=2)
    print(f"OK: {len(prog['exercises'])} exercises, {len(prog['meta']['days'])} days -> {a.output}")


if __name__ == "__main__":
    main()
