# Roadmap & known gaps

Ordered roughly by value-per-effort. Each item says *why*, because the guiding principle is that reliability and speed in the gym beat extra features.

## Done — Plan A (schema v2), both halves

Week-aware filtering, per-set logging, `tp-session-2` export and `athleteId` pass-through all
shipped; the bundled `program.json` is now a 6-week `tp-program-2` sample. Left deliberately
undone, and worth knowing:

- **The `sets[]` prescription stays one load per exercise.** Ramping sets are still expressed
  in the `load` string ("60/70/80 kg"). Only add a prescribed per-set array if that stops
  being expressive enough — it doubles the generator's surface.
- **Per-set rows are opt-in, not shown by default.** The plan floated pre-rendering the
  prescribed rows on every card; that trades the common case (all sets identical, one tap)
  for the rare one. Revisit only if the athlete finds themselves opening it most sessions.
- **No cross-week comparison in-app yet.** See "Session history / trend view" below — now
  more useful than it was, because week-over-week prescriptions are real data rather than
  prose.

Test both `samples/program.sample.json` and `samples/program.v2.sample.json` after any change
to import, filtering or export, and run `node samples/apptest.js`.

## High value

**1. Interval / EMOM timer.**
The programme leans on EMOM and interval formats ("EMOM every 90s", "45 sec hard / 75 sec easy", "2 min hard / 1 min easy"). Right now the athlete uses a separate timer app, which means leaving the tracker mid-session. An in-app timer that reads the `rest`/`reps` strings (or is set manually) would remove the one reason to switch apps. Must keep running with the screen locked or backgrounded if possible — verify behaviour before promising it.

**2. "Prefill from last time" per exercise.**
Most logged values barely change week to week. Showing last session's actual load/reps/RPE as placeholder text (or a one-tap "same as last week") would cut logging time significantly. The data is already in `localStorage` — this is mostly a lookup across session keys.

**3. Backup / restore all data.**
Everything lives in `localStorage`. There is currently no way to snapshot it. A single "Export all data" (and matching import) protects against a cleared browser, a lost phone, or storage eviction. **Risk worth verifying:** browsers can evict storage for sites that go unused; installed PWAs are generally more durable, but a periodic backup is the cheap insurance either way.

**3b. Emit `category` from `program-builder`.** *(Deliberately not done in the schema-v2 pass — it needs a 14th spreadsheet column, and that churn was worth keeping separate from the weeks change.)*
The exercise cards colour-code by category (skill / strength / conditioning / tendon work).
Neither `tp-program-1` nor `tp-program-2` emits one, so the app currently *guesses* from the exercise name — it
is correct on the present sample, but it is inference, and a renamed exercise can silently
change colour. Adding an optional `category` per exercise in the generator replaces the
guess with a declaration. Cheap on both sides, and the app already prefers the declared
value and degrades to no-tag when it can't tell. See `docs/data-contracts.md`.

## Medium value

**4. Session history / trend view.**
A simple list of past sessions, and per-exercise history (load and RPE over weeks, plus the knee-pain trend). The pain trend is genuinely decision-relevant — "no upward trend week over week" is one of the coaching rules — so surfacing it in-app would let the athlete self-correct before the coach review.

**5. Reduce the export→save friction.**
Today: export downloads a file, then the athlete saves it into the Drive folder via the share sheet. Options, in increasing effort: (a) a "share" button using the Web Share API so it goes straight to Files/Drive; (b) exporting a whole week in one file; (c) real cloud sync via the Drive API, which would mean credentials and a backend — explicitly rejected so far.

**6. `localStorage` housekeeping.**
Old `tp_sess_v1::*` keys accumulate forever. Harmless at this volume, but a "clear sessions older than N months" action (after backup) keeps things tidy.

**7. Week-aware exercise filtering.** — **done**, both sides.

## Lower value / speculative

**8. Set-by-set logging.** — **done** as `tp-session-2`. The earlier "probably not worth it" call was wrong in one specific case: when the first set lands at the wrong RPE and the rest are dropped (100 → 80 → 80), flattening to one load loses the shape of the session, which is exactly what the coach reasons about. The added-taps objection was answered by making it opt-in per exercise and seeding each new row from the previous one, so the normal case is unchanged.

**9. Plate calculator.** Nice-to-have; the athlete is advanced and does this arithmetic automatically.

**10. Multiple programmes side by side.** Only one programme is stored (`tp_program_v1`). Fine for a linear block structure; would only matter if running two blocks at once.

## Explicitly not doing

Accounts, multi-user, a backend, analytics, a framework rewrite, an app-store native build. All rejected: they add maintenance and failure modes to a tool whose main virtue is that it opens instantly and works with no signal.

## Housekeeping reminders

- Bump `CACHE` in `sw.js` whenever a shell file changes.
- Keep `program.json` in the repo as a **sample** only — never a real programme, never real logs.
- Re-check the JSON contracts in `docs/data-contracts.md` if either side of the loop changes.
