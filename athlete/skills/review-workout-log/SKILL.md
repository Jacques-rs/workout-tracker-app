---
name: review-workout-log
description: Use when an athlete or coach wants a training week reviewed and the weeks ahead adjusted. Pulls every session logged since the programme's reviewedThrough date (tp-session-1, -2 or -3), compares each logged load/reps/RPE/pain against the prescription for that exact week and day, applies the pain-monitoring and readiness rules from the profile and phase map, and proposes the smallest effective adjustment to the untrained weeks plus pre-authorised conditional rules the athlete can apply alone at the gym. Stops at an approval gate; only on approval does it snapshot, rebuild with a change note, and publish the revision to the athlete's phone. Do NOT use this to scope a new block — that is the program-planner skill — or to write a programme from an approved plan, which is program-builder. Triggers on "review my week", "weekly review", "review my last session", "here's my log", "what do we do next", "adjust the programme".
---

# Review Workout Log

The third step of the coaching loop: **plan** (`program-planner`) → **build** (`program-builder`) → **train** (the tracker PWA) → **review** (this skill).

The unit is the **review window**: every session logged after the active programme's
`meta.reviewedThrough` (from its first session, if it has none). A review covers the whole
window, never a single file picked out of it.

A review that ends in chat has not been delivered: the app goes on showing the original
prescription, and the advice sits in a scrollback the athlete cannot read under a barbell. So a
review that changes anything ends in a revised programme **published to the athlete's phone**,
with a version bump, a one-line change note the athlete sees, and a changelog entry recording
**why**.

## When NOT to use
- The window is empty after the pull in step 1 — nothing has been logged since the last review. Say so and stop.
- The athlete wants a whole new block scoped → `program-planner`.
- An approved plan needs writing into a programme → `program-builder`.
- A single factual question about one exercise ("was I meant to do 4 or 5 sets?") → read the programme and answer directly. Don't run a review.

## Hard rules

1. **Approval gate is mandatory.** This skill *proposes*. Nothing under `athlete/<slug>/programs/` is written before the athlete says yes — not `rows.json`, not `program.json`, not the workbook.
2. **Smallest effective change.** One bad session is not a reason to redesign a block. If nothing needs to change, say so plainly — "as written, no change" is a valid and common outcome.
3. **Only untrained weeks change.** A revision edits weeks and days with no logged session, and substitutes an exercise in place rather than reordering a day. `coach_sync.py revise` refuses anything else, so a refusal means the proposal was wrong — rework it, never work around it.
4. **Never restructure an existing programme folder.** Work with the layout you find (see "The block folder").
5. **Snapshot before overwrite.** A revision that loses the superseded version has destroyed the record the next block's planning depends on. Use `scripts/snapshot_revision.py`; it refuses to clobber an existing snapshot.
6. **Read the athlete whose folder the log is in**, established **before opening any file** —
   from the request, or from the folder the log sits in. Never apply one athlete's loading rules
   to another's log. Procedure, and what `athleteId` does and does not settle:
   `athlete/README.md`.

## The block folder

**The block folder is the directory containing the active `program.json`**, and everything for
that block lives beside it. Two layouts exist and both work — `athlete/README.md` has them, and
hard rule 4 above says to leave the one you find alone.

The case that matters here: **if a folder holds more than one `program.json`, ask which block is
active.** Do not guess by modification time.

## Process

### 1. Pull the window, then read everything before saying anything

```bash
python3 athlete/skills/program-builder/scripts/coach_sync.py pull --athlete <slug>
```
This writes every session synced since the latest `reviewedThrough` into `athlete/<slug>/logs/`;
add `--since <date>` only when the athlete asks for a different window. If the pull cannot run —
no network, or the athlete is not linked to the coach account — ask the athlete to export the
missing sessions from the app into `logs/`, and say the review was built from files.

