# Data contracts

Two JSON shapes cross the boundary between this app and the coaching project. **These are the integration surface — changing them requires changing the generator/consumer on the other side too.**

- `tp-program-2` — **input.** Produced by the `program-builder` skill; consumed by this app.
- `tp-session-2` — **output.** Produced by this app; consumed by the AI coach at review time.

Both are at **version 2**. Version 1 files still exist on disk (an already-imported programme,
and every session log exported before the change), so **both readers must accept both
versions**. What changed:

| | v1 | v2 |
|---|---|---|
| `tp-program-*` | Week 1 only; later weeks as prose in `progression` | every week authored as real rows; `progression` demoted to rationale |
| `tp-session-*` | one load/reps/RPE per exercise | adds a per-set `sets[]` array; flat fields stay as the summary |

Version detection is `meta.schema` / `schema`. Neither reader should infer version from the
presence of a field.

---

## Input: `program.json` (schema `tp-program-2`)

```json
{
  "meta": {
    "block": "Hybrid CrossFit Athleticism - Block 1",
    "athlete": "Jacques",
    "athleteId": "jacques",
    "weeks": 6,
    "generated": "2026-07-25",
    "days": [
      "Day 1 (Mon) - Clean Skill + Front Squat + Knee Capacity",
      "Day 2 (Tue) - Jerk Skill + Upper Strength + Gymnastics + Aerobic Power"
    ],
    "schema": "tp-program-2"
  },
  "exercises": [
    {
      "id": "w1d1e3",
      "week": 1,
      "day": "Day 1 (Mon) - Clean Skill + Front Squat + Knee Capacity",
      "name": "Hang power clean (EMOM every 90s)",
      "sets": "7",
      "reps": "2",
      "load": "50-70 kg; technically crisp",
      "rpe": "RPE 5-6",
      "tempo": "1-0-X-1",
      "rest": "EMOM / 90 sec",
      "logHint": "Top load; bar-path & catch quality; any knee response",
      "focus": "Skill/power. Run as EMOM so it flows rhythmically...",
      "progression": "W2 add density (E90s x8). W3 +2.5 kg if all reps crisp..."
    }
  ]
}
```

### Field notes

| Field | Notes |
|---|---|
| `meta.days` | **Ordered** list of day labels. Drives the day selector; order matters. |
| `meta.weeks` | Populates the week selector (1..N). Under v2 every one of those weeks has rows. |
| `meta.athleteId` | **v2.** Lowercase slug of `meta.athlete`, matching the `athlete/<slug>/` folder. Passed through to the session export so a log file identifies its athlete without relying on the filename. Absent in v1 — fall back to slugging `meta.athlete`. |
| `exercises[].id` | Unique per exercise **across the whole file**. v2 convention `w<week>d<daySlot>e<exerciseIndex>`, where `daySlot` is the number in the `Day N` label (`Day 3` → `d3`), falling back to position in `meta.days` if the labels aren't distinctly numbered. v1 was `d<dayIndex>e<exerciseIndex>`. **This is the key the app stores logged data under** — the v1→v2 id change means logs recorded against a v1 programme do not line up with the v2 one. Expected and accepted at the version boundary; exported session files are unaffected because they denormalise `prescribed` and are keyed by exercise name. |
| `exercises[].week` | **v2: load-bearing.** The app renders only the exercises whose `week` matches the selected week. In v1 it was ignored. |
| `exercises[].day` | Must match a string in `meta.days` **exactly** — the app filters by string equality. Day labels must be byte-identical across weeks, or a day will look empty in some weeks. |
| `sets`/`reps`/`load`/`rpe`/`tempo`/`rest` | **All strings, not numbers.** They hold ranges and prose ("1 + 3", "8-10 min", "~115-135 kg", "RPE 6-6.5"). Never assume they parse as numeric. |
| `logHint` | Comes from the spreadsheet's "Completed Notes" column. Rendered as the blue "Log:" line — it tells the athlete which data actually matters for this movement. Empty string for warm-ups. |
| `focus` | Coaching cues (spreadsheet "Focus / Notes"). Collapsed by default. |
| `progression` | Spreadsheet "Progression Rule". **Meaning changed in v2:** it is now *rationale* — why this week's prescription differs from last week's, plus the hold/stop gate. In v1 it was an instruction the athlete had to execute. Collapsed by default either way. |
| `category` | **Optional.** Drives the coloured left rail and the tag on each exercise card. Not currently emitted by `program-builder` — see below. |

