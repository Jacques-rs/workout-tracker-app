# Data contracts

Two JSON shapes cross the boundary between this app and the coaching project. **These are the integration surface — changing them requires changing the generator/consumer on the other side too.**

- `tp-program-2` — **input.** Produced by the `program-builder` skill; consumed by this app.
- `tp-session-3` — **output.** Produced by this app; consumed by the `review-workout-log` skill.

The two sides version independently. Older files still exist on disk — an already-imported
programme on a phone, and session logs exported under every earlier schema — so **every reader
must accept every version it has ever emitted**. What changed:

| | | |
|---|---|---|
| `tp-program-1` → `-2` | Week 1 only; later weeks as prose in `progression` | → every week authored as real rows; `progression` demoted to rationale |
| `tp-session-1` → `-2` | one load/reps/RPE per exercise | → adds a per-set `sets[]` array; flat fields stay as the summary |
| `tp-session-2` → `-3` | `amPainNextDay`, filled by re-opening yesterday's session | → `amPainOnWaking`, filled at check-in; adds `programVersion` |

Version detection is `meta.schema` / `schema`. Neither reader should infer version from the
presence of a field.

**No schema change since `tp-session-3`.** The app has since learned to read the prescription
more closely — what the reps field measures, whether work is ordinary sets or a circuit, and
which circuit format needs live round taps versus one final result — but every one of those is
**inference from strings the generator already writes**. No field was added, removed or retyped on either side, and
`program-builder` needs no matching change. Where that inference changes how a value should be
*read*, it is written down below: see `reps` and `logHint` in the programme table, and
"Reading a logged `reps` value" on the session side.

---

# The contract

The tables below are **normative**: they say which fields must exist, what type they are, and
which side owns each one. Everything after them is the *why* — the reasoning, the history and
the reading rules. If the two ever disagree, the tables win and the prose is stale.

**Owner** is the side that decides a field's value. The other side reads it and must not
invent, correct or recompute it.

- **skill** — written by `program-builder`. The app treats it as given.
- **app** — written by the app at export. The coaching side treats it as given.
- **athlete** — typed by a human into the app. Free text; never assume it parses.

**Required** means a reader may assume the key is present *for that schema version*. Anything
else must be handled when missing — the last column of each optional table gives the actual
fallback, not a suggestion.

Note the asymmetry between the two sides. A programme is hand-authored, so a field can be
genuinely absent. **A session file is machine-written and never omits a key** — the app merges
every entry against a blank template at export, so on the session side "optional" means the
*value* may be `""`, not that the key may be missing. That is why the review step never has to
probe.

`program-builder` enforces the input table via its own `scripts/validate_program.py`, which runs on the
assembled programme before the file is written. **The app enforces almost none of it, on
purpose** — a slightly-off programme must still open in a gym basement rather than hard-fail in
front of an athlete who came to train. That leniency is only safe because something upstream is
strict. Do not move the strictness into the app.

## `tp-program-*` — required

| Field | Type | v1 | v2 | Owner | Notes |
|---|---|---|---|---|---|
| `meta.block` | string | ✅ | ✅ | skill | Block name; shown in the header, copied to every export. |
| `meta.athlete` | string | ✅ | ✅ | skill | Display name. |
| `meta.athleteId` | slug | — | ✅ | skill | Names `athlete/<slug>/`. **v1: absent — slugify `meta.athlete`.** |
| `meta.weeks` | number | ✅ | ✅ | skill | Block length; drives the week selector 1..N. |
| `meta.days` | string[] | ✅ | ✅ | skill | **Ordered.** Drives the day selector. Labels must be byte-identical wherever they appear. |
| `meta.schema` | string | ✅ | ✅ | skill | `tp-program-1` \| `tp-program-2`. Read this first; never infer the version. |
| `exercises[].id` | string | ✅ | ✅ | skill | **Unique across the whole file.** The key logged data is stored under in `localStorage`. |
| `exercises[].day` | string | ✅ | ✅ | skill | Must equal a `meta.days` entry **exactly** — the filter is string equality. |
| `exercises[].name` | string | ✅ | ✅ | skill | Non-empty. |
| `exercises[].week` | number | ignored | ✅ | skill | **v2: load-bearing** — the app renders only the selected week. v1 ignores it. |

