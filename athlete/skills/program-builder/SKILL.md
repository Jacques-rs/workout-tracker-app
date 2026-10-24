---
name: program-builder
description: Use when the user asks to GENERATE, build, or write an actual training programme from an approved Program Planning Doc. Reads the approved plan plus that athlete's profile doc and any coaching sources, applies an evidence-informed coaching framework, and outputs three things — a "Programme Architecture & Phase Map" (Markdown), a colour-banded Excel workbook with one tab per week (.xlsx), and program.json for the tracker app. Authors every week of the block explicitly, and declares each exercise's category. Requires an approved plan first (from the program-planner skill). Do NOT use this to review a logged session or revise a running block — that is the review-workout-log skill. Triggers on "generate the programme", "build the block", "write the programme now", "turn the plan into the programme".
---

# Program Builder

Consumes an **approved Program Planning Doc** and writes the actual programme: a Markdown phase map, a colour-banded Excel workbook with one tab per week, and `program.json` for the tracker app. All programme-level decisions should already be settled in the plan — this skill executes them into exercises, sets, reps, loads, and weekly progressions, authoring **every** week of the block explicitly.

## Prerequisite
An approved planning doc must exist (produced by `program-planner`). If you cannot find one, ask the user to point to it or to run `program-planner` first. Do not invent the plan.

## Which athlete

Establish this **before opening any file**, and never read one athlete's profile while building
another's programme. Write every output to that athlete's `programs/` folder and pass their
display name to `--athlete`. Procedure: `athlete/README.md`.

## When NOT to use
- No plan yet, or the plan is unapproved / still has open questions → use `program-planner`.
- A block is running and a logged session should adjust it → use `review-workout-log`, which
  revises through these same scripts and archives the superseded revision first.
- The user only wants a small in-place edit to an existing programme → make the edit directly.

## Process

1. **Read the inputs.** The approved planning doc (authoritative for all decisions), `athlete/<slug>/personal-profile.md`, and the previous programme's notes/feedback if present. Reach for `athlete/sources/` only where the plan leaves a choice genuinely open — the plan already settled the programme-level decisions, and re-deriving them from the framework is how a build drifts from what was approved.
2. **Apply the coaching framework** (see "Programming rules" below) to turn the plan into concrete training.
3. **Author every week of the block in full** — one row per exercise per day *per week*. See "Authoring all weeks" below; this is a hard requirement, not an option.
4. **Produce the deliverables** (see "Outputs").
5. **Verify** against the checklist, then present the files with a concise summary and the review trigger.

## Authoring all weeks (do not shortcut this)

Write Week 1 through Week N as real rows in `rows.json`. Week 4 gets its own rows with its
own exercises, loads, reps and RPE — not a Week 1 row plus a sentence saying what to change.

**Why this is a hard rule.** The app renders the week the athlete selected, so a week described
only in prose is a week they train off wrong — and progressions are coaching judgement, which
belongs in your output rather than in the athlete's head under a loaded barbell.
`build_program_json.py` **refuses** to emit a programme with missing weeks; if it errors, author
them. Do not reach for `--allow-partial-weeks`.

