---
name: review-workout-log
description: Use when an athlete or coach wants a logged training session reviewed and the upcoming week adjusted. Reads the newest exported session log (tp-session-1, -2 or -3) for that athlete, compares every logged load/reps/RPE/pain against the prescription for that exact week and day, applies the pain-monitoring and readiness rules from the profile and phase map, and proposes the smallest effective adjustment plus pre-authorised conditional rules the athlete can apply alone at the gym. Stops at an approval gate; only on approval does it revise program.json, snapshot the old revision and bump the version. Triggers on "review my last session", "here's my log", "how did that session go", "what do we do next", "adjust the programme".
---

# Review Workout Log

The third step of the coaching loop: **plan** (`program-planner`) → **build** (`program-builder`) → **train** (the tracker PWA) → **review** (this skill).

Reviewing used to happen ad hoc in chat, and the adjustments never made it back into `program.json` — so the app kept showing the original prescription while the coaching advice lived in a chat scrollback the athlete could not read under a barbell. This skill closes that loop: the review ends in an actual revised week, a version bump, and a changelog entry that records **why**.

## When NOT to use
- No log file yet — the athlete has trained but not exported. Ask them to export from the app and save it into `athlete/<slug>/logs/`.
- The athlete wants a whole new block scoped → `program-planner`.
- An approved plan needs writing into a programme → `program-builder`.
- A single factual question about one exercise ("was I meant to do 4 or 5 sets?") → read the programme and answer directly. Don't run a review.

## Hard rules

1. **Approval gate is mandatory.** This skill *proposes*. Nothing under `athlete/<slug>/programs/` is written before the athlete says yes — not `rows.json`, not `program.json`, not the workbook.
2. **Smallest effective change.** One bad session is not a reason to redesign a block. If nothing needs to change, say so plainly — "as written, no change" is a valid and common outcome.
3. **Never restructure an existing programme folder.** Work with the layout you find (see "The block folder").
4. **Snapshot before overwrite.** A revision that loses the superseded version has destroyed the record the next block's planning depends on. Use `scripts/snapshot_revision.py`; it refuses to clobber an existing snapshot.
5. **Read the athlete whose folder the log is in.** Never apply one athlete's loading rules to another's log.

## Which athlete

Everything lives under `athlete/<slug>/` — `personal-profile.md`, `plans/`, `programs/`, `logs/`. Establish the athlete **before reading anything**: from the request, or from the folder the log file sits in. If more than one folder exists under `athlete/` and the request is ambiguous, ask. `athleteId` (present from `tp-session-2` on) confirms which athlete it belongs to; a file that landed in the wrong folder is a filing mistake, not a licence to review it against another person's rules.

## The block folder

**The block folder is the directory containing the active `program.json`.** Everything for that block — `rows.json`, the `.xlsx`, the phase map, `revisions/`, `CHANGELOG.md` — lives beside it.

That definition is deliberate, because two layouts exist in the wild:

```
programs/program.json                     flat: the block folder IS programs/
programs/<block-slug>/program.json        nested: the block folder is the subfolder
```

Both work. **Prefer nested for a new block** — a flat `programs/` can only hold one `program.json`, so a second block collides. Do not migrate an existing flat block to get there; a block folder that moves mid-block breaks every path in the chat history and the athlete's own mental model. Let the next block start nested.

If a folder holds more than one `program.json`, ask which block is active rather than guessing by modification time.

## Process

### 1. Read everything before saying anything

- The **newest** `athlete/<slug>/logs/*.json`. If the athlete pointed at a specific file, use that one. If several are unreviewed, review them together — a week's pattern says more than one session does.
- `athlete/<slug>/personal-profile.md` — injuries, pain-monitoring protocol, readiness hard stops, overreaching history. **This is where the rules come from.** They are never hardcoded here.
- The active `program.json`, for the prescription for that exact week and day.
- The block's **Architecture & Phase Map** — the week's purpose, what was meant to progress, what was meant to stay stable, and the review trigger the builder wrote for exactly this moment.
- `CHANGELOG.md` in the block folder, if present. What was already adjusted, and why, decides whether this is a first wobble or the third week of the same problem.
- Earlier logs from the same block, for the week-over-week trend. A single pain score is nearly meaningless; the trend is the decision.

