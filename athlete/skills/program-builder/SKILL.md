---
name: program-builder
description: Use when the user asks to GENERATE, build, or write an actual training programme from an approved Program Planning Doc. Reads the approved plan plus the athlete-profile doc and any coaching sources, applies an evidence-informed coaching framework, and outputs two things — a "Programme Architecture & Phase Map" (Markdown) and a colour-banded Excel workbook (.xlsx). Does not produce a TSV. Requires an approved plan first (from the program-planner skill). Triggers on "generate the programme", "build the block", "write the programme now", "turn the plan into the programme".
---

# Program Builder

Consumes an **approved Program Planning Doc** and writes the actual programme: a Markdown phase map plus a formatted, colour-banded Excel workbook. All programme-level decisions should already be settled in the plan — this skill executes them into exercises, sets, reps, loads, and weekly progressions.

## Prerequisite
An approved planning doc must exist (produced by `program-planner`). If you cannot find one, ask the user to point to it or to run `program-planner` first. Do not invent the plan.

## When NOT to use
- No plan yet, or the plan is unapproved / still has open questions → use `program-planner`.
- The user only wants a small in-place edit to an existing programme → make the edit directly.

## Process

1. **Read the inputs.** The approved planning doc (authoritative for all decisions), the athlete-profile doc, any coaching source material (`sources/`), and the previous programme's notes/feedback if present.
2. **Apply the coaching framework** (see "Programming rules" below) to turn the plan into concrete training.
3. **Design Week 1 in full**, one row per exercise per day, and embed the remaining weeks' changes inside each row's Progression Rule (mirrors the athlete's existing format). Build additional full weeks only if the user asks.
4. **Produce the deliverables** (see "Outputs"). No TSV.
5. **Verify** against the checklist, then present the files with a concise summary and the review trigger.

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

### 2. `<Block name> - Week 1.xlsx`
Build it with `scripts/build_xlsx.py` so formatting is identical every time.

**Columns — exactly these 13, in this order:**
`Week | Day | Exercise | Sets | Reps | Load | Intensity (RPE) | Tempo | Rest | Completed | Completed Notes | Focus / Notes | Progression Rule`

**Row rules:**
- One row per exercise per day. Day label format: `Day N (Weekday) - Theme`.
- Leave **Completed** blank.
- Populate **Completed Notes** only for important lifts, conditioning, and recovery-sensitive work — with the specific data that will guide later decisions (actual load, reps, RPE-1, pain during + next morning, technical quality, HR/erg response, or reason for modification). Warm-ups/mobility can be blank.
- **Focus / Notes** carries coaching cues + any footprint note. **Progression Rule** carries the per-week plan (W2..Wn) plus the hold/stop gate.
- **No tabs or line breaks inside any cell.** Use `;` or `|` inside notes.
- Every row must align with the phase map and include a clear progression or hold/stop rule.

**Formatting (handled by the script):** Arial 10; dark header row (white, bold, wrapped, frozen at A2); each training day gets its own fill band with a medium top-border divider where the day changes; wrapped text on Load / Completed Notes / Focus-Notes / Progression Rule; gridlines off; sensible column widths. Day band palette: Day 1 blue `DDEBF7`, Day 2 green `E2EFDA`, Day 3 peach `FCE4D6`, Day 4 lilac `EDE7F6`, Day 5 yellow `FFF2CC`, Day 6 grey `E7E6E6` (the script extends automatically).

**How to run the script:** write the Week-1 rows to a working JSON file (internal, not a deliverable) as a list of 13-item lists in column order, then:
```
python scripts/build_xlsx.py --input rows.json --output "<Block name> - Week 1.xlsx" --title "<short tab title>"
```
The script validates the column count, refuses rows with stray tabs/newlines, applies the banding, and prints a summary.

### 3. `program.json` (feeds the phone tracker app)
Emit the same programme as structured JSON so the athlete's tracker PWA can ingest it. Build it from the **same** `rows.json` with:
```
python scripts/build_program_json.py --input rows.json --output program.json \
  --block "<Block name>" --athlete "<name>" --weeks <n>
```
Schema (`tp-program-1`): `{ "meta": {block, athlete, weeks, generated, days[], schema}, "exercises": [{id, week, day, name, sets, reps, load, rpe, tempo, rest, logHint, focus, progression}] }`, where `logHint` = the Completed Notes text (tells the app which fields to prompt for). Keep `program.json` and the `.xlsx` in sync — both come from the one `rows.json`.

**Round-trip / review convention:** the athlete imports `program.json` into the tracker, logs a session offline, and exports `session-<date>-<day>.json` into a `logs/` subfolder of this project folder. When the user asks you to review a session, read the newest `logs/*.json`, compare logged loads/RPE/pain against the prescription, apply the pain-monitoring and readiness rules, and recommend the smallest effective adjustment.

## Verification checklist (run before presenting)
- `program.json` present and parses; its exercise set matches the `.xlsx` rows (same day/name/prescription).
- 13 columns in the exact order; every `Completed` cell blank; no stray tabs/newlines in any cell.
- Day colour-bands and dividers present; one row per exercise per day.
- Every tissue/knee-loading item has a pain-monitoring rule and a symptom-logging Completed Note.
- Concurrent rule respected (heavy lower ≥24h from hard conditioning; strength before conditioning same day).
- ≤2–3 high-central-fatigue exposures in the week.
- Conditioning footprint ≤1–2 stations if the environment is a shared gym.
- Exactly one variable progresses per week in each Progression Rule.
- Every decision in the planning doc is reflected; every athlete dislike / constraint is honoured.
- The two output files are consistent with each other.
