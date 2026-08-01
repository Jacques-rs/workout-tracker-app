# Development fixtures

Fake data for testing the app. **Never real training data** — see `athlete/README.md`.

| File | Schema | Use it to test |
|---|---|---|
| `program.sample.json` | `tp-program-1` | A Week-1-only programme already on a phone. Day-only filtering, progression banner past week 1. |
| `program.v2.sample.json` | `tp-program-2` | Every week authored. Day **and** week filtering, no banner. Loads step +2.5 kg per week so switching weeks is visibly different. 4 weeks × 2 days. Its `meta.athleteId` is deliberately `fixture-slug`, which is **not** what slugging `meta.athlete` would give — otherwise a test could not tell the `athleteId` field from the v1 name-slugging fallback. |
| `session.sample.json` | `tp-session-1` | A log with **no `sets[]` and no `tracking`** — a file exported before either existed. The coach path must still read it, treating missing `tracking` as all-true. |
| `session.v2.sample.json` | `tp-session-2` | Per-set logging. One entry (`Heel-elevated front squat - top set`) has `sets[]` with a 100 → 80 → 80 drop and a flat `load` of `80`; every other entry has `sets: []`. Carries `athleteId` and `tracking`. |

Both versions are kept on purpose: the app has to import either without breaking, because a
v1 programme can be sitting in `localStorage` on a phone mid-block. Test both after any change
to import, filtering, or export.

The v2 fixtures were derived from the v1 ones by hand, not by a script, so they are not
byte-comparable — `program.v2.sample.json` is a shorter block (4 weeks) with stepped loads so
that switching weeks in the app is *visibly* different, which a mechanical copy wouldn't give
you. Edit them directly, and keep the v1 files as they are: their value is being old.
