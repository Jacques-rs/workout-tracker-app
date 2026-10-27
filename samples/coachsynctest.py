#!/usr/bin/env python3
"""
coachsynctest.py - the coach sync script's revision guard and its mirrors of the app.

The guard is the only thing between a coach's edit and a phone mid-block, so every
refusal below is a way a revision would silently misfile logged sets or rewrite a
trained day. supabase/tests/coach/coach_sync_flow.test.py proves the same script
against the local stack.

Run from the repo root:
  python3 samples/coachsynctest.py
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "athlete", "skills", "program-builder", "scripts"))
from coach_sync import program_key, revision_problems, session_filename, slug  # noqa: E402

failures = []
run = 0


def check(name, condition, detail=""):
    global run
    run += 1
    print(f"{'ok  ' if condition else 'FAIL'}  {name}"
          + (f"  -- {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


with open(os.path.join(ROOT, "samples", "program.v2.sample.json"), encoding="utf-8") as f:
    base = json.load(f)
DAY1 = base["meta"]["days"][0]


def revised(edit=None, **meta):
    prog = copy.deepcopy(base)
    prog["meta"].update({"version": base["meta"]["version"] + 1,
                         "changeNote": "W3 squat held", "reviewedThrough": "2026-01-21"})
    prog["meta"].update(meta)
    if edit:
        edit(prog)
    return prog


def rows(prog, week, day):
    return [e for e in prog["exercises"] if e["week"] == week and e["day"] == day]


# --- Mirrors: the app and the script must agree, or a revision becomes a new block
check("slug matches the app's", slug("  Hybrid Block — 1!") == "hybrid-block-1")
check("slug truncates at 40 like the app", len(slug("x" * 60)) == 40)
check("programKey is block|athlete|weeks|days",
      program_key(base) == "sample-block-dev-fixture-only|fixture-slug|4|2")
check("a version bump keeps the programKey", program_key(revised()) == program_key(base))
check("session filenames match the app's export",
      session_filename({"date": "2026-01-12", "day": DAY1})
      == "session-2026-01-12-day-1-mon-clean-skill-front-squat-knee-c.json")

# --- Allowed ----------------------------------------------------------------
logged = {(1, DAY1)}
check("an unchanged revision with a note passes", not revision_problems(base, revised(), logged))


def edit_load(prog):
    rows(prog, 3, DAY1)[0]["load"] = "held at W2 load"


check("a load edit in a week not yet trained passes",
      not revision_problems(base, revised(edit_load), logged))


def swap(prog):
    rows(prog, 3, DAY1)[0]["name"] = "Box squat"


check("substituting an exercise in place passes",
      not revision_problems(base, revised(swap), logged))

# --- Refused ----------------------------------------------------------------


def trained_edit(prog):
    rows(prog, 1, DAY1)[0]["load"] = "rewritten"


def reorder(prog):
    day = rows(prog, 3, DAY1)
    day[0]["name"], day[1]["name"] = day[1]["name"], day[0]["name"]


def insert_mid_day(prog):
    day = rows(prog, 3, DAY1)
    for i in range(len(day) - 1, 0, -1):
        day[i]["name"] = day[i - 1]["name"]
    day[0]["name"] = "New opener"


CASES = {
    "an edit to a week that already has a logged session":
        (revised(trained_edit), "already has a logged session"),
    "a reorder within a day": (revised(reorder), "moved from"),
    "an insert that shifts the rest of the day down": (revised(insert_mid_day), "moved from"),
    "skipping a version": (revised(version=base["meta"]["version"] + 2), "must be v"),
    "re-publishing the same version": (revised(version=base["meta"]["version"]), "must be v"),
    "no changeNote": (revised(changeNote=""), "changeNote is missing"),
    "no reviewedThrough": (revised(reviewedThrough=None), "reviewedThrough is missing"),
    "a renamed block": (revised(block="Another block"), "meta.block changed"),
    "a different week count": (revised(weeks=5), "meta.weeks changed"),
    "a renamed day label": (revised(days=["Day 1 (Tue) - x", base["meta"]["days"][1]]),
                            "meta.days changed"),
}
for name, (prog, expect) in CASES.items():
    problems = revision_problems(base, prog, logged)
    check(f"refuses: {name}", any(expect in p for p in problems),
          "; ".join(problems) or "no problem raised")

print()
if failures:
    print(f"{len(failures)} FAILED: " + "; ".join(failures))
    sys.exit(1)
print(f"all {run} checks passed ({len(CASES)} refusal cases)")
