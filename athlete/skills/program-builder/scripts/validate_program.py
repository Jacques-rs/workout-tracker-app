#!/usr/bin/env python3
"""
validate_program.py - check a program.json against the tp-program-* contract.

This validates the *emitted* file. rows_common.load_rows validates the builder's
*input* (rows.json), which is a different question: rows.json can be perfectly
well-formed and still produce a program.json the app mishandles - a day label
that drifts by one space between weeks, an id collision, a `weeks` count that
disagrees with the rows. Those only become visible once the file is assembled,
so they are checked here.

WHY THE STRICTNESS LIVES HERE AND NOT IN THE APP
------------------------------------------------
The app validates almost nothing on Import, deliberately: a slightly-off
programme must still open in a gym basement rather than hard-fail in front of an
athlete who came to train. That leniency is only safe if something upstream is
strict. This script is that something. It runs on the generator side, where a
failure costs a rebuild instead of a session.

ERRORS vs WARNINGS
------------------
ERROR   the app will visibly do the wrong thing - a missing required field, a
        wrong type, a day label the filter cannot match, duplicate ids. Exits
        non-zero; the builder refuses to write the file.
WARNING an honest programme can legitimately look like this, but it is usually
        an authoring slip - a week with no rows for a day, an empty load, no
        `category` anywhere. Printed, never fatal.

The contract itself (which fields are required, which side owns each) is
docs/data-contracts.md. Keep the two in step: if you add a rule here, say so
there, because the app is the other party to the contract.

Usage:
  python3 validate_program.py program.json [more.json ...]
  python3 validate_program.py --strict program.json   # warnings count as errors
"""
import argparse
import json
import re
import sys

# Required in every version. Values are the type the app relies on.
META_REQUIRED = {"block": str, "athlete": str, "weeks": int, "days": list,
                 "schema": str}
# v2 additionally requires athleteId - it names the athlete/<slug>/ folder that
# every exported session log gets filed into.
META_REQUIRED_V2 = {"athleteId": str}
# Optional, but typed when present. `version` is ignored by the app and used by
# review-workout-log to line a file up with its revisions/ snapshot.
META_OPTIONAL = {"version": int, "generated": str}

EX_REQUIRED = {"id": str, "day": str, "name": str}
EX_REQUIRED_V2 = {"week": int}
# Prose fields. All STRINGS, never numbers - they hold ranges like "8-10 min"
# and "~115-135 kg". A number here parses fine in Python and then renders as
# "115" in the gym, silently dropping the range.
EX_PROSE = ["sets", "reps", "load", "rpe", "tempo", "rest",
            "logHint", "focus", "progression"]

KNOWN_SCHEMAS = ("tp-program-1", "tp-program-2")

# The category vocabulary the app resolves, slots plus aliases. An unrecognised
# value still renders - it gets a derived colour and is shown verbatim - but it
# resolves to no slot, and `tendon` is the slot painAsked() reads to accent the
# pain field and nudge on Finish. So an invented word for prehab work silently
# switches that off. Contract owner: docs/data-contracts.md.
CATEGORY_SLOTS = ("warmup", "tendon", "skill", "strength", "cond", "accessory",
                  "cooldown")
CATEGORY_ALIASES = ("metcon", "conditioning", "aerobic", "cardio", "prehab",
                    "rehab", "isometric", "warm-up", "prep", "cool-down",
                    "mobility", "technique", "olympic", "lift", "main",
                    "auxiliary", "core")
KNOWN_CATEGORIES = set(CATEGORY_SLOTS) | set(CATEGORY_ALIASES)


def category_known(value):
    """Mirror the app's catOf() normalisation: case, spaces and underscores."""
    k = re.sub(r"[\s_]+", "-", str(value).strip().lower())
    return k in KNOWN_CATEGORIES or k.replace("-", "") in KNOWN_CATEGORIES


class Report:
    """Collected problems for one file. Errors block; warnings inform."""

    def __init__(self, path):
        self.path = path
        self.errors = []
        self.warnings = []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def ok(self, strict=False):
        return not self.errors and not (strict and self.warnings)

    def render(self, out=sys.stderr):
        for m in self.errors:
            print(f"ERROR   {self.path}: {m}", file=out)
        for m in self.warnings:
            print(f"WARNING {self.path}: {m}", file=out)


def _typed(rep, where, obj, spec, required):
    """Check presence and type of each field in `spec` on `obj`."""
    for key, want in spec.items():
        if key not in obj:
            if required:
                rep.error(f"{where}: missing required field '{key}'")
            continue
        val = obj[key]
        # bool is a subclass of int; weeks=True must not pass as a week count.
        if want is int and (isinstance(val, bool) or not isinstance(val, int)):
            rep.error(f"{where}: '{key}' must be a whole number, got {val!r}")
        elif want is not int and not isinstance(val, want):
            rep.error(f"{where}: '{key}' must be {want.__name__}, got {val!r}")