- **Every log in the window**, read together — the week's pattern is the evidence, and a single session inside it is one data point. A conflict copy (`-conflict-` in its name) is the same session edited on two devices: read both and say which one you relied on. An earlier copy (`-earlier-`) is the same date and day started under one programme version and finished under the next; the pull warns about it — read both the same way.
- **Logs in the window that a previous "no change" review already covered** are trend context: name what they showed in one line and spend the review on what is new.
- `athlete/<slug>/personal-profile.md` — injuries, pain-monitoring protocol, readiness hard stops, overreaching history. **This is where the rules come from.** They are never hardcoded here.
- The active `program.json`, for the prescription for that exact week and day.
- The block's **Architecture & Phase Map** — the week's purpose, what was meant to progress, what was meant to stay stable, and the review trigger the builder wrote for exactly this moment.
- `CHANGELOG.md` in the block folder, if present. What was already adjusted, and why, decides whether this is a first wobble or the third week of the same problem.
- Earlier logs from the same block, for the week-over-week trend. A single pain score is nearly meaningless; the trend is the decision.

### 2. Read the log correctly

**Read `schema` first, then `tracking`, then the entries.** The file's *shape* — every version's
fields, `sets[]` and circuit semantics, the morning-pain tables — is owned by
`docs/data-contracts.md`; read it if anything below is unfamiliar. What follows is only the
handful of readings that change a **conclusion**.

- **First, did they train off this programme?** Compare the log's `programVersion` against the
  current `meta.version`. On a v1/v2 log the field does not exist — diff the denormalised
  `prescribed` for that week and day instead. If it is behind, every deviation below has to be
  read against what their app actually showed them, and you must say so before concluding
  anything: you may be reading an athlete who followed their instructions perfectly.
- **Never average `sets[]`.** For ordinary exercises it wins whenever it is non-empty, because
  the *shape* of a session (100 → 80 → 80) is the signal. Circuits are the exception — round
  rows and the flat final result are complementary, so read both, and `sets: []` on an AMRAP or
  for-time piece is a logged outcome, not an empty entry.
- **A flat field disagreeing with `sets[]` is usually a deliberate correction**, not a bug. Name
  it in the review rather than silently preferring one.
- **`tracking` decides what an empty value means.** `painDuring: ""` with
  `tracking.painPerExercise: true` means *no pain logged this time*; with `false` the athlete
  does not track pain at all and the pain-monitoring rules simply do not apply. Absent pain data
  is never a clean week. A missing `tracking` key (older files) means treat everything as true.
- **`done: false` entries are data.** `entries` covers every exercise for the day, including
  untouched ones. What was skipped is often the most informative part of the file.
- **Nothing parses.** Every logged and prescribed value is a string — ranges, prose, and an RPE
  that may carry a half point (`"7.5"`). Read the unit off `prescribed.reps`.

#### Morning pain — read the date gap, not just the number

For a tendon block this is the most important number in the file, and the easiest to misread,
because **the field changed meaning at `tp-session-3`**: v3's `session.amPainOnWaking` describes
**this** morning — the response to the **previous** session — while v1/v2's `amPainNextDay`
describes the morning after **this** one. Prefer `amPainOnWaking`, fall back to `amPainNextDay`,
and **never merge them into one series without shifting the older one by a day**: a chart that
ignores the flip shows a tendon improving while it is getting worse.

On a v3 log, attribute by **days since the previous log for that athlete**. Exactly one day is
the 24h response to that session, and the decision-grade reading. More than one day is a current
**baseline** that no single exposure explains — nobody was asked on the morning that mattered —
so use it for the week-over-week trend, not to judge one session. No previous log is baseline
only. **Say which one you are doing.**

Check `tracking.painOnWaking` (or `painNextMorning` on an older file) before reading an empty
value as zero.

### 3. Compare against the prescription, explicitly

