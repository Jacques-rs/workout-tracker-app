---
name: program-builder
description: Use when the user asks to GENERATE, build, or write an actual training programme from an approved Program Planning Doc. Reads the approved plan plus that athlete's profile doc and any coaching sources, applies an evidence-informed coaching framework, and outputs three things — a "Programme Architecture & Phase Map" (Markdown), a colour-banded Excel workbook with one tab per week (.xlsx), and program.json for the tracker app. Authors every week of the block explicitly. Does not produce a TSV. Requires an approved plan first (from the program-planner skill). Triggers on "generate the programme", "build the block", "write the programme now", "turn the plan into the programme".
---

# Program Builder

Consumes an **approved Program Planning Doc** and writes the actual programme: a Markdown phase map, a colour-banded Excel workbook with one tab per week, and `program.json` for the tracker app. All programme-level decisions should already be settled in the plan — this skill executes them into exercises, sets, reps, loads, and weekly progressions, authoring **every** week of the block explicitly.

## Prerequisite
An approved planning doc must exist (produced by `program-planner`). If you cannot find one, ask the user to point to it or to run `program-planner` first. Do not invent the plan.

## Which athlete

Everything lives under `athlete/<slug>/` — `personal-profile.md`, `plans/`, `programs/`,
`logs/`. Establish the athlete **before reading anything**: use the one named in the request,
or the one whose planning doc you were pointed at. If more than one folder exists under
`athlete/` and the request is ambiguous, ask — do not guess, and never read one athlete's
profile while building another's programme.

Write all outputs to that athlete's `programs/` folder and pass their display name to
`--athlete`. The skill itself stays general: injury rules, pain-monitoring protocols and
readiness hard stops come from the profile and plan you are reading, never from memory of a
previous athlete. See `athlete/README.md`.

## When NOT to use
- No plan yet, or the plan is unapproved / still has open questions → use `program-planner`.
- The user only wants a small in-place edit to an existing programme → make the edit directly.

## Process

1. **Read the inputs.** The approved planning doc (authoritative for all decisions), `athlete/<slug>/personal-profile.md`, any coaching source material (`athlete/sources/`), and the previous programme's notes/feedback if present.
2. **Apply the coaching framework** (see "Programming rules" below) to turn the plan into concrete training.
3. **Author every week of the block in full** — one row per exercise per day *per week*. See "Authoring all weeks" below; this is a hard requirement, not an option.
4. **Produce the deliverables** (see "Outputs"). No TSV.
5. **Verify** against the checklist, then present the files with a concise summary and the review trigger.

## Authoring all weeks (do not shortcut this)

Write Week 1 through Week N as real rows in `rows.json`. Week 4 gets its own rows with its
own exercises, loads, reps and RPE — not a Week 1 row plus a sentence saying what to change.

**Why this is a hard rule.** The tracker app renders the week the athlete selected. When only
Week 1 existed, the app showed Week 1 prescriptions in every week and the athlete had to
decode a progression string mid-session. That directly caused load and RPE drift — the app
showed front squats in a week that called for low-bar. Progressions are coaching judgement;
they belong in your output, not in the athlete's head under a loaded barbell.

`build_program_json.py` **refuses** to emit a programme with missing weeks. If it errors,
author the missing weeks — do not reach for `--allow-partial-weeks`.