def validate(prog, path="program.json", allow_partial_weeks=False):
    """Validate a parsed programme dict. Returns a Report.

    `allow_partial_weeks` mirrors the builder flag of the same name: it
    downgrades "week N has no exercises" from an error to a warning, so a
    deliberately partial programme can still be emitted. Nothing else relaxes.
    """
    rep = Report(path)

    if not isinstance(prog, dict):
        rep.error("top level must be an object")
        return rep
    meta = prog.get("meta")
    exercises = prog.get("exercises")
    # These two are the only things the app itself checks, so they are the
    # difference between "opens with problems" and "Import shows an error".
    if not isinstance(meta, dict):
        rep.error("'meta' is missing or not an object")
    if not isinstance(exercises, list):
        rep.error("'exercises' is missing or not an array")
    if rep.errors:
        return rep

    schema = meta.get("schema")
    if schema not in KNOWN_SCHEMAS:
        rep.error(f"meta.schema is {schema!r}; expected one of "
                  f"{', '.join(KNOWN_SCHEMAS)}. Every reader must know the "
                  "version - it is never inferred from which fields are present")
        return rep
    v2 = schema == "tp-program-2"

    _typed(rep, "meta", meta, META_REQUIRED, required=True)
    if v2:
        _typed(rep, "meta", meta, META_REQUIRED_V2, required=True)
    _typed(rep, "meta", meta, META_OPTIONAL, required=False)

    if isinstance(meta.get("weeks"), int) and not isinstance(meta.get("weeks"), bool):
        if meta["weeks"] < 1:
            rep.error(f"meta.weeks is {meta['weeks']}; weeks are numbered from 1")
    if isinstance(meta.get("version"), int) and not isinstance(meta.get("version"), bool):
        if meta["version"] < 1:
            rep.error(f"meta.version is {meta['version']}; revisions start at 1")

    days = meta.get("days")
    if isinstance(days, list):
        _check_days(rep, days, meta, v2)
    if not exercises:
        rep.error("'exercises' is empty; the programme has nothing to show")
        return rep

    _check_exercises(rep, exercises, days if isinstance(days, list) else [], v2)
    if v2:
        _check_week_coverage(rep, exercises, meta, days, allow_partial_weeks)
    else:
        rep.warn("schema is tp-program-1: the app will ignore exercises[].week "
                 "and show the same rows in every week, with the 'apply your "
                 "progression rule' banner. Rebuild as tp-program-2 unless this "
                 "is an archived file")
    return rep


def _check_days(rep, days, meta, v2):
    """meta.days drives the day selector; order and exact strings both matter."""
    if not days:
        rep.error("meta.days is empty; the app has no day selector to render")
    for d in days:
        if not isinstance(d, str):
            rep.error(f"meta.days contains a non-string entry: {d!r}")
        elif not d.strip():
            rep.error("meta.days contains an empty label")
        elif d != d.strip():
            # The app filters exercises by string equality against these labels,
            # so a stray edge space makes a day render empty rather than error.
            rep.error(f"meta.days label has leading/trailing whitespace: {d!r}")
    if len(set(days)) != len(days):
        dupes = sorted({d for d in days if days.count(d) > 1})
        rep.error(f"meta.days has duplicate labels: {dupes}. The day selector "
                  "would show the same day twice")
    for d in days:
        if isinstance(d, str) and d.strip() and not re.match(r"\s*Day\s+\d+", d):
            rep.warn(f"day label does not start with 'Day <N>': {d!r}. The "
                     "prefix is parsed for the day index (ids, colour bands)")
    if v2 and isinstance(meta.get("athleteId"), str):
        aid = meta["athleteId"]
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", aid or ""):
            rep.error(f"meta.athleteId is {aid!r}; must be a lowercase slug "
                      "(a-z, 0-9, hyphens) - it names the athlete/<slug>/ folder")