For each session in the window, and each exercise that carries a `logHint` (the app's blue "Log:" line — the builder marked those as the ones that matter), state the prescription and what actually happened side by side. **Flag deviations rather than glossing over them**, including the ones in the athlete's favour. Load below prescription, RPE above prescription, sets dropped, an exercise skipped, and pain above the protocol threshold are all findings, not noise.

Then read the session-level context — `readiness`, `sleep`, `hrvNote`, `bodyweightKg`, `overall` — because the same deviation means different things after a red-readiness night than after a green one.

### 4. Apply the rules from the profile and phase map

Not from memory of a previous athlete, and not from general coaching instinct where the profile is specific. Typically:

- **Tissue/pain rules** — the pain-monitoring model in the profile and phase map. The usual shape: pain at or below the stated threshold during and after, back to baseline by the next morning, and **no upward trend week over week**. The trend clause is the one that gets missed, and it is the one that catches a tendon before it stops the block. Regress toward isometrics / heavy-slow work when symptoms rise; progress to energy-storage work only when it is tolerated with no next-morning stiffness.
- **Readiness hard stops** — the explicit rules the plan derived from the athlete's overreaching history (e.g. consecutive below-baseline readiness → cap top sets and cut conditioning volume; illness signs → easy aerobic or rest).
- **Priority order** — safety / medical escalation → long-term continuity → symptoms and recovery → the block's primary adaptation → secondary qualities → session quality and adherence → novelty.
- **One variable per microcycle.** If you are changing load *and* volume *and* density in the same adjustment, you have redesigned rather than adjusted.
- **Red flags** (sharp pain, swelling, giving way, night pain, numbness, anything neurological) → recommend medical assessment. Say it directly. Do not program around it.

### 5. Propose the smallest effective adjustment

Name the weeks affected — usually just the next one, and never one that already has a logged session. For each change: the exercise, the old prescription, the new one, and **the reason in one sentence tied to the logged data**. If a change ripples (dropping the sled affects the day's conditioning footprint), say so.

If the answer is "no change", say that and stop: nothing is written or published, and the next review's window still opens at the same `reviewedThrough`, so it covers these sessions again as trend context. Bringing a change to every review is how a block gets redesigned one small edit at a time.

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
   python3 athlete/skills/review-workout-log/scripts/snapshot_revision.py \
     --program athlete/<slug>/programs/<block>/program.json \
     --changed "W5 Day 1: front squat -> low-bar primary; sled held at 80 kg" \
     --reason  "Sharp 6/10 knee pain on the W4 sled progression; front squat depth cued it"
   ```
   This copies `program.json` (and `rows.json` if it is beside it) into `revisions/` as `program-v<N>.json`, appends the `CHANGELOG.md` entry, and prints the next version number. It refuses to overwrite an existing snapshot — if it does, the previous revision was never rebuilt and you should stop and work out why.

2. **Edit `rows.json`** — the affected weeks only. `rows.json` is the single source both outputs
   are built from; editing `program.json` directly guarantees it drifts from the workbook. Put
   the conditional rules from step 6 into the `Progression Rule` cells. Rows are 14 fields wide
   (`Category` last); a block authored before that column is 13 and loads fine, but a row you
   edit should come back the width it went in.

3. **Rebuild both outputs from the edited `rows.json`.** `snapshot_revision.py` printed the exact
   `build_program_json.py` command, with this block's name, athlete, week count, start date and
   the next version already filled in from `meta` — **use it** rather than retyping the
   arguments, and fill its two placeholders:
   - `--change-note` — one line, at most 280 characters, written **to the athlete**: what changes
     in which week and the logged reason. `"W5 D1: low-bar squat replaces front squat; knee 4→6/10 over three weeks"`, not `"revision per review"`.
   - `--reviewed-through` — the date of the **latest session in the window**.

   Then rebuild the workbook from the same file:
   ```bash
   python3 athlete/skills/program-builder/scripts/build_xlsx.py \
     --input  athlete/<slug>/programs/<block>/rows.json \
     --output "athlete/<slug>/programs/<block>/<Block name> - Programme.xlsx"
   ```
   Rebuild **both**. A workbook that disagrees with `program.json` is the exact failure
   `rows_common.py` exists to prevent.

4. **Check the changelog entry reads as an explanation**, not a diff. The "why" is what makes the next block's planning better; "W5 load reduced" tells a future reader nothing.

5. **Publish the revision**, dry run first:
   ```bash
   python3 athlete/skills/program-builder/scripts/coach_sync.py revise \
     --athlete <slug> --program athlete/<slug>/programs/<block>/program.json --dry-run
   ```
   Then the same command without `--dry-run`. A refusal names the rule broken (hard rule 3):
   fix `rows.json`, rebuild, and run it again — the snapshot and changelog entry already written
   stay, because they describe the revision being prepared.

6. **Tell the athlete to tap Update device** in the app, and that the app keeps
   showing the old prescription until they do. If the publish could not run, they re-import
   `program.json` instead. Say it every time, in the last line of the response, not buried
   mid-paragraph.

## Versioning and revision convention

| | |
|---|---|
| `meta.version` | Integer in `program.json`. `1` on the initial build, +1 per revision. Optional; nothing about rendering depends on it. It exists so a snapshot, a changelog entry and a file line up. A programme with no `version` predates the convention — treat it as v1 for snapshotting, though the app shows nothing rather than claim a number it cannot know. |
| `revisions/program-v<N>.json` | The superseded programme, byte-for-byte. Its own date is in `meta.generated`. |
| `revisions/rows-v<N>.json` | The rows it was built from, so a past revision's workbook can be rebuilt. Written only if `rows.json` sits beside `program.json`. |
| `CHANGELOG.md` | One entry per revision, in the block folder: date, version, **what changed**, and **why**. Newest first. |
| `meta.changeNote` | One line for the athlete: what changed and why. The `CHANGELOG.md` entry is the full explanation; this is its headline. |
| `meta.reviewedThrough` | The latest session date the revision's review covered. The next window opens after it. |
| Delivery | `coach_sync.py revise` publishes onto the athlete's library row; the athlete taps **Update device**. Without the account, a manual re-import. |

`tp-session-3` logs carry `programVersion`, so a log states which revision it was trained off. Older logs don't — for those, compare the denormalised `prescribed` against the current `program.json` instead.

## Output

A single chat response, structured as `reference/review-output-template.md`. No file is written before approval. On approval: an updated `rows.json`, `program.json` and `.xlsx`, a new `revisions/program-v<N>.json`, an appended `CHANGELOG.md`, and the revision published to the athlete's library.

## Verification checklist (before presenting the review)

- The **right athlete's** profile was read, and every rule applied comes from *that* profile.
- Every session in the window was read — the count of logs reviewed matches what the pull wrote,
  plus any already in `logs/` after `reviewedThrough`.
- The prescription compared against is the one for the **logged week and day** — and either
  `programVersion` matches the current `meta.version` (or `prescribed` matches, on an older log),
  or the mismatch is called out before any deviation is interpreted.
- The morning pain reading was attributed **by date gap**, the right field was read for the log's
  schema, and `tracking` was checked before any empty pain value was read as a zero.
- The entries were read as written: `sets[]` used where present and never averaged, circuit rows
  and the flat final result read together, and `done: false` exercises accounted for.
- The pain trend is assessed **across weeks**, not from this session alone.
- Every proposed change names its reason, one variable moves per exercise, and every change
  lands in a week with no logged session.
- Every "it depends how you feel" is a bounded conditional rule with **every branch authorised**,
  and it is written where the app will show it.
- The response ends at an approval gate and says that nothing has been written.

After approval, the scripts carry most of it — `snapshot_revision.py` refuses to clobber an
existing snapshot, and `build_program_json.py` refuses a programme with a missing week. Exit 0
from both is the check. What they cannot tell you:

- The **workbook** was rebuilt too, from the same `rows.json`.
- The `CHANGELOG.md` entry reads as an **explanation**, not a diff. "W5 load reduced" tells the
  next block's planning nothing.
- The change note reads as a sentence to the athlete, and `--reviewed-through` is the window's
  latest session date.
- `coach_sync.py revise` exited 0 — a dry run alone published nothing.
- The **last line** of the response tells the athlete to tap Update device.
