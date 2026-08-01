#!/usr/bin/env python3
"""
build_xlsx.py - render a training programme into a colour-banded Excel workbook.

Input: a JSON file containing the programme rows, either as
  (a) {"rows": [[13 fields], ...]}  with fields in the exact column order, or
  (b) a bare list  [[13 fields], ...].

The 13 columns, in order, are fixed:
  Week | Day | Exercise | Sets | Reps | Load | Intensity (RPE) | Tempo | Rest |
  Completed | Completed Notes | Focus / Notes | Progression Rule

Each training day (parsed from the "Day" column, e.g. "Day 1 (Mon) - ...") gets its
own background fill band, with a medium top-border divider where the day changes.

Usage:
  python build_xlsx.py --input rows.json --output "Block - Week 1.xlsx" [--title "Week 1"]
"""
import argparse, json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

COLS = ["Week", "Day", "Exercise", "Sets", "Reps", "Load", "Intensity (RPE)",
        "Tempo", "Rest", "Completed", "Completed Notes", "Focus / Notes",
        "Progression Rule"]

# Day band palette (light fills); extends by cycling if a block has >6 days.
DAY_BANDS = ["DDEBF7", "E2EFDA", "FCE4D6", "EDE7F6", "FFF2CC", "E7E6E6"]
DAY_LABEL = ["1F4E79", "375623", "833C00", "4B2E83", "7F6000", "3B3838"]

WRAP_COLS = {"Load", "Completed Notes", "Focus / Notes", "Progression Rule"}
WIDTHS = {"Week": 6, "Day": 30, "Exercise": 26, "Sets": 9, "Reps": 22, "Load": 26,
          "Intensity (RPE)": 18, "Tempo": 9, "Rest": 14, "Completed": 11,
          "Completed Notes": 34, "Focus / Notes": 62, "Progression Rule": 58}


def load_rows(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    rows = data["rows"] if isinstance(data, dict) else data
    problems = []
    for i, r in enumerate(rows):
        if len(r) != 13:
            problems.append(f"row {i} has {len(r)} fields (need 13)")
            continue
        for j, cell in enumerate(r):
            s = "" if cell is None else str(cell)
            if "\t" in s or "\n" in s:
                problems.append(f"row {i} col '{COLS[j]}' contains a tab/newline")
    if problems:
        sys.exit("Input validation failed:\n  " + "\n  ".join(problems))
    return [["" if c is None else str(c) for c in r] for r in rows]


def day_index(day_label):
    """Return 0-based day index parsed from a label like 'Day 3 (Thu) - ...'."""
    try:
        return int(day_label.split()[1]) - 1
    except (IndexError, ValueError):
        return 0


def build(rows, out_path, title="Week 1"):
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]

    header_fill = PatternFill("solid", fgColor="1F4E5F")
    header_font = Font(name="Arial", bold=True, color="FFFFFF", size=10)
    base_font = Font(name="Arial", size=10)
    thin = Side(style="thin", color="BFBFBF")
    medium_top = Side(style="medium", color="808080")

    ws.append(COLS)
    for c in ws[1]:
        c.fill = header_fill
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for r in rows:
        ws.append(r)

    prev_key = None
    for ridx in range(2, ws.max_row + 1):
        day_val = ws.cell(ridx, 2).value or ""
        di = day_index(day_val)
        band = DAY_BANDS[di % len(DAY_BANDS)]
        label_color = DAY_LABEL[di % len(DAY_LABEL)]
        key = day_val.split(" - ")[0].split(")")[0]  # stable per-day key
        is_start = key != prev_key
        for cidx in range(1, 14):
            cell = ws.cell(ridx, cidx)
            header = COLS[cidx - 1]
            cell.font = base_font
            cell.fill = PatternFill("solid", fgColor=band)
            top = medium_top if is_start else thin
            cell.border = Border(left=thin, right=thin, top=top, bottom=thin)
            wrap = header in WRAP_COLS
            cell.alignment = Alignment(
                vertical="top", wrap_text=wrap,
                horizontal="left" if wrap or header in ("Day", "Exercise") else "center")
        ws.cell(ridx, 2).font = Font(name="Arial", size=10, bold=True, color=label_color)
        prev_key = key

    for name, w in WIDTHS.items():
        ws.column_dimensions[get_column_letter(COLS.index(name) + 1)].width = w
    ws.freeze_panes = "A2"
    ws.sheet_view.showGridLines = False

    wb.save(out_path)
    days = {}
    for r in rows:
        days[r[1].split(" - ")[0]] = days.get(r[1].split(" - ")[0], 0) + 1
    print(f"OK: {len(rows)} rows across {len(days)} day-blocks -> {out_path}")
    print("Rows per day: " + "; ".join(f"{k}={v}" for k, v in days.items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="JSON file of programme rows")
    ap.add_argument("--output", required=True, help="output .xlsx path")
    ap.add_argument("--title", default="Week 1", help="worksheet tab name")
    args = ap.parse_args()
    rows = load_rows(args.input)
    build(rows, args.output, args.title)


if __name__ == "__main__":
    main()
