# Development fixtures

Fake data for testing the app. **Never real training data** — see `athlete/README.md`.

| File | Schema | Use it to test |
|---|---|---|
| `program.sample.json` | `tp-program-1` | A Week-1-only programme already on a phone. Day-only filtering, progression banner past week 1. |
| `program.v2.sample.json` | `tp-program-2` | Every week authored. Day **and** week filtering, no banner. Loads step +2.5 kg per week so switching weeks is visibly different. 4 weeks × 2 days. Its `meta.athleteId` is deliberately `fixture-slug`, which is **not** what slugging `meta.athlete` would give — otherwise a test could not tell the `athleteId` field from the v1 name-slugging fallback. Its `meta.version` is deliberately **3**, for the same reason: a test expecting `1` would also pass against a hard-wired value. |
| `session.sample.json` | `tp-session-1` | A log with **no `sets[]` and no `tracking`** — a file exported before either existed. The coach path must still read it, treating missing `tracking` as all-true. |
| `session.v2.sample.json` | `tp-session-2` | Per-set logging. One entry (`Heel-elevated front squat - top set`) has `sets[]` with a 100 → 80 → 80 drop and a flat `load` of `80`; every other entry has `sets: []`. Carries `athleteId` and `tracking`, and the retired `session.amPainNextDay` / `tracking.painNextMorning` pair. |
| `session.v3.sample.json` | `tp-session-3` | The current export. Same session as the v2 file so the two diff cleanly, but with `session.amPainOnWaking` / `tracking.painOnWaking` in place of the next-morning pair, and a `programVersion`. Its waking score (4) is deliberately **not** the v2 file's next-morning score (2) — they measure different mornings, and a reader that treats them as the same field shows up as a wrong number rather than a passing test. Updated for the set-at-a-time logger: every entry now carries a populated `sets[]` (the now-normal shape), one exercise (`Hang power clean`) has a half-point RPE (`"6.5"`) to exercise float parsing, and `Backward sled drag` is `done: false` with 4 of 6 sets logged — an exercise stopped early, not one that was skipped. |

All versions are kept on purpose: the app has to import either programme version without
breaking, because a v1 programme can be sitting in `localStorage` on a phone mid-block, and
the coaching side has to read every session version because logs from all three are already
on disk. Test both programme fixtures after any change to import, filtering, or export.

## Dependency-free tests

| File | Direction it checks |
|---|---|
| `apptest.js` (node) | Account-first entry, isolated sample storage, and the app reading a **good** programme correctly: week filtering, per-set round-trip and export shape. |
| `authtest.js` / `profiletest.js` (node) | Authentication ownership/access states and the profile UI's loading, signed-out, authenticated, offline, library and conflict behavior. |
| `programstoretest.js` (node) | Private programme list/import/activate/remove behavior, including local-first offline import retry, session identity matching and soft deletion. |
| `sessionstoretest.js` (node) | Device-first queue persistence, programme ordering, revision updates, natural-key collision handling, recoverable conflicts, backfill and offline history. |
| `settingsstoretest.js` (node) | Account-scoped settings: the per-field last-write-wins merge, the offline queue, and no network at all as a guest. |
| `accountdatatest.js` (node) | The account portability snapshot: what it includes, and that credentials, the owner marker and demo keys are excluded. |
| `swtest.js` (node) | App-shell caching and the cross-origin authentication/Data API boundary. |
| `validatortest.py` (python3) | The builder refuses to emit a **bad** one: every fixture passes `validate_program.py`, and every known single-mutation breakage is rejected. The case count is printed by the test, not recorded here. |

`validatortest.py` mutates `program.v2.sample.json` one field at a time — a duplicate id, a
`day` not in `meta.days`, a `load` emitted as a number, a week with no rows. The negative cases
are the point: a validator that passes everything is worse than no validator, because it buys
false confidence. Add a case there whenever you add a rule to `validate_program.py`.

Edit these files directly — they are hand-maintained, not generated. **Keep the v1 files exactly
as they are: their value is being old.**
