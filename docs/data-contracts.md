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

- `session.readiness` — one of `""`, `"Green"`, `"Amber"`, `"Red"`.
- `session.sleep` — 1–5 subjective scale (string).
- `session.amPainNextDay` — next-morning knee pain 0–10. Deliberately editable the day *after* training; the athlete re-opens the session and exports then. **This field is the single most important input to the coach's tendon decisions** (see `docs/athlete-context.md`).
- `painDuring` — per-exercise knee pain 0–10 during the movement.
- Every value is a **string** (straight from inputs). Unfilled fields are `""`, not `null`.
- `prescribed` is denormalised into each entry on purpose, so a session file is self-contained and reviewable without the original programme.
- `entries` covers every exercise for that day, including untouched ones (`done: false`, empty values) — the coach needs to see what was skipped.

### Consumer expectations (the review step)

The coach reads the newest `logs/*.json` and compares logged load/reps/RPE against `prescribed`, checks `painDuring` and `amPainNextDay` against the pain-monitoring rules, reads `readiness`/`sleep` for the autoregulation call, and then recommends the smallest effective adjustment. Keep that in mind before dropping any field.