### 2. Read the log correctly

**Read `schema` first, then `tracking`, then the entries.** Full field-by-field detail is in `docs/data-contracts.md`; the traps that actually cause misreadings:

- **`tp-session-1`, `-2` and `-3` must all be readable.** A block spans the version boundaries. v1 has no `sets[]`; v1 and v2 have `amPainNextDay` instead of `amPainOnWaking` and no `programVersion`.
- **`programVersion` vs the current `meta.version`** answers "did they train off this programme?" in one comparison. If it is lower, the athlete never re-imported after a revision — read every deviation below against what their app actually showed them, and say so before drawing conclusions. `0` or absent means the log predates the field; fall back to diffing `prescribed`.
- **`sets[]` wins when non-empty.** It is strictly more information. **Do not average it into one load** — the shape of a session (100 → 80 → 80) *is* the signal, and it is the reason per-set logging exists. Fall back to the flat fields when `sets` is `[]` or absent. The app now logs one set at a time by default, so `sets[]` is normally populated for anything actually trained — `[]` means nothing was logged, not "the athlete used the summary instead."
- **The flat `load`/`reps`/`rpe` are the athlete's own headline, auto-filled from `sets[]` as each set is confirmed but always editable.** When they disagree with `sets[]`, that is usually a deliberate correction rather than an independent judgement call — worth naming in the review, not just accepted silently.
- **RPE can carry a half point** (`"7.5"`). It is still a string field; parse as a float if you parse it at all.
- **`tracking` disambiguates an empty value.** `painDuring: ""` with `tracking.painPerExercise: true` means *no pain logged this time*; with `false` it means *this athlete does not track pain at all*, and the pain-monitoring rules simply do not apply. Absent pain data is not a clean week. A missing `tracking` key (older files) means treat everything as true.
- **`done: false` entries are data.** `entries` covers every exercise for the day including untouched ones. What was skipped is often the most informative part of the log.
- **Everything the athlete typed is a string**, ranges and prose included ("60/70/80 kg", "8-10 min"). Never assume a prescription or a logged value parses numerically.
- **`prescribed` is denormalised into each entry.** It is the fallback stale-revision check for logs with no `programVersion`: if it does not match the current `program.json` for that week and day, **the athlete trained off an older revision**. Either way, say so before drawing any conclusion from a deviation — you may be reading an athlete who followed their instructions perfectly.

#### Morning pain — read the date gap, not just the number

For a tendon block this is the single most important number in the file, and it is the one most easily misread, because **the field changed meaning at `tp-session-3`**:

| schema | field | describes |
|---|---|---|
| `tp-session-3` | `session.amPainOnWaking` | this morning, i.e. the response to the **previous** session |
| `tp-session-1`, `-2` | `session.amPainNextDay` | the morning after **this** session |

Prefer `amPainOnWaking` when present, fall back to `amPainNextDay`, and **never merge the two into one series without shifting the older one by a day** — they describe different mornings, and a chart that ignores that will show a tendon improving when it is getting worse.

For a v3 log, attribute by **days since the previous log for that athlete**:

- **1 day** → the 24h response to that session. This is the decision-grade reading.
- **More than 1 day** → a current **baseline**, not attributable to any one exposure; rest days mean nobody was asked on the morning that mattered. Use it for the week-over-week trend, not to judge a single session. Say which one you are doing.
- **No previous log** → baseline only.

Check `tracking.painOnWaking` (or `painNextMorning` on an older file) before reading an empty value as zero.

### 3. Compare against the prescription, explicitly