### Optional: `exercises[].category`

Purely presentational — it groups a day visually (skill vs strength vs conditioning) so the
card list is scannable. **The app never filters, reorders or gates anything on it.**

Recognised values, each with a fixed *slot* whose colour comes from the active theme
(`--cat-*`): `warmup`, `tendon`, `skill`, `strength`,
`cond`, `accessory`, `cooldown`. Common aliases also resolve (`metcon`/`conditioning`/
`aerobic` → `cond`, `prehab`/`rehab`/`isometric` → `tendon`, `technique`/`olympic` →
`skill`, `main`/`lift` → `strength`, `core`/`auxiliary` → `accessory`, `mobility` →
`cooldown`). Matching is case-insensitive and tolerates spaces/underscores.

**Resolution order in `catOf()`** — this is the fallback ladder, and it matters because the
generator does not currently emit the field at all:

1. **Declared and recognised** → that category's label + colour.
2. **Declared but unrecognised** (e.g. `"Grip work"`) → the string is shown verbatim as the
   tag, with a colour derived deterministically from it. A generator can invent its own
   vocabulary without the UI breaking or falling back to grey.
3. **Absent** → guessed from keywords in `exercises[].name`. Ordered, so skill lifts win
   before the EMOM/interval rule (`Hang power clean (EMOM every 90s)` is skill, not
   conditioning).
4. **Absent and no keyword matches** → **no tag at all**, neutral rail. The app never
   asserts a category it had to invent.

Because step 3 is a guess, adding a real `category` to the generator is the honest fix — it
would replace inference with declaration for every exercise. That is a `program-builder`
change; until then step 3/4 carry the UI and are correct on the current sample programme.

### Day label format

`Day <N> (<Weekday>) - <Theme>`

The leading `Day <N>` is parsed for the day index (colour bands in the spreadsheet, ordering here), so keep that prefix intact.

### Validation the app performs

Minimal, by design: `meta` must exist and `exercises` must be an array, else Import shows an error. Everything else is treated as optional/prose. Be careful adding strict validation — a slightly-off programme should still open in the gym rather than hard-fail.

### Weeks: materialised in v2, a template in v1

**v2 — every week is authored.** `program.json` carries one exercise row per day *per week*.
The app filters by **day and week**, so selecting Week 4 shows Week 4's actual prescription.
`build_program_json.py` exits non-zero if any week in `1..meta.weeks` has no rows, so a
partial programme cannot reach the app *by accident* — it can still be produced deliberately
with `--allow-partial-weeks`, which prints a warning. If you meet a v2 file with gaps, that
flag is why.

**v1 — Week 1 was a template.** Later weeks lived as prose inside each `progression` field.
The app filtered by **day only**, ignoring `week`, and showed a banner past the highest
authored week telling the athlete to apply the progression rule themselves. This is what
caused load and RPE drift in practice (the app showed front squats in a week that called for
low-bar), and is the reason for v2.

**The app keeps both paths**, and must, while a v1 programme may still be sitting in
`localStorage` on a phone. The rule is implemented in exactly two functions: `isV2()` decides,
`dayExercises()` filters — day **and** week for v2 with no banner, day only for v1 with the
banner. Import of either version succeeds; a returning athlete is never locked out mid-block.
Keep new schema checks out of the rendering code and inside those two.