**The Progression Rule column is therefore *rationale*, not instruction:** why this week differs
from the last, plus the hold/stop gate that would make you deviate ("hold load if pain >5/10 or
next-morning stiffness"). Write it declaratively ("volume up one set; load held because W2 RPE
ran high"), never as an imperative ("W4: add 2.5 kg").

Practical approach: design Week 1 properly, then walk the phase map week by week and write
each week's rows, changing **one variable per microcycle** as the programming rules require.
Deload weeks are authored like any other week, with their actual reduced prescription.

**A transition week is an ordinary authored Week 1.** When the plan opens with one (see "Week 1
is not week 1" in `program-planner`), it gets real rows carrying a deload's reduced prescription,
the rest of the block shifts up by one, and `--weeks` is the **total including it**.

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

## Writing strings the app reads

Four columns are parsed by the tracker rather than just displayed, and what you write in them
decides how fast the athlete can log with chalked hands. The full tables are in
`docs/data-contracts.md`; these are the authoring rules.

- **`Reps` picks the athlete's input field.** The app reads the unit off the prescription:
  `"45 sec"` → `Hold (s)`, `"8-10 min"` → `Time (min)`, `"20 m"` → `Dist (m)`, `"15/12 cal"` →
  `Work (cal)`, a plain count or range → `Reps`, anything composite → a free-text `Result`. That
  choice sets the label, the on-screen keyboard, the placeholder and the unit on the logged
  summary — so **write the unit form**: `"45 sec"`, not `"45s"` or `"0:45"`. `Result` is right
  for genuinely composite work and wrong for a lift that is really N reps of one thing.
- **`Sets` decides how many set chips materialise.** A plain integer, a plain numeric range
  (lower bound used) or an integer followed by a word (`"4 rounds"`) gives that many; anything
  else — `"AMRAP"`, `"1 + 3"`, a decorated range like `"8-10 min"` — collapses to a single
  "Set 1 of 1". That is the right shape for AMRAP and interval work and an authoring slip for an
  even-sets lift, so **prefer a plain integer** ("4", not "3-4") whenever the exercise really is
  that many even sets: it is what makes a lift log itself in the fewest taps.
- **`Completed Notes` is parsed, not printed.** It becomes the blue "Log:" line, split on
  **semicolons** into at most four Capture chips — so write two to four short instructions
  (`"Top load; RPE-1; knee pain during + next AM"`), never a sentence, and never more than four.
  A `+` inside a clause stays part of that clause. Pain words (`pain`, `sore`, `stiff`,
  `response`, or a named joint) accent the pain field on that exercise and nudge once if it is
  finished without a reading; a named joint is picked up as the site. `Focus / Notes` is scanned
  the same way, so a cue mentioning pain has the same effect.
- **`Category` colours the card's rail, and `tendon` turns on the pain ask.** Use one of the
  seven slots — `warmup`, `tendon`, `skill`, `strength`, `cond`, `accessory`, `cooldown` — or a
  recognised alias (`prehab`/`rehab`/`isometric` → tendon, `metcon`/`conditioning`/`aerobic` →
  cond, `technique`/`olympic` → skill, `main`/`lift` → strength, `core`/`auxiliary` → accessory,
  `mobility` → cooldown). A declared `tendon` accents the pain field and nudges on Finish **even
  with no pain cue in the notes**, so every tissue-monitoring exercise must declare it. An
  invented word still renders, with a derived colour, but resolves to no slot and loses that
  behaviour. Declare it on **every** row or on none: half-declared, the rest fall back to a guess
  from the exercise name and nothing in the file says which is which. The validator warns on both.

## Outputs (three files)

### 1. `<Block name> - Architecture & Phase Map.md`
Sections in this order:
1. **Decision Summary** — active goal, block phase, constraints, key trade-offs, assumptions.
2. **Programme Architecture and Phase Map** — a week-by-week table (label + purpose + what progresses + what stays stable + expected fatigue + review trigger), session roles, progression/regression logic across load/reps/RPE/volume/density/conditioning/technique, and a justified loading & deload structure.
3. **Progression and Monitoring Rules** — tissue/pain rules, readiness hard stops, strength/power/conditioning rules, and what to log.
4. **Review Trigger** — exactly what data is needed before the next material decision.

### 2. `<Block name> - Programme.xlsx`
Build it with `scripts/build_xlsx.py` so formatting is identical every time. The workbook
gets **one tab per week** ("Week 1", "Week 2", …), split automatically from the Week column.

**Columns — exactly these 14, in this order:**
`Week | Day | Exercise | Sets | Reps | Load | Intensity (RPE) | Tempo | Rest | Completed | Completed Notes | Focus / Notes | Progression Rule | Category`

**Row rules:**
- One row per exercise per day **per week**. Every row states its own week in column 1.
- Day label format: `Day N (Weekday) - Theme`, identical across weeks so the app's day
  filter and the workbook's colour bands line up.
- Leave **Completed** blank.
- Populate **Completed Notes** only for important lifts, conditioning, and recovery-sensitive work — with the specific data that will guide later decisions (actual load, reps, RPE-1, pain during + pain on waking (captured at the *next* session's check-in), technical quality, HR/erg response, or reason for modification). Warm-ups/mobility can be blank.
- **Focus / Notes** carries coaching cues + any footprint note. **Progression Rule** carries the *rationale* for this week's prescription plus the hold/stop gate — see "Authoring all weeks".
- **Sets, Reps, Completed Notes and Category are parsed by the app** — see "Writing strings the app reads" above before filling any of them.
- **No tabs or line breaks inside any cell.** Use `;` or `|` inside notes.
- Every row must align with the phase map and include a clear progression or hold/stop rule.

**Formatting is entirely the script's** — fonts, frozen header, per-day colour bands and
dividers, wrapping, column widths. It is identical every time and there is nothing to specify or
match by hand; `build_xlsx.py` is where those values live.

**How to run the script:** write **all** rows, every week, to a working JSON file
(`athlete/<slug>/programs/rows.json` — internal, not a deliverable) as a list of 14-item
lists in column order. Both scripts take absolute or relative paths; run them from wherever
is convenient and point `--input` at that file:
```
python3 athlete/skills/program-builder/scripts/build_xlsx.py \
  --input  athlete/<slug>/programs/rows.json \
  --output "athlete/<slug>/programs/<Block name> - Programme.xlsx"
```
`--title` is an optional **tab prefix** (default `Week`); the week number is appended.

Both scripts share `scripts/rows_common.py`, so they validate `rows.json` identically and
order rows identically — the workbook and `program.json` cannot describe different
programmes. Rejected outright: wrong column count, tabs or newlines in any cell, a Week that
isn't a positive integer, an empty Day or Exercise. Fix the rows; do not work around it.

A **13-field** row is also accepted and padded with an empty Category, so a `rows.json` archived
under `revisions/` before that column existed still rebuilds. Write 14 for anything new.

### 3. `program.json` (feeds the phone tracker app)
Emit the same programme as structured JSON so the athlete's tracker PWA can ingest it. Build it from the **same** `rows.json` with:
```
python3 athlete/skills/program-builder/scripts/build_program_json.py \
  --input  athlete/<slug>/programs/rows.json \
  --output athlete/<slug>/programs/program.json \
  --block "<Block name>" --athlete "<display name>" --weeks <n>
```
`--version` defaults to `1` and should be left alone here — the initial build of a block is always v1. It is bumped only by `review-workout-log` when a week is revised mid-block.

Schema (`tp-program-2`): `{ "meta": {block, athlete, athleteId, weeks, version, generated, days[], schema}, "exercises": [{id, week, day, name, sets, reps, load, rpe, tempo, rest, logHint, focus, progression, category}] }`, where `logHint` = the Completed Notes text (tells the app which fields to prompt for), `category` is omitted entirely when the Category cell is blank, and `athleteId` is the `athlete/<slug>/` folder name, derived from `--athlete`. Exercise ids are `w<week>d<day>e<index>` and are unique across the whole file, where `<day>` is the number in the `Day N` label (so `Day 3` is `d3`, matching its colour band in the workbook). Keep `program.json` and the `.xlsx` in sync — both come from the one `rows.json`.

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
python3 athlete/skills/program-builder/scripts/validate_program.py path/to/program.json
```

The strictness lives here and **not in the app on purpose.** The app validates almost nothing
on Import, because a slightly-off programme must still open in a gym basement rather than
hard-fail in front of an athlete who came to train. That leniency is only safe because this
runs first. The full contract is `docs/data-contracts.md`; if you add a rule to the validator,
add it there too.

**Round-trip:** the athlete imports `program.json`, logs offline, and exports
`session-<date>-<day>.json` into `athlete/<slug>/logs/`. Reviewing that log is **not this skill's
job** — hand off to `review-workout-log`, which revises by editing `rows.json` and re-running
these same two scripts with a bumped `--version`. Revising through the builder is what keeps the
workbook and `program.json` in step.

Write the block folder so that is possible: `rows.json`, `program.json`, the workbook and the
phase map **together in one folder**, laid out as `athlete/README.md` describes.

## Verification checklist (run before presenting)

**The scripts already refuse** a wrong column count, a tab or newline in any cell, a missing
week, a day label that is not in `meta.days`, a duplicate exercise id, and a `--weeks` count that
disagrees with the rows. Exit 0 without `--allow-partial-weeks` means all of that passed — do not
re-check it by hand. Do **read the WARNING lines** rather than scrolling past them: each is legal
under the contract and usually an authoring slip, and they are the only findings the build will
not stop for.

What no script can check, and what this list is for:

- Every row matches the phase map for **its own week**, and **exactly one variable changes**
  between consecutive weeks for a given exercise.
- No Progression Rule reads as a future instruction ("W4: add 2.5 kg"). Each states why this
  week's prescription is what it is, plus the hold/stop gate.
- Every tissue/tendon item declares `Category: tendon` **and** carries a pain-monitoring rule and
  a symptom-logging Completed Note. Category is declared on every row, or on none.
- Concurrent rule respected (heavy lower ≥24h from hard conditioning; strength before
  conditioning when they share a day), ≤2–3 high-central-fatigue exposures in a week, and
  conditioning footprint ≤1–2 stations in a shared gym.
- Every **Completed** cell is blank — that column belongs to the athlete, and nothing checks it.
- Every decision in the planning doc is reflected and every athlete dislike or constraint is
  honoured, and the block length matches the plan **including a transition week** if it called
  for one.
- The three outputs sit together in one folder under `athlete/<slug>/programs/`, and
  `meta.athlete` / `athleteId` name the right person.
