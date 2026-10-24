#!/usr/bin/env python3
"""
validatortest.py - tests for the program-builder's two contracts: the rows.json
it reads and the program.json it emits.

apptest.js proves the app reads a good programme correctly. This proves the
builder refuses to emit a bad one, and still reads the rows files already on
disk. Both fixtures are exercised, and every case
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
import re
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "athlete", "skills", "program-builder",
                                "scripts"))
import rows_common  # noqa: E402
import validate_program  # noqa: E402
from build_program_json import build  # noqa: E402
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


# --- category: declared, guessed, or invented -------------------------------
# The app resolves an unrecognised category to no slot. It still renders, so this
# can never be an error - but `tendon` is the slot painAsked() reads, so prehab
# work named something invented loses its accented pain field silently.
_odd_cat = copy.deepcopy(base)
_odd_cat["exercises"][0]["category"] = "Grip work"
rep = validate(_odd_cat, "fixture")
check("an unrecognised category warns, not errors",
      not rep.errors and any("resolves to no slot" in w for w in rep.warnings))

for good in ("tendon", "Prehab", "warm up", "METCON"):
    _ok_cat = copy.deepcopy(base)
    for e in _ok_cat["exercises"]:
        e["category"] = good
    rep = validate(_ok_cat, "fixture")
    check(f"accepts category {good!r} in the app's own spelling rules",
          not any("resolves to no slot" in w for w in rep.warnings))

# Half-declared is the slip worth catching: the undeclared rows fall back to the
# name guess, so one day's rail mixes declared and inferred colours invisibly.
_half = copy.deepcopy(base)
_half["exercises"][0]["category"] = "strength"
rep = validate(_half, "fixture")
check("a partially categorised programme warns",
      not rep.errors and any("fall back to the name guess" in w
                             for w in rep.warnings))

_all_cat = copy.deepcopy(base)
for e in _all_cat["exercises"]:
    e["category"] = "strength"
rep = validate(_all_cat, "fixture")
check("a fully categorised programme says nothing about categories",
      not any("category" in w for w in rep.warnings))

# The shipped fixtures declare none on purpose - they exercise the app's guess
# path, which apptest.js asserts. That must read as one warning, not as noise.
rep = validate(base, "fixture")
check("a fixture declaring no category warns exactly once",
      sum("category" in w for w in rep.warnings) == 1)

# The validator's vocabulary is a second copy of index.html's CATS/CAT_ALIASES -
# they can't share code across the JS/Python boundary, so nothing stops them
# drifting apart except this check. Parse the app's tables out of the source
# rather than hand-copying them here, so a real edit to either side is what
# fails, not a paraphrase of one.
_html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
_cats_block = re.search(r"const CATS=\{(.*?)\};", _html, re.DOTALL)
_alias_block = re.search(r"const CAT_ALIASES=\{(.*?)\};", _html, re.DOTALL)
check("index.html still defines CATS and CAT_ALIASES",
      bool(_cats_block and _alias_block))
if _cats_block and _alias_block:
    js_slots = set(re.findall(r'key:"(\w+)"', _cats_block.group(1)))
    js_aliases = set()
    for m in re.finditer(r'(?:^|,)\s*(?:"([\w-]+)"|(\w+))\s*:',
                         _alias_block.group(1)):
        js_aliases.add(m.group(1) or m.group(2))
    js_vocab = js_slots | js_aliases
    py_vocab = validate_program.KNOWN_CATEGORIES
    check("validate_program's category vocabulary matches index.html's "
          "CATS/CAT_ALIASES",
          js_vocab == py_vocab,
          f"only in index.html: {sorted(js_vocab - py_vocab)}; "
          f"only in validate_program.py: {sorted(py_vocab - js_vocab)}")
    check("validate_program's CATEGORY_SLOTS matches index.html's CATS keys",
          js_slots == set(validate_program.CATEGORY_SLOTS),
          f"only in index.html: {sorted(js_slots - set(validate_program.CATEGORY_SLOTS))}; "
          f"only in validate_program.py: "
          f"{sorted(set(validate_program.CATEGORY_SLOTS) - js_slots)}")


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
    "category emitted as a number":
        lambda p: p["exercises"][0].__setitem__("category", 3),
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

# --- rows.json: the builder's INPUT contract --------------------------------
# Category was appended as column 14, never inserted, because every archived
# rows.json under a block's revisions/ is 13 wide and snapshot_revision.py exists
# so those stay rebuildable. Both widths must load, and a 13-wide row must emit
# no `category` key at all rather than an empty one.
_ROW13 = ["1", "Day 1 (Mon) - Strength", "Back squat", "4", "5", "100 kg",
          "7", "", "3 min", "", "Top load; RPE-1", "Brace hard", "opener"]


def _rows_file(rows):
    fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     encoding="utf-8")
    json.dump(rows, fh)
    fh.close()
    return fh.name


loaded = rows_common.load_rows(_rows_file([list(_ROW13)]))
check("a 13-field row still loads", len(loaded) == 1)
check("...and is padded with an empty Category",
      len(loaded[0]) == rows_common.N_COLS and loaded[0][rows_common.CATEGORY] == "")

loaded14 = rows_common.load_rows(_rows_file([_ROW13 + ["strength"]]))
check("a 14-field row loads with its Category",
      loaded14[0][rows_common.CATEGORY] == "strength")

prog = build(loaded, "B", "Test Athlete", 1, False)
check("a 13-wide row emits no 'category' key at all",
      "category" not in prog["exercises"][0])
prog = build(loaded14, "B", "Test Athlete", 1, False)
check("a 14-wide row carries its category into program.json",
      prog["exercises"][0].get("category") == "strength")

# 12 or 15 fields are still a hard error - the relaxation is exactly one column.
for n, label in ((12, "too few"), (15, "too many")):
    try:
        rows_common.load_rows(_rows_file([_ROW13[:n] if n < 13
                                          else _ROW13 + ["a", "b"]]))
        check(f"rejects a row with {n} fields ({label})", False, "loaded anyway")
    except SystemExit:
        check(f"rejects a row with {n} fields ({label})", True)

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
