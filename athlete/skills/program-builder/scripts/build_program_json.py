#!/usr/bin/env python3
"""
build_program_json.py - convert programme rows into program.json for the tracker PWA.

Reads the SAME rows.json used by build_xlsx.py (a list of 13-field rows, or
{"rows": [...]}), and emits a program.json with schema "tp-program-2". Loading,
validation, week numbers and day ordering all come from rows_common, so the two
scripts cannot drift apart in how they read the same file.

WEEKS ARE MATERIALISED (schema tp-program-2)
-------------------------------------------
rows.json must contain one row per exercise per day *per week*. The old
tp-program-1 shape carried Week 1 only and described later weeks as prose in the
Progression Rule, which meant the app showed Week 1 prescriptions no matter which
week the athlete selected. This script refuses to emit a programme that is
missing weeks, unless you pass --allow-partial-weeks.

The Progression Rule column survives, but it is now *rationale* ("why this week
differs"), not an instruction the athlete has to decode mid-session.

Usage:
  python3 build_program_json.py --input rows.json --output program.json \
    --block "Block name" --athlete "Display Name" --weeks 6
"""
import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rows_common import (DAY, die, day_order, day_slots, load_rows,  # noqa: E402
                         sort_rows, week_of)


def slugify(name):
    """Lowercase slug used for meta.athleteId and the athlete/<slug>/ folder."""
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")


def build(rows, block, athlete, weeks, allow_partial):
    athlete_id = slugify(athlete)
    if not athlete_id:
        die(f"--athlete {athlete!r} does not slugify to anything usable; it names "
            "the athlete/<slug>/ folder and is carried into every session export")

    order = day_order(rows)
    slot = day_slots(order)

    exercises, counters = [], {}
    for v in sort_rows(rows, order):
        week, day = week_of(v), v[DAY]
        counters[(week, day)] = counters.get((week, day), 0) + 1
        exercises.append({
            "id": f"w{week}d{slot[day]}e{counters[(week, day)]}",
            "week": week, "day": day, "name": v[2],
            "sets": v[3], "reps": v[4], "load": v[5], "rpe": v[6],
            "tempo": v[7], "rest": v[8],
            "logHint": v[10], "focus": v[11], "progression": v[12],
        })

    authored = sorted({e["week"] for e in exercises})
    extra = [w for w in authored if w > weeks]
    if extra:
        die(f"rows contain week(s) {extra} beyond --weeks {weeks}")
    missing = [w for w in range(1, weeks + 1) if w not in authored]
    if missing:
        msg = (f"rows.json is missing week(s) {missing} of {weeks}. Under tp-program-2 "
               "every week must be authored explicitly - the app renders the week the "
               "athlete selected and will show nothing for a missing week.")
        if not allow_partial:
            die(msg + "\n  Pass --allow-partial-weeks only if you really mean it.")
        print("WARNING: " + msg, file=sys.stderr)

    # Every day should appear in every authored week; a gap is nearly always an
    # authoring slip rather than an intentional rest week.
    for w in authored:
        gaps = [d for d in order
                if not any(e["week"] == w and e["day"] == d for e in exercises)]
        if gaps:
            print(f"WARNING: week {w} has no rows for: {'; '.join(gaps)}",
                  file=sys.stderr)

    return {
        "meta": {
            "block": block,
            "athlete": athlete,
            "athleteId": athlete_id,
            "weeks": weeks,
            "generated": datetime.date.today().isoformat(),
            "days": order,
            "schema": "tp-program-2",
        },
        "exercises": exercises,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--block", required=True)
    ap.add_argument("--athlete", required=True,
                    help="display name; slugified into meta.athleteId")
    ap.add_argument("--weeks", required=True,
                    help="length of the block; every week must have rows")
    ap.add_argument("--allow-partial-weeks", action="store_true",
                    help="emit even if some weeks have no rows (not recommended)")
    a = ap.parse_args()

    if not re.fullmatch(r"\s*\d+\s*", a.weeks) or int(a.weeks) < 1:
        die(f"--weeks must be a positive integer, got {a.weeks!r}")

    prog = build(load_rows(a.input), a.block, a.athlete, int(a.weeks),
                 a.allow_partial_weeks)
    with open(a.output, "w", encoding="utf-8") as f:
        json.dump(prog, f, ensure_ascii=False, indent=2)

    per_week = {}
    for e in prog["exercises"]:
        per_week[e["week"]] = per_week.get(e["week"], 0) + 1
    print(f"OK: {len(prog['exercises'])} exercises across {len(per_week)} authored "
          f"week(s) of {prog['meta']['weeks']} and {len(prog['meta']['days'])} days "
          f"-> {a.output}")
    print("Rows per week: " + "; ".join(f"W{k}={v}" for k, v in sorted(per_week.items())))


if __name__ == "__main__":
    main()