---

## Output: `session-<date>-<day>.json` (schema `tp-session-2`)

Filename pattern: `session-2026-07-27-day-1-mon-clean-skill-front-squat-knee-capacity.json` (date, then a slugged day label). Saved into `athlete/<athleteId>/logs/`.

```json
{
  "schema": "tp-session-2",
  "block": "Hybrid CrossFit Athleticism - Block 1",
  "athlete": "Jacques",
  "athleteId": "jacques",
  "week": 2,
  "day": "Day 1 (Mon) - Clean Skill + Front Squat + Knee Capacity",
  "date": "2026-07-27",
  "exportedAt": "2026-07-27T17:42:10.001Z",
  "tracking": {
    "painLabel": "Knee",
    "painPerExercise": true,
    "painNextMorning": true,
    "readiness": true,
    "sleep": true,
    "bodyweight": true,
    "hrvNote": true,
    "perSetLogging": true
  },
  "session": {
    "bodyweightKg": "88",
    "sleep": "4",
    "readiness": "Green",
    "hrvNote": "HRV 62, at baseline",
    "amPainNextDay": "2",
    "overall": "Felt strong; front squat depth better with the wedge."
  },
  "entries": [
    {
      "exercise": "Hang power clean (EMOM every 90s)",
      "prescribed": { "sets": "7", "reps": "2", "load": "50-70 kg; technically crisp", "rpe": "RPE 5-6" },
      "done": true,
      "load": "65 kg",
      "reps": "7x2",
      "rpe": "6",
      "painDuring": "2",
      "notes": "Bar path stayed close; no knee response.",
      "sets": []
    },
    {
      "exercise": "Heel-elevated front squat - top set",
      "prescribed": { "sets": "4", "reps": "4", "load": "~100 kg", "rpe": "RPE 7" },
      "done": true,
      "load": "80",
      "reps": "4x4",
      "rpe": "7",
      "painDuring": "3",
      "notes": "First set overshot; dropped 20 kg and it settled.",
      "sets": [
        { "set": 1, "load": "100", "reps": "4", "rpe": "9", "painDuring": "3", "note": "too heavy" },
        { "set": 2, "load": "80",  "reps": "4", "rpe": "7", "painDuring": "3", "note": "" },
        { "set": 3, "load": "80",  "reps": "4", "rpe": "7", "painDuring": "2", "note": "" }
      ]
    }
  ]
}
```

### Per-set logging (`entries[].sets`) — new in v2

`sets` is an **array of per-set rows**, present on every entry (`[]` when the athlete logged
only the summary). It exists because the first set often lands at the wrong RPE and the rest
are adjusted — v1 flattened that into one number plus a free-text note, so the coach could not
see which set was which.

| Key | Notes |
|---|---|
| `set` | 1-based set number, and always contiguous from 1 — a `set: 3` means a third set was actually performed. |
| `load`, `reps`, `rpe`, `painDuring` | Same meaning as the flat fields, for this set alone. Strings; `""` when not logged. |
| `note` | Free text for this set. Usually empty. |

**The flat `load` / `reps` / `rpe` / `painDuring` stay, and stay authoritative for the summary
view.** They are not derived — the app keeps them as what the athlete considers the headline
number for the exercise, and a v1 reader that ignores `sets` still gets a sensible answer.
When they disagree with `sets` (as above: flat `load: "80"`, first set `100`), the flat value
is the athlete's own summary, not a bug.

**How the app produces `sets`.** Per-set rows are opt-in per exercise — tapping "Log each set"
materialises the prescribed number of rows, and a value typed into one row flows down into
every row below it that the athlete has not edited. So the common case (all sets the same)
costs one entry per field, and correcting set 3 downwards costs one more. Rows that are
left completely empty are dropped at export and the rest renumbered, so a `set: 3` in a log
file always means a third set was actually performed. The whole feature can be switched off
per device in the Tracked-fields sheet, which shows up as `tracking.perSetLogging: false`.