def _check_exercises(rep, exercises, days, v2):
    day_set = set(days)
    seen_ids = {}
    for i, e in enumerate(exercises):
        where = f"exercises[{i}]"
        if not isinstance(e, dict):
            rep.error(f"{where}: not an object")
            continue
        label = e.get("name") or "unnamed"
        where = f"exercises[{i}] ({label})"

        _typed(rep, where, e, EX_REQUIRED, required=True)
        if v2:
            _typed(rep, where, e, EX_REQUIRED_V2, required=True)

        eid = e.get("id")
        if isinstance(eid, str):
            if not eid.strip():
                rep.error(f"{where}: 'id' is empty; it is the key logged data "
                          "is stored under in localStorage")
            elif eid in seen_ids:
                # Two exercises sharing an id means one overwrites the other's
                # logged sets - silently, and only once the athlete is training.
                rep.error(f"{where}: duplicate id {eid!r}, also used by "
                          f"exercises[{seen_ids[eid]}]")
            else:
                seen_ids[eid] = i

        if isinstance(e.get("name"), str) and not e["name"].strip():
            rep.error(f"{where}: 'name' is empty")

        day = e.get("day")
        if isinstance(day, str) and day_set and day not in day_set:
            rep.error(f"{where}: day {day!r} is not in meta.days. The app "
                      "filters by exact string match, so this exercise would "
                      "never render")

        wk = e.get("week")
        if v2 and isinstance(wk, int) and not isinstance(wk, bool) and wk < 1:
            rep.error(f"{where}: week is {wk}; weeks are numbered from 1")

        for key in EX_PROSE:
            if key in e and not isinstance(e[key], str):
                rep.error(f"{where}: '{key}' must be a string, got {e[key]!r}. "
                          "Prescriptions hold ranges and prose; a number here "
                          "loses the range")
        if not str(e.get("load", "")).strip() and not str(e.get("reps", "")).strip():
            rep.warn(f"{where}: neither 'load' nor 'reps' is set")

        cat = e.get("category")
        if "category" in e and not isinstance(cat, str):
            rep.error(f"{where}: 'category' must be a string, got {cat!r}")
        elif isinstance(cat, str) and cat.strip() and not category_known(cat):
            rep.warn(f"{where}: category {cat.strip()!r} is not one of "
                     f"{', '.join(CATEGORY_SLOTS)} (or their aliases). It will "
                     "render, but it resolves to no slot - so prehab/tendon work "
                     "named this way loses the accented pain field and the "
                     "Finish nudge")

        sets_val = e.get("sets")
        if isinstance(sets_val, str) and sets_val.strip() and not re.search(r"\d", sets_val):
            # The tracker logs one set at a time and reads `sets` to decide how many
            # chips to pre-materialise. A plain integer or a plain numeric range gets
            # that count; anything else - including this - collapses to a single
            # "Set 1 of 1", which is correct for AMRAP/interval work but usually an
            # authoring slip for an ordinary lift.
            rep.warn(f"{where}: 'sets' is {sets_val!r} with no digit in it; the "
                     "set-at-a-time logger will show a single set for it. Fine for "
                     "AMRAP/interval work, an authoring slip otherwise")

    if not any(str(e.get("logHint", "")).strip()
               for e in exercises if isinstance(e, dict)):
        rep.warn("no exercise has a 'logHint'; the blue 'Log:' line is what "
                 "tells the athlete which data the coach actually needs")
    rows = [e for e in exercises if isinstance(e, dict)]
    declared = [e for e in rows if str(e.get("category", "")).strip()]
    if not declared:
        rep.warn("no exercise declares 'category'; the app will guess from the "
                 "exercise name and leave the rail neutral where it cannot. "
                 "Harmless, but declaring it beats inferring it")
    elif len(declared) != len(rows):
        # Half-declared is worse than none: the undeclared rows fall back to the
        # keyword guess, so one day's rail mixes declared and inferred colours
        # and the reason is invisible in the file.
        rep.warn(f"{len(declared)} of {len(rows)} exercises declare 'category'; "
                 "the rest fall back to the name guess. Declare it on all of "
                 "them or none")


def _check_week_coverage(rep, exercises, meta, days, allow_partial=False):
    """v2 materialises every week. A missing week renders as an empty day."""
    weeks = meta.get("weeks")
    if not isinstance(weeks, int) or isinstance(weeks, bool) or weeks < 1:
        return
    authored = sorted({e["week"] for e in exercises
                       if isinstance(e, dict) and isinstance(e.get("week"), int)
                       and not isinstance(e.get("week"), bool)})
    missing = [w for w in range(1, weeks + 1) if w not in authored]
    if missing:
        msg = (f"week(s) {missing} of {weeks} have no exercises. Under "
               "tp-program-2 the app renders the selected week and would "
               "show an empty day. Rebuild with those weeks authored, or "
               "lower meta.weeks")
        (rep.warn if allow_partial else rep.error)(msg)
    extra = [w for w in authored if w > weeks]
    if extra:
        rep.error(f"exercises reference week(s) {extra} beyond meta.weeks "
                  f"{weeks}; the week selector only goes to {weeks}, so those "
                  "rows are unreachable")
    for w in authored:
        if w > weeks:
            continue
        gaps = [d for d in (days or [])
                if not any(e.get("week") == w and e.get("day") == d
                           for e in exercises if isinstance(e, dict))]
        if gaps:
            rep.warn(f"week {w} has no rows for: {'; '.join(gaps)}")


def validate_file(path, allow_partial_weeks=False):
    rep = Report(path)
    try:
        with open(path, encoding="utf-8") as f:
            prog = json.load(f)
    except FileNotFoundError:
        rep.error("no such file")
        return rep
    except json.JSONDecodeError as e:
        rep.error(f"not valid JSON: {e}")
        return rep
    return validate(prog, path, allow_partial_weeks)


def main():
    ap = argparse.ArgumentParser(
        description="Validate program.json against the tp-program-* contract.")
    ap.add_argument("files", nargs="+", help="program.json file(s) to check")
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as failures too")
    ap.add_argument("--allow-partial-weeks", action="store_true",
                    help="a week with no exercises warns instead of failing")
    a = ap.parse_args()

    failed = False
    for path in a.files:
        rep = validate_file(path, a.allow_partial_weeks)
        rep.render()
        if rep.ok(a.strict):
            n = len(rep.warnings)
            print(f"OK: {path}" + (f" ({n} warning(s))" if n else ""))
        else:
            failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