For each exercise that carries a `logHint` (the app's blue "Log:" line — the builder marked those as the ones that matter), state the prescription and what actually happened side by side. **Flag deviations rather than glossing over them**, including the ones in the athlete's favour. Load below prescription, RPE above prescription, sets dropped, an exercise skipped, and pain above the protocol threshold are all findings, not noise.

Then read the session-level context — `readiness`, `sleep`, `hrvNote`, `bodyweightKg`, `overall` — because the same deviation means different things after a red-readiness night than after a green one.

### 4. Apply the rules from the profile and phase map

Not from memory of a previous athlete, and not from general coaching instinct where the profile is specific. Typically:

- **Tissue/pain rules** — the pain-monitoring model in the profile and phase map. The usual shape: pain at or below the stated threshold during and after, back to baseline by the next morning, and **no upward trend week over week**. The trend clause is the one that gets missed, and it is the one that catches a tendon before it stops the block. Regress toward isometrics / heavy-slow work when symptoms rise; progress to energy-storage work only when it is tolerated with no next-morning stiffness.
- **Readiness hard stops** — the explicit rules the plan derived from the athlete's overreaching history (e.g. consecutive below-baseline readiness → cap top sets and cut conditioning volume; illness signs → easy aerobic or rest).
- **Priority order** — safety / medical escalation → long-term continuity → symptoms and recovery → the block's primary adaptation → secondary qualities → session quality and adherence → novelty.
- **One variable per microcycle.** If you are changing load *and* volume *and* density in the same adjustment, you have redesigned rather than adjusted.
- **Red flags** (sharp pain, swelling, giving way, night pain, numbness, anything neurological) → recommend medical assessment. Say it directly. Do not program around it.

### 5. Propose the smallest effective adjustment

Name the weeks affected — usually just the next one. For each change: the exercise, the old prescription, the new one, and **the reason in one sentence tied to the logged data**. If a change ripples (dropping the sled affects the day's conditioning footprint), say so.

If the answer is "no change", say that and stop. Bringing a change to every review is how a block gets redesigned one small edit at a time.

### 6. Write conditional rules the athlete can apply alone

**This is not optional, and it is the part most likely to be skipped.** The athlete trains in the morning and sends the log in the afternoon — a reply cannot arrive before the next session. Any advice phrased as "let me know how it feels and we'll decide" is advice that arrives a day late.

So every adjustment that depends on how the athlete feels on the day must be pre-authorised as a rule they can execute themselves:

> If morning knee ≤2/10, top set as written. If 3–4/10, hold last week's load and drop the last set. If sharp at any point, skip the sled and finish with the isometric.

Requirements:

- **Decidable in the gym**, from something observable before or during the set — a pain score, a bar-speed cue, a readiness colour. Never from data the athlete does not have.
- **Bounded.** Two or three branches. A decision tree is not usable with chalked hands between sets.
- **Every branch is authorised.** No branch ends in "ask me".
- **It goes into the row's `Progression Rule` cell** (or `Focus / Notes` where it is a cue rather than a gate) so the app displays it on the exercise card. A conditional rule that lives only in the chat has not been delivered. Keep it single-line — no tabs or newlines; use `;` or `|` (`rows_common.py` rejects them anyway).

### 7. Stop at the approval gate

Present the review, summarise the proposed changes in 2–4 sentences, and ask for approval. Say explicitly that nothing has been written yet. Do not proceed.

### 8. On approval — revise, snapshot, bump, record

In this order. The snapshot comes first because it is the step that cannot be undone later.

1. **Snapshot the current revision.**
   ```bash
   python3 <skills>/review-workout-log/scripts/snapshot_revision.py \
     --program athlete/<slug>/programs/<block>/program.json \
     --changed "W5 Day 1: front squat -> low-bar primary; sled held at 80 kg" \
     --reason  "Sharp 6/10 knee pain on the W4 sled progression; front squat depth cued it"
   ```
   This copies `program.json` (and `rows.json` if it is beside it) into `revisions/` as `program-v<N>.json`, appends the `CHANGELOG.md` entry, and prints the next version number. It refuses to overwrite an existing snapshot — if it does, the previous revision was never rebuilt and you should stop and work out why.

2. **Edit `rows.json`** — the affected weeks only. `rows.json` is the single source both outputs are built from; editing `program.json` directly guarantees it drifts from the workbook. Put the conditional rules from step 6 into the `Progression Rule` cells.

3. **Rebuild both outputs from the edited `rows.json`**, passing the version the script printed:
   ```bash
   python3 <skills>/program-builder/scripts/build_program_json.py \
     --input  athlete/<slug>/programs/<block>/rows.json \
     --output athlete/<slug>/programs/<block>/program.json \
     --block "<Block name>" --athlete "<Display Name>" --weeks <n> --version <next>

   python3 <skills>/program-builder/scripts/build_xlsx.py \
     --input  athlete/<slug>/programs/<block>/rows.json \
     --output "athlete/<slug>/programs/<block>/<Block name> - Programme.xlsx"
   ```
   Rebuild **both**. A workbook that disagrees with `program.json` is the exact failure `rows_common.py` exists to prevent.

4. **Check the changelog entry reads as an explanation**, not a diff. The "why" is what makes the next block's planning better; "W5 load reduced" tells a future reader nothing.

5. **Tell the athlete to re-import** `program.json` into the tracker, and that the app will keep showing the old prescription until they do. This is a manual step with no prompt in the app — say it every time, in the last line of the response, not buried mid-paragraph.

## Versioning and revision convention

| | |
|---|---|
| `meta.version` | Integer in `program.json`. `1` on the initial build, +1 per revision. Optional and ignored by the app — it exists so a snapshot, a changelog entry and a file can be lined up. A programme with no `version` predates this convention; treat it as v1. |
| `revisions/program-v<N>.json` | The superseded programme, byte-for-byte. Its own date is in `meta.generated`. |
| `revisions/rows-v<N>.json` | The rows it was built from, so a past revision's workbook can be rebuilt. Written only if `rows.json` sits beside `program.json`. |
| `CHANGELOG.md` | One entry per revision, in the block folder: date, version, **what changed**, and **why**. Newest first. |
| Re-import | Manual, by the athlete, after every revision. The app has no version display and no prompt — see `docs/roadmap.md`. |

`tp-session-3` logs carry `programVersion`, so a log states which revision it was trained off; the app also shows `v<N>` next to the block name. Older logs don't — for those, compare the denormalised `prescribed` against the current `program.json` instead.

## Output

A single chat response, structured as `reference/review-output-template.md`. No file is written before approval. On approval: an updated `rows.json`, `program.json` and `.xlsx`, a new `revisions/program-v<N>.json`, and an appended `CHANGELOG.md`.

## Verification checklist (before presenting the review)

- The right athlete's profile was read, and the rules applied are from **that** profile.
- The prescription compared against is the one for the **logged week and day**, not week 1.
- `programVersion` matches the current `meta.version` (or `prescribed` matches, on an older log) — or the mismatch is called out first.
- The morning pain reading was attributed by **date gap**, and the right field was read for the log's schema.
- `tracking` was checked before interpreting any empty pain field.
- `sets[]` was used where present, and not averaged.
- Skipped exercises (`done: false`) are accounted for.
- The pain trend is assessed **across weeks**, not from this session alone.
- Every proposed change names its reason, and one variable moves per exercise.
- Every "it depends how you feel" is written as a bounded conditional rule with every branch authorised.
- The response ends at an approval gate and states that nothing has been written.

After approval, additionally:

- `snapshot_revision.py` exited 0 and the snapshot exists.
- `build_program_json.py` exited 0 **without** `--allow-partial-weeks`, and its "Rows per week" line still shows every week of the block.
- The workbook was rebuilt from the same `rows.json`.
- `CHANGELOG.md` has the new entry, with a why.
- The last line of the response tells the athlete to re-import.
