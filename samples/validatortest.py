#!/usr/bin/env python3
"""
validatortest.py - tests for the tp-program-* contract validator.

apptest.js proves the app reads a good programme correctly. This proves the
builder refuses to emit a bad one. Both fixtures are exercised, and every case
below is a real failure mode that reached the app at some point or would have.

The negative cases matter more than the positive ones: a validator that passes
everything is worse than none, because it buys false confidence. Each case
mutates a known-good fixture in one way and asserts the validator objects.

Run from the repo root:
  python3 samples/validatortest.py
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "athlete", "skills", "program-builder",
                                "scripts"))
from validate_program import validate, validate_file  # noqa: E402

failures = []
run = 0


def check(name, condition, detail=""):
    global run
    run += 1
    print(f"{'ok  ' if condition else 'FAIL'}  {name}"
          + (f"  -- {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


# --- Positive: the shipped fixtures and the bundled sample must all pass ----
# If one of these starts failing, either the fixture drifted or the validator
# got too strict. Both are worth stopping for.
for rel in ("samples/program.sample.json", "samples/program.v2.sample.json",
            "program.json"):
    rep = validate_file(os.path.join(ROOT, rel))
    check(f"passes: {rel}", not rep.errors,
          rep.errors[0] if rep.errors else "")

# v1 is valid but should say so loudly - it is the schema that caused the
# wrong-week bug, so a silent pass would be misleading.
rep = validate_file(os.path.join(ROOT, "samples/program.sample.json"))
check("v1 fixture warns about tp-program-1",
      any("tp-program-1" in w for w in rep.warnings))

base = load("samples/program.v2.sample.json")

# A `sets` value with no digit in it collapses to a single "Set 1 of 1" in the
# tracker's set-at-a-time logger - fine for AMRAP, usually a slip otherwise.
# Must warn, never error: "AMRAP" is legitimate and must still open in the gym.
_no_digit = copy.deepcopy(base)
_no_digit["exercises"][0]["sets"] = "AMRAP"
rep = validate(_no_digit, "fixture")
check("a 'sets' value with no digit warns, not errors",
      not rep.errors and any("no digit" in w for w in rep.warnings))


def mutated(fn):
    p = copy.deepcopy(base)
    fn(p)
    return p


# --- Negative: one mutation each, all must be ERRORS not warnings -----------
CASES = {
    # Two exercises sharing an id means one silently overwrites the other's
    # logged sets in localStorage - and only while the athlete is training.
    "duplicate exercise id":
        lambda p: p["exercises"][1].__setitem__("id", p["exercises"][0]["id"]),
    # The app filters by exact string match, so an unmatched day never renders.
    "day not present in meta.days":
        lambda p: p["exercises"][0].__setitem__("day", "Day 9 (Sun) - Ghost"),
    "day label with trailing whitespace":
        lambda p: p["meta"]["days"].__setitem__(0, p["meta"]["days"][0] + " "),
    "duplicate day labels":
        lambda p: p["meta"]["days"].__setitem__(1, p["meta"]["days"][0]),
    # A number here parses fine and then renders as "100", dropping the range.
    "load emitted as a number":
        lambda p: p["exercises"][0].__setitem__("load", 100),
    "reps emitted as a number":
        lambda p: p["exercises"][0].__setitem__("reps", 5),
    # The bug tp-program-2 exists to prevent: selecting a week with no rows.
    "a week has no exercises":
        lambda p: p.__setitem__("exercises",
                                [e for e in p["exercises"] if e["week"] != 2]),
    "exercise week beyond meta.weeks":
        lambda p: p["exercises"][0].__setitem__("week", 99),
    "meta.weeks below 1":
        lambda p: p["meta"].__setitem__("weeks", 0),
    "meta.weeks as a string":
        lambda p: p["meta"].__setitem__("weeks", "6"),
    # athleteId names the athlete/<slug>/logs/ folder every export is filed in.
    "missing meta.athleteId in v2":
        lambda p: p["meta"].pop("athleteId"),
    "meta.athleteId not a slug":
        lambda p: p["meta"].__setitem__("athleteId", "Jacques R"),
    "meta.version below 1":
        lambda p: p["meta"].__setitem__("version", 0),
    "unknown schema":
        lambda p: p["meta"].__setitem__("schema", "tp-program-9"),
    "missing meta.schema":
        lambda p: p["meta"].pop("schema"),
    "missing meta.days":
        lambda p: p["meta"].pop("days"),
    "empty meta.days":
        lambda p: p["meta"].__setitem__("days", []),
    "empty exercise name":
        lambda p: p["exercises"][0].__setitem__("name", ""),
    "missing exercise id":
        lambda p: p["exercises"][0].pop("id"),
    "missing exercise week in v2":
        lambda p: p["exercises"][0].pop("week"),
    "exercises not an array":
        lambda p: p.__setitem__("exercises", {}),
    "exercises empty":
        lambda p: p.__setitem__("exercises", []),
    "meta missing entirely":
        lambda p: p.pop("meta"),
}

for name, fn in CASES.items():
    rep = validate(mutated(fn), "fixture")
    check(f"rejects: {name}", bool(rep.errors), "no error raised")

# --- The one documented escape hatch ---------------------------------------
# --allow-partial-weeks must still let a deliberately partial build through,
# or the flag is a lie. Nothing else relaxes with it.
partial = mutated(CASES["a week has no exercises"])
rep = validate(partial, "fixture", allow_partial_weeks=True)
check("allow_partial_weeks downgrades the missing-week error", not rep.errors)
check("allow_partial_weeks still warns about it", bool(rep.warnings))
rep = validate(mutated(CASES["duplicate exercise id"]), "fixture",
               allow_partial_weeks=True)
check("allow_partial_weeks does not relax anything else", bool(rep.errors))

# --- Bad input to the validator itself --------------------------------------
check("rejects a non-object top level", bool(validate([], "fixture").errors))
check("rejects a missing file",
      bool(validate_file(os.path.join(ROOT, "no-such-file.json")).errors))

print()
if failures:
    print(f"{len(failures)} FAILED: " + "; ".join(failures))
    sys.exit(1)
# Counted by check() rather than derived from len(CASES) + a hand-kept constant,
# which drifted the moment a case was added.
print(f"all {run} checks passed ({len(CASES)} rejection cases)")
