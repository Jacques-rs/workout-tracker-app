#!/usr/bin/env python3
"""
rows_common.py - shared loading and validation for the two programme builders.

build_xlsx.py and build_program_json.py read the SAME rows.json and must agree
about it exactly: same rejected input, same week numbers, same day ordering. When
they disagreed, the workbook and program.json silently described different
programmes - a wrong prescription reaching the gym. Everything both scripts need
to interpret a row lives here so there is one rule, not two.

The 13 columns, in order:
  Week | Day | Exercise | Sets | Reps | Load | Intensity (RPE) | Tempo | Rest |
  Completed | Completed Notes | Focus / Notes | Progression Rule
"""
import json
import re
import sys

COLS = ["Week", "Day", "Exercise", "Sets", "Reps", "Load", "Intensity (RPE)",
        "Tempo", "Rest", "Completed", "Completed Notes", "Focus / Notes",
        "Progression Rule"]
N_COLS = len(COLS)

WEEK, DAY, EXERCISE = 0, 1, 2


def die(msg):
    sys.exit("error: " + msg)


def load_rows(path):
    """Read rows.json, validate it, and return rows as lists of 13 strings.

    Rejects: wrong column count, tabs/newlines in any cell (they break both the
    spreadsheet and the app's single-line layout), a missing or non-positive-
    integer Week, and an empty Day or Exercise.
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        die(f"no such input file: {path}")
    except json.JSONDecodeError as e:
        die(f"{path} is not valid JSON: {e}")

    rows = data.get("rows") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        die(f"{path} must be a list of rows, or an object with a 'rows' list")
    if not rows:
        die(f"{path} contains no rows")

    out, problems = [], []
    for i, r in enumerate(rows):
        if not isinstance(r, list) or len(r) != N_COLS:
            n = len(r) if isinstance(r, list) else "not a list"
            problems.append(f"row {i}: has {n} fields (need {N_COLS})")
            continue
        cells = ["" if c is None else str(c) for c in r]
        for j, s in enumerate(cells):
            if "\t" in s or "\n" in s:
                problems.append(f"row {i}: col '{COLS[j]}' contains a tab/newline "
                                "(use ';' or '|' inside notes)")
        if not re.fullmatch(r"\s*\d+\s*", cells[WEEK]):
            problems.append(f"row {i} ({cells[EXERCISE] or 'unnamed'}): Week is "
                            f"{cells[WEEK]!r}, must be a plain integer like '3'")
        elif int(cells[WEEK]) < 1:
            problems.append(f"row {i} ({cells[EXERCISE] or 'unnamed'}): Week is "
                            f"{cells[WEEK]!r}, weeks are numbered from 1")
        if not cells[DAY].strip():
            problems.append(f"row {i}: Day is empty")
        if not cells[EXERCISE].strip():
            problems.append(f"row {i}: Exercise is empty")
        out.append(cells)

    if problems:
        die(f"{path} failed validation:\n  " + "\n  ".join(problems))
    return out


def week_of(row):
    """Week number for a row. Safe because load_rows already validated it."""
    return int(row[WEEK].strip())


def day_number(label):
    """1-based ordinal parsed from 'Day 3 (Thu) - ...', or None if absent."""
    m = re.match(r"\s*Day\s+(\d+)", label or "")
    return int(m.group(1)) if m else None


def day_order(rows):
    """Ordered list of distinct day labels.

    Sorted by the 'Day N' prefix where present, else by first appearance. Both
    scripts use this list, so the workbook's row order, its colour bands and the
    exercise ids in program.json all agree.
    """
    seen = []
    for r in rows:
        if r[DAY] not in seen:
            seen.append(r[DAY])
    return sorted(seen, key=lambda d: (day_number(d) is None,
                                       day_number(d) or 0,
                                       seen.index(d)))


def day_slots(order):
    """{day label: 1-based slot} used for BOTH the exercise id and the colour band.

    Prefers the number in the label, so 'Day 3 (Thu) - ...' is slot 3: the id
    reads w2d3e1 and the workbook bands it with the third colour, matching how
    the athlete refers to the day. Falls back to position for the whole set if
    the labels don't yield distinct numbers, so ids stay unique either way.
    """
    labelled = {d: day_number(d) for d in order}
    nums = list(labelled.values())
    if all(n is not None for n in nums) and len(set(nums)) == len(nums):
        return labelled
    return {d: i + 1 for i, d in enumerate(order)}


def sort_rows(rows, order):
    """Rows in programme order: week, then day, then original order within a day."""
    pos = {d: i for i, d in enumerate(order)}
    return [r for _, r in sorted(enumerate(rows),
                                 key=lambda p: (week_of(p[1]), pos[p[1][DAY]], p[0]))]
