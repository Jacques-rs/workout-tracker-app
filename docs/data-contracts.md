# Data contracts

Two JSON shapes cross the boundary between this app and the coaching project. **These are the integration surface — changing them requires changing the generator/consumer on the other side too.**

- `tp-program-1` — **input.** Produced by the `program-builder` skill; consumed by this app.
- `tp-session-1` — **output.** Produced by this app; consumed by the AI coach at review time.

---

## Input: `program.json` (schema `tp-program-1`)

```json
{
  "meta": {
    "block": "Hybrid CrossFit Athleticism - Block 1",
    "athlete": "Jacques",
    "weeks": 6,
    "generated": "2026-07-25",
    "days": [
      "Day 1 (Mon) - Clean Skill + Front Squat + Knee Capacity",
      "Day 2 (Tue) - Jerk Skill + Upper Strength + Gymnastics + Aerobic Power"
    ],
    "schema": "tp-program-1"
  },
  "exercises": [
    {
      "id": "d1e3",
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
| `meta.weeks` | Populates the week selector (1..N). |
| `exercises[].id` | Unique per exercise. Convention `d<dayIndex>e<exerciseIndex>`. **This is the key the app stores logged data under** — if IDs change between programme versions, existing logs won't line up. |
| `exercises[].day` | Must match a string in `meta.days` **exactly** — the app filters by string equality. |
| `sets`/`reps`/`load`/`rpe`/`tempo`/`rest` | **All strings, not numbers.** They hold ranges and prose ("1 + 3", "8-10 min", "~115-135 kg", "RPE 6-6.5"). Never assume they parse as numeric. |
| `logHint` | Comes from the spreadsheet's "Completed Notes" column. Rendered as the blue "Log:" line — it tells the athlete which data actually matters for this movement. Empty string for warm-ups. |
| `focus` | Coaching cues (spreadsheet "Focus / Notes"). Collapsed by default. |
| `progression` | Per-week plan and hold/stop gate (spreadsheet "Progression Rule"). Collapsed by default. |
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

### Important current behaviour: weeks are a template

`program.json` currently carries **Week 1 only**, with later weeks described in prose inside each `progression` field. The app therefore:

- filters exercises by **day only**, ignoring `week`;
- uses the week selector for labelling and for keying saved sessions;
- shows a banner when the selected week exceeds the highest authored `week`, telling the athlete to apply the progression rule.

If the generator later authors every week explicitly, the app's filter must become day **and** week. See `docs/roadmap.md`.

---

## Output: `session-<date>-<day>.json` (schema `tp-session-1`)

Filename pattern: `session-2026-07-27-day-1-mon-clean-skill-front-squat-knee-capacity.json` (date, then a slugged day label).

```json
{
  "schema": "tp-session-1",
  "block": "Hybrid CrossFit Athleticism - Block 1",
  "athlete": "Jacques",
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
    "hrvNote": true
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
      "notes": "Bar path stayed close; no knee response."
    }
  ]
}
```

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
- `entries[].category` — present only if the programme declared one (see `tp-program-1`).
  Presentational; it is passed through so a session file stays self-contained.
- `session.readiness` — one of `""`, `"Green"`, `"Amber"`, `"Red"`.
- `session.sleep` — 1–5 subjective scale (string).
- `session.amPainNextDay` — next-morning knee pain 0–10. Deliberately editable the day *after* training; the athlete re-opens the session and exports then. **This field is the single most important input to the coach's tendon decisions** (see `docs/athlete-context.md`). Switchable, but on by default; check `tracking.painNextMorning` before concluding anything from an empty value.
- `painDuring` — per-exercise knee pain 0–10 during the movement. Switchable via `tracking.painPerExercise`.
- Every value is a **string** (straight from inputs). Unfilled fields are `""`, not `null`.
- `prescribed` is denormalised into each entry on purpose, so a session file is self-contained and reviewable without the original programme.
- `entries` covers every exercise for that day, including untouched ones (`done: false`, empty values) — the coach needs to see what was skipped.

### Consumer expectations (the review step)

The coach reads the newest `logs/*.json` and compares logged load/reps/RPE against `prescribed`, checks `painDuring` and `amPainNextDay` against the pain-monitoring rules, reads `readiness`/`sleep` for the autoregulation call, and then recommends the smallest effective adjustment. Keep that in mind before dropping any field.

**Read `tracking` first.** If `painPerExercise`/`painNextMorning` are `false`, the
pain-monitoring rules simply don't apply to that athlete — absent pain data is a
configuration choice, not a missing log or a clean week.