**Reading rule for the coach:** use `sets` when it is non-empty — it is strictly more
information. Fall back to the flat fields when `sets` is `[]` or absent (any v1 file). Do not
average `sets` into a single load; the shape of a session (100 → 80 → 80) *is* the signal.

Programme-side prescriptions stay one-load-per-exercise: `tp-program-2` has no per-set array.
Ramping sets are expressed in the `load` string as they always were ("60/70/80 kg"). Add a
prescribed per-set array only if that stops being expressive enough.

### Field notes

- `tracking` — **additive; added when optional fields became switchable in the app's
  Tracked-fields sheet.** It disambiguates an empty value: `painDuring: ""` with
  `tracking.painPerExercise: true` means *no pain logged*, whereas `false` means *this
  athlete does not track pain at all*. Without it the coach cannot tell silence from
  absence. Older session files predate the key — treat a missing `tracking` as all-true.
  - `painLabel` is the body part the athlete named (`"Knee"`, `"Shoulder"`, or `""` for a
    generic "Pain"). It affects labels only; the stored keys never change.
  - **The keys in `session` and `entries[]` never change shape**, whether a field is
    switched on or not — the review step never has to probe for missing keys.
  - A value logged *before* a field was switched off is still exported as-is. The app does
    not rewrite history; `tracking` is what tells you it is no longer being collected.
- `entries[].category` — present only if the programme declared one (see `tp-program-2`; no generator emits it yet).
  Presentational; it is passed through so a session file stays self-contained.
- `session.readiness` — one of `""`, `"Green"`, `"Amber"`, `"Red"`.
- `session.sleep` — 1–5 subjective scale (string).
- `session.amPainNextDay` — next-morning knee pain 0–10. Deliberately editable the day *after* training; the athlete re-opens the session and exports then. **This field is the single most important input to the coach's tendon decisions** (see `docs/athlete-context.md`). Switchable, but on by default; check `tracking.painNextMorning` before concluding anything from an empty value.
- `painDuring` — per-exercise knee pain 0–10 during the movement. Switchable via `tracking.painPerExercise`.
- `athleteId` — **v2.** Slug from `program.json`'s `meta.athleteId`, naming the `athlete/<slug>/logs/` folder this file belongs in. Two athletes exporting into the same Drive folder is otherwise only distinguishable by the human-readable `athlete` name. Absent in v1 files.
- Everything the athlete typed is a **string** (straight from inputs); unfilled fields are `""`, never `null`. The numbers in these files are only the ones the app computes: top-level `week`, and `sets[].set`. On the programme side, `meta.weeks` and `exercises[].week` are likewise numbers. Never assume a prescription string parses numerically.
- `prescribed` is denormalised into each entry on purpose, so a session file is self-contained and reviewable without the original programme.
- `entries` covers every exercise for that day, including untouched ones (`done: false`, empty values) — the coach needs to see what was skipped.

### Consumer expectations (the review step)

The coach reads the newest `athlete/<slug>/logs/*.json` and compares logged load/reps/RPE against `prescribed`, checks `painDuring` and `amPainNextDay` against the pain-monitoring rules, reads `readiness`/`sleep` for the autoregulation call, and then recommends the smallest effective adjustment. Keep that in mind before dropping any field.

**Read `schema` first**, then `tracking`, then the entries.

- `schema` tells you whether `sets[]` exists. Both `tp-session-1` and `tp-session-2` must be
  readable; a block spans the boundary.
- **`tracking`**: if `painPerExercise`/`painNextMorning` are `false`, the pain-monitoring rules
  simply don't apply to that athlete — absent pain data is a configuration choice, not a
  missing log or a clean week.
- Review the athlete whose folder the file is in. `athleteId` (v2) confirms it; a file that
  landed in the wrong folder is a filing mistake, not a licence to apply another athlete's
  loading rules.