## `tp-program-*` — optional

| Field | Type | Owner | If absent |
|---|---|---|---|
| `meta.version` | number ≥1 | skill | Treated as **`0`**, not `1` — the app does not invent a revision number it cannot know. Shown as `· v<N>` in the header (silent when `0`) and stamped into every export as `programVersion`. |
| `meta.generated` | string | skill | No effect. |
| `exercises[].sets`, `reps`, `load`, `rpe`, `tempo`, `rest` | **string** | skill | Renders empty. **Never numbers** — they hold ranges and prose (`"8-10 min"`, `"~115-135 kg"`). |
| `exercises[].logHint` | string | skill | No blue "Log:" line. |
| `exercises[].focus`, `progression` | string | skill | Section collapsed/absent. |
| `exercises[].category` | string | skill | Guessed from `name`; no tag if nothing matches. Purely presentational — nothing filters or gates on it. |

## `tp-session-*` — required

The app writes these **unconditionally** — no key is omitted because a value is empty or a
field was switched off. So "required for v3" here means *always present in a v3 file*, and a
reader never has to probe.

| Field | Type | v1 | v2 | v3 | Owner | Notes |
|---|---|---|---|---|---|---|
| `schema` | string | ✅ | ✅ | ✅ | app | `tp-session-1` \| `-2` \| `-3`. Read first. |
| `block`, `athlete` | string | ✅ | ✅ | ✅ | skill→app | Copied from `meta`, unchanged. |
| `athleteId` | slug | — | ✅ | ✅ | skill→app | From `meta.athleteId`, else slugged from `meta.athlete`. Names the `athlete/<slug>/logs/` folder. **Can be `""`** if the programme had neither. |
| `programVersion` | number | — | — | ✅ | app | `meta.version` of the programme trained off. **`0`** = the programme predates versioning. |
| `week`, `day`, `date` | number/string | ✅ | ✅ | ✅ | app | What was trained, and when. |
| `exportedAt` | ISO string | ✅ | ✅ | ✅ | app | |
| `tracking` | object | — | ✅ | ✅ | app | Which optional fields this device collects. **Absent = treat as all-true.** |
| `session` | object | ✅ | ✅ | ✅ | athlete | Check-in block. Always present, always with every key — merged from a blank template at export. |
| `entries[]` | array | ✅ | ✅ | ✅ | app | **Every** exercise for the day, including untouched (`done: false`). Skips are data. |
| `entries[].exercise` | string | ✅ | ✅ | ✅ | app | Entries are keyed by name, not `id` — so the v1→v2 id change does not affect logs. |
| `entries[].prescribed` | object | ✅ | ✅ | ✅ | skill→app | Denormalised so a log is reviewable without the programme. |
| `entries[].done` | bool | ✅ | ✅ | ✅ | athlete | |
| `entries[].sets[]` | array | — | ✅ | ✅ | athlete | Ordinary sets or completed circuit rounds. `[]` when nothing was logged, or when a circuit was logged as one final result. Contiguous from 1. |

## `tp-session-*` — value-optional

Every key below **always exists** in a file of the right version; what varies is whether it
holds anything. `""` means *not logged*; the matching `tracking` flag is what tells you whether
it is *not collected*. Distinguishing those two is the whole reason `tracking` exists.

| Field | Type | Owner | Empty means |
|---|---|---|---|
| `session.*`, `entries[].load`/`reps`/`rpe`/`painDuring`/`notes` | **string** | athlete | `""`, never `null`. Check `tracking` before reading silence as a clean week. |
| `session.amPainOnWaking` | string | athlete | **v3.** Describes the **previous** session — see the dedicated section. v1/v2 carry `amPainNextDay`, a *different morning*. |
| `entries[].category` | string | skill→app | Only present if the programme declared one. Passed through so a log stays self-contained. |

**The only numbers the app writes** are `week`, `programVersion` and `sets[].set`. On the
programme side, `meta.weeks` and `exercises[].week`. Everything else is a string, including
every prescription — never assume one parses numerically.