**The Progression Rule column survives, but its meaning changes.** It is now *rationale*:
why this week differs from the last, plus the hold/stop gate that would make you deviate
("hold load if pain >5/10 or next-morning stiffness"). It is no longer an instruction the
athlete executes. Write it in the past/declarative voice ("volume up one set; load held
because W2 RPE ran high"), not the imperative ("W4: add 2.5 kg").

Practical approach: design Week 1 properly, then walk the phase map week by week and write
each week's rows, changing **one variable per microcycle** as the programming rules require.
Deload weeks are authored like any other week, with their actual reduced prescription.

## Programming rules (apply every time)

- **Priority order:** safety / medical escalation → long-term continuity → symptoms & recovery → the block's primary adaptation → secondary qualities → session quality & adherence → novelty.
- **Smallest effective change**; never redesign a whole block for a minor disruption.
- **Match function, not muscle group.** Substitute on the key quality (max strength, hypertrophy, power, skill, tendon capacity, joint tolerance, loaded capacity, aerobic support, repeat-effort conditioning, technical practice, positional strength, fatigue tolerance) — not just "same body part".
- **Concurrent training:** separate highly-fatiguing lower-body strength from intense conditioning by ≥24h; if combined in one session, strength before conditioning; prefer low-impact modalities (bike, row, sled) to build the aerobic base during strength phases.
- **Power is trained fresh:** Olympic derivatives / jumps early in the session; terminate the set the moment bar speed or quality drops.
- **Distribute high-central-fatigue exposures:** no more than 2–3 per week (heavy deadlifts, near-max efforts, highly lactic mixed-modal pieces).
- **Progress ONE variable per microcycle** (load OR volume OR density OR complexity — never several at once). Density before load in conditioning.
- **Tendon / tissue loading** (when relevant): honour the pain-monitoring model from the plan — pain ≤5/10 during and after, back to baseline by next morning, no week-on-week upward trend; regress to isometrics/heavy-slow when symptoms rise; progress to energy-storage work only when tolerated with no next-morning stiffness. Recommend medical assessment for red-flag symptoms.
- **Autoregulation:** use RPE-1 to set top-set loads; convert the athlete's readiness/overreaching history into explicit hard stops (e.g. consecutive below-baseline readiness → cap top sets and cut conditioning volume; illness signs → easy aerobic or rest).
- **Loading/deload rhythm comes from the plan**, not a default 3+1.
- **Footprint:** honour the environment constraint — build conditioning that uses one station, or at most two, when in a shared commercial gym.

## Outputs (three files, no TSV)

### 1. `<Block name> - Architecture & Phase Map.md`
Sections in this order:
1. **Decision Summary** — active goal, block phase, constraints, key trade-offs, assumptions.
2. **Programme Architecture and Phase Map** — a week-by-week table (label + purpose + what progresses + what stays stable + expected fatigue + review trigger), session roles, progression/regression logic across load/reps/RPE/volume/density/conditioning/technique, and a justified loading & deload structure.
3. **Progression and Monitoring Rules** — tissue/pain rules, readiness hard stops, strength/power/conditioning rules, and what to log.
4. **Review Trigger** — exactly what data is needed before the next material decision.

### 2. `<Block name> - Programme.xlsx`
Build it with `scripts/build_xlsx.py` so formatting is identical every time. The workbook
gets **one tab per week** ("Week 1", "Week 2", …), split automatically from the Week column.

**Columns — exactly these 13, in this order:**
`Week | Day | Exercise | Sets | Reps | Load | Intensity (RPE) | Tempo | Rest | Completed | Completed Notes | Focus / Notes | Progression Rule`

**Row rules:**
- One row per exercise per day **per week**. Every row states its own week in column 1.
- Day label format: `Day N (Weekday) - Theme`, identical across weeks so the app's day
  filter and the workbook's colour bands line up.
- Leave **Completed** blank.
- Populate **Completed Notes** only for important lifts, conditioning, and recovery-sensitive work — with the specific data that will guide later decisions (actual load, reps, RPE-1, pain during + next morning, technical quality, HR/erg response, or reason for modification). Warm-ups/mobility can be blank.
- **Focus / Notes** carries coaching cues + any footprint note. **Progression Rule** carries the *rationale* for this week's prescription plus the hold/stop gate — not instructions for future weeks, which are now authored as their own rows.
- **No tabs or line breaks inside any cell.** Use `;` or `|` inside notes.
- Every row must align with the phase map and include a clear progression or hold/stop rule.

**Formatting (handled by the script):** Arial 10; dark header row (white, bold, wrapped, frozen at A2); each training day gets its own fill band with a medium top-border divider where the day changes; wrapped text on Load / Completed Notes / Focus-Notes / Progression Rule; gridlines off; sensible column widths. Day band palette: Day 1 blue `DDEBF7`, Day 2 green `E2EFDA`, Day 3 peach `FCE4D6`, Day 4 lilac `EDE7F6`, Day 5 yellow `FFF2CC`, Day 6 grey `E7E6E6` (the script extends automatically).

**How to run the script:** write **all** rows, every week, to a working JSON file
(`athlete/<slug>/programs/rows.json` — internal, not a deliverable) as a list of 13-item
lists in column order. Both scripts take absolute or relative paths; run them from wherever
is convenient and point `--input` at that file:
```
python3 <skills>/program-builder/scripts/build_xlsx.py \
  --input  athlete/<slug>/programs/rows.json \
  --output "athlete/<slug>/programs/<Block name> - Programme.xlsx"
```
`--title` is an optional **tab prefix** (default `Week`); the week number is appended.

Both scripts share `scripts/rows_common.py`, so they validate `rows.json` identically and
order rows identically — the workbook and `program.json` cannot describe different
programmes. Rejected outright: wrong column count, tabs or newlines in any cell, a Week that
isn't a positive integer, an empty Day or Exercise. Fix the rows; do not work around it.

### 3. `program.json` (feeds the phone tracker app)
Emit the same programme as structured JSON so the athlete's tracker PWA can ingest it. Build it from the **same** `rows.json` with:
```
python3 <skills>/program-builder/scripts/build_program_json.py \
  --input  athlete/<slug>/programs/rows.json \
  --output athlete/<slug>/programs/program.json \
  --block "<Block name>" --athlete "<display name>" --weeks <n>
```
`--version` defaults to `1` and should be left alone here — the initial build of a block is always v1. It is bumped only by `review-workout-log` when a week is revised mid-block.

Schema (`tp-program-2`): `{ "meta": {block, athlete, athleteId, weeks, version, generated, days[], schema}, "exercises": [{id, week, day, name, sets, reps, load, rpe, tempo, rest, logHint, focus, progression}] }`, where `logHint` = the Completed Notes text (tells the app which fields to prompt for) and `athleteId` is the `athlete/<slug>/` folder name, derived from `--athlete`. Exercise ids are `w<week>d<day>e<index>` and are unique across the whole file, where `<day>` is the number in the `Day N` label (so `Day 3` is `d3`, matching its colour band in the workbook). Keep `program.json` and the `.xlsx` in sync — both come from the one `rows.json`.

The script **exits non-zero if any week of the block has no rows.** That is the guard against
regressing to a Week-1-only programme; fix the rows rather than overriding it.

**The assembled programme is validated before it is written.** `build_program_json.py` runs
`scripts/validate_program.py` over the finished structure and refuses to write the file if it
would break the `tp-program-2` contract — so a bad `program.json` never lands on disk for the
athlete to import. This is a *different* check from the `rows_common` one above: a `rows.json`
can be perfectly well-formed and still assemble into a programme the app mishandles (an id
collision, a `day` that drifts by one space from `meta.days`, a `--weeks` count that disagrees
with the rows). Errors block the write; warnings — a week missing one day, no `logHint`, no
`category` — print and continue. To check a file the builder didn't just produce:

```
python3 <skills>/program-builder/scripts/validate_program.py path/to/program.json
```

The strictness lives here and **not in the app on purpose.** The app validates almost nothing
on Import, because a slightly-off programme must still open in a gym basement rather than
hard-fail in front of an athlete who came to train. That leniency is only safe because this
runs first. The full contract is `docs/data-contracts.md`; if you add a rule to the validator,
add it there too.

**Round-trip / review convention:** the athlete imports `program.json` into the tracker, logs a session offline, and exports `session-<date>-<day>.json` into `athlete/<slug>/logs/`. Reviewing that log is **not this skill's job** — hand off to `review-workout-log`, which compares the log against the prescription for that week and day, proposes the smallest effective adjustment behind an approval gate, and on approval edits `rows.json` and re-runs these same two scripts with a bumped `--version`. Revising through the builder is what keeps the workbook and `program.json` in step.

Write the block folder so that is possible: put `rows.json`, `program.json`, the workbook and the phase map **together in one folder**, and prefer `programs/<block-slug>/` over a flat `programs/` for a new block — a flat folder can only hold one `program.json`. See `athlete/README.md`.

## Verification checklist (run before presenting)
- **Every week of the block has its own rows.** `build_program_json.py` exited 0 without
  `--allow-partial-weeks`, and its "Rows per week" line shows W1..Wn.
- **The contract validator passed** — it runs automatically inside the build, so exit 0 means
  it passed. Read any WARNING lines rather than skipping past them; each one is a plausible
  authoring slip.
- The workbook has one tab per week, and the day labels are identical string-for-string
  across weeks.
- No Progression Rule reads as a future instruction ("W4: add 2.5 kg"). They state why this
  week's prescription is what it is, plus the hold/stop gate.
- Outputs are in `athlete/<slug>/programs/`, and `meta.athlete` / `athleteId` name the right person.
- `program.json` present and parses; its exercise set matches the `.xlsx` rows (same week/day/name/prescription).
- 13 columns in the exact order; every `Completed` cell blank; no stray tabs/newlines in any cell.
- Day colour-bands and dividers present; one row per exercise per day per week.
- Every tissue/knee-loading item has a pain-monitoring rule and a symptom-logging Completed Note.
- Concurrent rule respected (heavy lower ≥24h from hard conditioning; strength before conditioning same day).
- ≤2–3 high-central-fatigue exposures in the week.
- Conditioning footprint ≤1–2 stations if the environment is a shared gym.
- Exactly one variable changes between consecutive weeks' rows for a given exercise.
- Every decision in the planning doc is reflected; every athlete dislike / constraint is honoured.
- The two output files are consistent with each other.