**Keys never disappear.** Switching a field off in the Account screen's Tracked fields section flips a
`tracking` flag; the key stays and its value is `""`. That is what lets a reader tell *not logged* from
*not tracked*, and it means the review step never probes for missing keys.

---

## Input: `program.json` (schema `tp-program-2`)

```json
{
  "meta": {
    "block": "Hybrid CrossFit Athleticism - Block 1",
    "athlete": "Jacques",
    "athleteId": "jacques",
    "weeks": 6,
    "version": 1,
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
| `meta.version` | **Optional.** Revision number of this programme: `1` on the initial build, +1 each time `review-workout-log` revises a week mid-block. It exists so a `program.json`, its archived copy in `revisions/program-v<N>.json` and its `CHANGELOG.md` entry line up. The app reads it in exactly one place, `progVersion()`, which shows it as `· v<N>` in the header and stamps it into every export as `programVersion` — so a log states which revision it was trained off. **A file with no `version` reads as `0`, not `1`:** the app stays silent rather than claiming a revision number it cannot know. Nothing about rendering or filtering depends on it. |
| `meta.athleteId` | **v2.** Lowercase slug of `meta.athlete`, matching the `athlete/<slug>/` folder. Passed through to the session export so a log file identifies its athlete without relying on the filename. Absent in v1 — fall back to slugging `meta.athlete`. |
| `exercises[].id` | Unique per exercise **across the whole file**. v2 convention `w<week>d<daySlot>e<exerciseIndex>`, where `daySlot` is the number in the `Day N` label (`Day 3` → `d3`), falling back to position in `meta.days` if the labels aren't distinctly numbered. v1 was `d<dayIndex>e<exerciseIndex>`. **This is the key the app stores logged data under** — the v1→v2 id change means logs recorded against a v1 programme do not line up with the v2 one. Expected and accepted at the version boundary; exported session files are unaffected because they denormalise `prescribed` and are keyed by exercise name. |
| `exercises[].week` | **v2: load-bearing.** The app renders only the exercises whose `week` matches the selected week. In v1 it was ignored. |
| `exercises[].day` | Must match a string in `meta.days` **exactly** — the app filters by string equality. Day labels must be byte-identical across weeks, or a day will look empty in some weeks. |
| `sets`/`reps`/`load`/`rpe`/`tempo`/`rest` | **All strings, not numbers.** They hold ranges and prose ("1 + 3", "8-10 min", "~115-135 kg", "RPE 6-6.5"). Never assume they parse as numeric. **`sets` also drives the set-at-a-time logger**: a plain integer, a plain numeric range (`"3-4"`, lower bound used), or an integer followed by a word (`"4 rounds"` → 4) materialises that many set chips; anything else — `"AMRAP"`, `"1 + 3"`, a decorated range like `"8-10 min"` — collapses to a single "Set 1 of 1", which is the correct shape for open-ended work. Prefer a plain integer when the exercise really is N even sets. |
| `reps` | **Also decides what the logging field asks for**, via the app's `metricOf()`: seconds → `Hold (s)`, minutes → `Time (min)`, metres → `Dist (m)`, calories → `Work (cal)`, a plain count or range → `Reps`, and anything composite (`"45 sec hard / 75 sec easy"`, `"5 TnG power cleans + 15/12 cal bike"`) → a free-text `Result`. This is **inference from the string the generator already writes** — no new field, and nothing to change upstream. It only affects the label, the placeholder, the on-screen keyboard, and the unit appended to the logged summary; see the session-side note below. Writing `"45 sec"` rather than `"45s"` or `"0:45"` is the safest form, but all three resolve. |
| `logHint` | Comes from the spreadsheet's "Completed Notes" column. It tells the athlete which data actually matters for this movement, and the app now **parses it** rather than just printing it: split on semicolons into a row of `Capture` chips (four at most), and scanned for pain cues (`pain`, `sore`, `stiff`, `response`, a named joint…) to decide which exercises get an accented pain field and a one-off nudge on Finish. Nothing is ever *hidden* on the strength of it. Semicolons are therefore load-bearing punctuation — `"Top load; RPE-1; knee pain during + next AM"` reads as three instructions, and a `+` inside one stays part of it. Empty string for warm-ups. |
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

### Where validation happens — generator strict, app lenient

Two checks, deliberately unequal.

**The app checks almost nothing.** `meta` must exist and `exercises` must be an array, else
Import shows an error. Everything else is treated as optional prose. Be careful adding strict
validation here — a slightly-off programme should still open in the gym rather than hard-fail
in front of an athlete who came to train.

**The generator checks everything**, because that is where a failure is cheap: it costs a
rebuild, not a session. `program-builder/scripts/validate_program.py` runs over the assembled
programme **before the file is written**, so a contract-breaking `program.json` never reaches
disk for the athlete to import.

```bash
python3 athlete/skills/program-builder/scripts/validate_program.py program.json
python3 samples/validatortest.py     # fixtures pass; every known breakage is rejected
```

| | |
|---|---|
| **ERROR** (exit 1, blocks the write) | The app will visibly do the wrong thing: a missing required field, a wrong type, a `day` not in `meta.days`, duplicate ids, a v2 week with no rows. |
| **WARNING** (printed, never fatal) | Plausibly deliberate but usually an authoring slip: a week missing one day, no `logHint` anywhere, no `category` declared, a v1 file, an `exercises[].sets` with no digit in it. |

Note the division of labour with `rows_common.load_rows`, which validates the builder's
**input**. They answer different questions, and the second cannot be folded into the first: a
`rows.json` can be perfectly well-formed and still assemble into a programme the app
mishandles — an id collision, a day label that drifts by one space between weeks, a `--weeks`
count that disagrees with the rows. Those only exist once the file is a programme.

The one relaxation is `--allow-partial-weeks`, which downgrades "week N has no exercises" to a
warning and nothing else. If you meet a v2 file with gaps, that flag is why.

**Adding a rule to the validator is a change to this document too.** The app is the other party
to the contract; a rule enforced upstream but written down nowhere is just a build that fails
for reasons no one can look up.

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

### Revisions mid-block

A block gets adjusted while it is running — that is the point of the review step. The
convention on the coaching side (owned by the `review-workout-log` skill, not by the app):

- The superseded `program.json` is archived to `revisions/program-v<N>.json` **before** the new
  one is written, alongside the `rows.json` it was built from.
- `meta.version` increments; `CHANGELOG.md` in the block folder records the date, what changed
  and **why**.
- The athlete re-imports. **This is a manual step with no prompt.** Until they do, the app is
  showing a superseded prescription and is not wrong to — it has no way to know.

**What the app must do about all this: almost nothing.** `version` is additive — the app
displays it and passes it through to the export, and nothing else keys off it. Importing a
revised programme is an ordinary import, and logged data keyed by exercise `id` survives as long
as the ids are stable — which they are, because they are derived from week, day slot and
position. Reordering or inserting exercises within a revised day *does* shift the ids below the
change, and logs already recorded against those ids will land on the wrong exercise. Prefer
substituting an exercise in place over reordering a day mid-block.

**How a reader detects a stale log:** compare the log's `programVersion` against the current
`meta.version` — one integer comparison. On a `tp-session-1` or `-2` log the field does not
exist; fall back to diffing the log's denormalised `prescribed` values against the current
`program.json` for that week and day, and if they differ the athlete trained off an earlier
revision.

---

## Output: `session-<date>-<day>.json` (schema `tp-session-3`)

Filename pattern: `session-2026-07-27-day-1-mon-clean-skill-front-squat-knee-capacity.json` (date, then a slugged day label). Saved into `athlete/<athleteId>/logs/`.

```json
{
  "schema": "tp-session-3",
  "block": "Hybrid CrossFit Athleticism - Block 1",
  "athlete": "Jacques",
  "athleteId": "jacques",
  "programVersion": 3,
  "week": 2,
  "day": "Day 1 (Mon) - Clean Skill + Front Squat + Knee Capacity",
  "date": "2026-07-27",
  "exportedAt": "2026-07-27T17:42:10.001Z",
  "tracking": {
    "painLabel": "Knee",
    "painPerExercise": true,
    "painOnWaking": true,
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
    "amPainOnWaking": "2",
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
view.** The app derives them from committed rows until the athlete edits the summary directly;
after that it preserves the override. A v1 reader that ignores `sets` still gets a sensible answer.
When they disagree with `sets` (as above: flat `load: "80"`, first set `100`), the flat value
is the athlete's own summary, not a bug.

**How the app produces `sets`.** An ordinary exercise starts with the prescribed set count and
shows exactly one set editor at a time. Confirming a set appends one row and seeds the next
editor from it. Adding or removing planned sets is a secondary action and never changes the
original prescription. Completely empty rows are dropped at export and the rest are renumbered,
so a `set: 3` in a log file always means a third set or circuit round was actually performed.

**Reading rule for the coach:** for ordinary exercises, use `sets` when it is non-empty — it
is strictly more information. Fall back to the flat fields when `sets` is `[]` or absent (any
v1 file). Do not average `sets` into a single load; the shape of a session (100 → 80 → 80) *is*
the signal. Circuit entries are the explicit exception described below: their flat result and
round rows are complementary.

**How the app fills these fields** (no schema change is involved — this is behaviour, not shape):

- `sets` is normally non-empty for any ordinary exercise actually trained, because the app logs
  one set at a time. For a circuit prescription, `[]` can instead mean the athlete chose
  **Final result** and logged the outcome directly in the flat fields.
- The flat `load`/`reps`/`rpe`/`painDuring` are **auto-filled from `sets` as each one is confirmed
  and stay editable.** They remain the athlete's own headline number and a reader must not
  recompute them, but a disagreement with `sets` most often means a *deliberate override* —
  worth a line in the review rather than skipped.
- **`sets.length` is the number of sets actually performed.** The export contains only committed
  sets: a draft the app seeded from the previous set is not a set that happened, and a set the
  athlete typed but never confirmed is committed on their behalf when they finish the exercise,
  page away, change day or week, leave for Overview, export, or background the app — so it lands
  in the file rather than vanishing.
- RPE may carry a half point (`"7.5"`); the picker offers 1–10 in 0.5 increments. Stored as a
  string, and legacy prose values remain readable — parse as a float if at all, never an integer.
- `tracking.perSetLogging` is unconditionally `true`: it is not a switch, it is how every exercise
  is logged. `false` appears in older files and keeps its meaning there.

### Circuit logging (`rounds`, `AMRAP`, `EMOM`, `for time`, ladders)

The app chooses a low-friction default from `prescribed.sets`, with a quiet mode override:

- A fixed `"4 rounds"` prescription defaults to **Quick rounds**. Each tap appends one
  `sets[]` row whose `reps` is `"As prescribed"`; the denormalised `prescribed.reps` contains
  the movements that phrase refers to. The flat `reps` becomes a headline such as
  `"4 rounds · 12:34"`.
- **Round details** also uses `sets[]`, but each row may carry its own split/result, changed
  load, RPE, pain and note.
- AMRAP, EMOM, for-time work and numeric ladders default to **Final result**. These can export
  `sets: []` with the outcome in flat `reps`, for example `"4 rounds + 12 reps"`,
  `"12 min completed"`, or `"Time 08:42 · as prescribed"`.

For a circuit, never discard the flat `reps` merely because `sets[]` is non-empty: the rows
say which rounds were completed or how they differed, while the flat field carries the final
round count/time/partial work. `"As prescribed"` is explicit confirmation of one complete
round, not missing data. The UI's selected logging mode is local bookkeeping and is never
exported.

### Reading a logged `reps` value

Unchanged in shape — a string, whatever the athlete typed — but worth knowing how the app now
labels the field, because it changes what the string means without changing its type:

| `prescribed.reps` | The field the athlete saw | A logged `reps` of `"45"` means | Summary shape |
|---|---|---|---|
| `"2"`, `"4-6"`, `"6/side"` | `Reps` | 45 reps | `"7x2"` |
| `"45 sec"`, `"20-30 sec/side"` | `Hold (s)` | 45 **seconds** | `"3x45s"` |
| `"8-10 min"` | `Time (min)` | 45 **minutes** | `"9min"` |
| `"20 m"` | `Dist (m)` | 45 **metres** | `"6x20m"` |
| `"15/12 cal"` | `Work (cal)` | 45 **calories** | `"15cal"` |
| anything composite | `Result` (free text) | whatever it says | as typed |

So **read the unit off `prescribed.reps`**, exactly as before — that is what makes the log
self-contained. The only difference is that the app's own derived summary now appends the unit
(`"3x45s"` rather than `"3x45"`), so a duration is no longer mistakable for a rep count at a
glance. Per-set `sets[].reps` values stay bare, as typed. Still never assume either parses
numerically, and note that a `Result` field is prose by design.

Programme-side prescriptions stay one-load-per-exercise: `tp-program-2` has no per-set array.
Ramping sets are expressed in the `load` string as they always were ("60/70/80 kg"). Add a
prescribed per-set array only if that stops being expressive enough.

### Field notes

- `tracking` — **additive; added when optional fields became switchable in the app's
  Tracked fields section, which is now account-scoped rather than device-local.** It disambiguates an empty value: `painDuring: ""` with
  `tracking.painPerExercise: true` means *no pain logged*, whereas `false` means *this
  athlete does not track pain at all*. Without it the coach cannot tell silence from
  absence. Older session files predate the key — treat a missing `tracking` as all-true.
  - `painLabel` is the body part the athlete named (`"Knee"`, `"Shoulder"`, or `""` for a
    generic "Pain"). It affects labels only; the stored keys never change. It follows the
    athlete's *account*, so the same block logged on a second device carries the same
    label — the export shape is unchanged either way.
  - **The keys in `session` and `entries[]` never change shape**, whether a field is
    switched on or not — the review step never has to probe for missing keys.
  - A value logged *before* a field was switched off is still exported as-is. The app does
    not rewrite history; `tracking` is what tells you it is no longer being collected.
- `entries[].category` — present only if the programme declared one (see `tp-program-2`; no generator emits it yet).
  Presentational; it is passed through so a session file stays self-contained.
- `session.readiness` — one of `""`, `"Green"`, `"Amber"`, `"Red"`.
- `session.sleep` — 1–5 subjective scale (string).
- `session.amPainOnWaking` — **v3**, replacing `amPainNextDay`. Pain 0–10 on waking *this* morning, i.e. the response to the **previous** session. Switchable via `tracking.painOnWaking`, on by default. See the dedicated section below before reading one.
- `painDuring` — per-exercise knee pain 0–10 during the movement. Switchable via `tracking.painPerExercise`, and **only** via that: the app accents the field's label on exercises whose `logHint` asks for a reading, and nudges once if one is finished without it, but it never renders the field on some exercises and not others. An empty `painDuring` therefore means the same thing on every entry in the file — *not logged* — which is exactly what `tracking` is for. Do not read an accented-vs-plain distinction out of a log; it does not exist there.
- `athleteId` — **v2.** Slug from `program.json`'s `meta.athleteId`, naming the `athlete/<slug>/logs/` folder this file belongs in. Two athletes exporting into the same Drive folder is otherwise only distinguishable by the human-readable `athlete` name. Absent in v1 files.
- Everything the athlete typed is a **string** (straight from inputs); unfilled fields are `""`, never `null`. The numbers in these files are only the ones the app computes: top-level `week`, `programVersion`, and `sets[].set`. On the programme side, `meta.weeks` and `exercises[].week` are likewise numbers. Never assume a prescription string parses numerically.
- `prescribed` is denormalised into each entry on purpose, so a session file is self-contained and reviewable without the original programme.
- `entries` covers every exercise for that day, including untouched ones (`done: false`, empty values) — the coach needs to see what was skipped.

### Morning pain: `amPainOnWaking` — new in v3, and it replaced a field

`session.amPainOnWaking` is the pain score **on waking the morning of this session**, captured at
check-in before anything is logged. For a tendon block it is the single most important number in
the file.

It replaced `session.amPainNextDay` (and `tracking.painNextMorning` became `tracking.painOnWaking`)
because the old field asked for a reading that only exists *after* the session is over: the
athlete trains in the morning, feels the 24h response the following morning, and by then has to
remember to re-open a closed session via the date picker and export it a second time. In
practice it arrived empty — and an empty tendon reading is indistinguishable from a good one.
Same measurement, asked at the one moment the app is already open.

**The attribution flips, and that is the whole risk.**

> `amPainOnWaking` on Tuesday's log describes the response to **Monday's** session, not Tuesday's.

A reader that treats it like the old `amPainNextDay` will pin every reading on the wrong session
and conclude the exact opposite of the truth about a progression. **Attribute by date gap**,
against the previous log for that athlete:

| Days since the previous log | How to read it |
|---|---|
| 1 | The 24h response to that session. This is the decision-grade reading. |
| more than 1 | A **current baseline**, not attributable to any one session — rest days in between mean nobody was asked on the morning that mattered. Use it for the week-over-week trend, not to judge a single exposure. |
| no previous log (first of a block) | Baseline only. |

That gap is accepted rather than engineered away: a standalone rest-day check-in would mean a
second export shape for the coaching side to handle, to capture a reading that is usually less
decision-relevant than the trend it feeds.

**Reading the older schemas.** `tp-session-1` and `-2` files carry `amPainNextDay` and are still
on disk, mid-block. Prefer `amPainOnWaking` when present; fall back to `amPainNextDay`; and
remember the two describe **different mornings** — never merge them into one series without
shifting the older one by a day.

### `programVersion` — new in v3

Integer. The `meta.version` of the programme the app had loaded when the session was logged, so a
log states which revision it was actually trained off. `0` means the programme predates the
revision convention — the app does not invent a `1` it cannot know.

It exists because re-importing after a revision is a manual step with no prompt (see "Revisions
mid-block"). Before this field the only way to detect an athlete training off a superseded week
was to diff the log's denormalised `prescribed` values against the current `program.json` — which
works, and is still the fallback for older logs, but is inference. Now it is a direct comparison
against `meta.version`.

### Consumer expectations (the review step)

The coach reads the newest `athlete/<slug>/logs/*.json` and compares logged load/reps/RPE against `prescribed`, checks `painDuring` and the morning pain field against the pain-monitoring rules, reads `readiness`/`sleep` for the autoregulation call, and then recommends the smallest effective adjustment. Keep that in mind before dropping any field. That step is the `review-workout-log` skill in `athlete/skills/` — its `SKILL.md` is the authoritative description of how these files are read.

**Read `schema` first**, then `tracking`, then the entries.

- `schema` tells you which fields exist. `tp-session-1`, `-2` and `-3` must all be readable; a
  block spans the boundaries. v1 has no `sets[]`; v1 and v2 have `amPainNextDay` rather than
  `amPainOnWaking`, and the two describe **different mornings**.
- **`tracking`**: if `painPerExercise` / `painOnWaking` (or `painNextMorning` on an older file)
  are `false`, the pain-monitoring rules simply don't apply to that athlete — absent pain data is
  a configuration choice, not a missing log or a clean week.
- **`programVersion`** against the current `meta.version` answers "did they train off this
  programme?" in one comparison. On a v1/v2 log the field is absent — fall back to diffing
  `prescribed`.
- Review the athlete whose folder the file is in. `athleteId` (v2) confirms it; a file that
  landed in the wrong folder is a filing mistake, not a licence to apply another athlete's
  loading rules.

## Account portability file (`tp-account-export-1`)

This is deliberately not a coaching contract and cannot be imported or restored. It is an
owner-access export with `schema`, `exportedAt`, an `account` identity, cloud `programmes` (including
30-day tombstones), cloud `sessions` (canonical and conflicts), and `device` state for the current
installation (`activeProgram`, position, settings, local sessions and dirty sync queue). It must not
contain Supabase sessions/tokens, the installation owner marker, credentials, or any `tp_demo_*`
data. Sanitized examples belong in `samples/`; real exports must never be committed.
