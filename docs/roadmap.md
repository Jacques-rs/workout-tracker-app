# Roadmap & known gaps

Ordered roughly by value-per-effort. Each item says *why*, because the guiding principle is that reliability and speed in the gym beat extra features.

## Done — Plan A (schema v2), both halves

Week-aware filtering, per-set logging, `tp-session-2` export and `athleteId` pass-through all
shipped; the bundled `program.json` is now a 6-week `tp-program-2` sample. Left deliberately
undone, and worth knowing:

- **The `sets[]` prescription stays one load per exercise.** Ramping sets are still expressed
  in the `load` string ("60/70/80 kg"). Only add a prescribed per-set array if that stops
  being expressive enough — it doubles the generator's surface.
- ~~**Per-set rows are opt-in, not shown by default.**~~ **Superseded — see "Set-at-a-time
  logging" below.** Opt-in per-set rows turned out to be the wrong shape entirely, not just
  the wrong default: rendering every prescribed row at once was what caused the
  focus-loss-while-typing bug, and an opened-but-unfilled row exported as a set that was
  never performed. Logging is now one set at a time for every exercise, with no opt-in.
- **No cross-week comparison in-app yet.** See "Session history / trend view" below — now
  more useful than it was, because week-over-week prescriptions are real data rather than
  prose.

Test both `samples/program.sample.json` and `samples/program.v2.sample.json` after any change
to import, filtering or export, and run `node samples/apptest.js`.

## Done — Plan B (review skill + versioning + schema v3)

**Coaching side.** `athlete/skills/review-workout-log/` closes the loop: it reads a log, compares
it against the prescription for that week and day, proposes the smallest effective adjustment
behind an approval gate, and on approval archives the old revision, bumps `meta.version` and
records the reason in the block's `CHANGELOG.md`. `--version` was added to
`build_program_json.py`.

**App side (`tp-session-3`).** Next-morning pain became a pre-session reading: `amPainNextDay`
→ `amPainOnWaking`, `tracking.painNextMorning` → `tracking.painOnWaking`, captured at check-in
and rendered first in the card. A hard replace — the old field is gone rather than deprecated.
Exports also carry `programVersion`, and the header shows `v<N>` beside the block name.

Two things left deliberately undone, and worth knowing:

- **A rest day loses the reading.** The pre-session field is only captured on days the athlete
  trains, so the morning after a session followed by a rest day is never recorded. Accepted
  rather than engineered around: a standalone rest-day check-in means a second export shape for
  the coaching side to handle, for a reading that is usually less decision-relevant than the
  trend it feeds. The review skill compensates by attributing readings by **date gap** — one day
  is a response, more is a baseline. See `docs/data-contracts.md`.
- **No migration of old values.** Anything typed into `amPainNextDay` and not yet exported was
  dropped at the rename. Copying it over would have mis-attributed it by a day.

## Done — UI overhaul (drawer + focus view)

The header had grown to five rows — block name, progress, week and date selectors, a day tab
strip, the day title — and the check-in card sat above the first exercise on every screen. All
of it was permanently visible, and none of it changes once a session has started. It now sits
on three surfaces: a two-row header (context line, date, progress), `<main>` for exercise cards
only, and a drawer for week / day / date / check-in / import-export / settings.

`<main>` also gained a second view: **focus**, one exercise at a time, with `‹ Prev / n / N /
Next ›` in the footer and a numbered pip per exercise in the header. Both views rendered the
same `exerciseCard()`, and the choice was remembered per device (`tp_settings_v1.view`),
defaulting to the original all-exercises view.

*(Superseded — see "Done — set-at-a-time logging" above. The all-exercises view became the
read-only Overview and the focus view became the Log editor; they no longer share one card
builder, since one is read-only and one is an editor. The default flipped to Log, with a
one-shot migration so an existing install follows rather than opening on a screen with no
inputs.)*

Decisions worth knowing, and where to push back if they turn out wrong in the gym:

- **Marking done in the focus view advances to the next exercise.** Forward only, never on
  un-marking. It is the only automatic navigation in the app; a mis-tap costs one tap of Prev.
- **The day picker went from tabs to a list in the drawer.** Switching day is now two taps
  instead of one, bought for a full-width row per day that can show the session theme rather
  than a truncated weekday. If day-switching turns out to be frequent, the header context line
  is the place to put it back.
- **A dot on the ≡ while the check-in is empty**, cleared by any value. The check-in being
  behind a tap is the whole point, but a tendon block cannot afford a silently-skipped
  morning reading — see `tp-session-3` above.
- **Export lives in the footer only in the all-exercises view**, and always in the drawer.
- **No swipe gestures.** Horizontal swipe would collide with the pip strip and with text
  fields; Prev/Next and the pips are unambiguous. Arrow keys work on a desktop browser.

Three layout bugs were fixed on the way past, all pre-existing: the per-set block was a child
of the log grid with no `grid-column`, so it rendered in one ~90px column; a long RPE string
("RPE 7 (use RPE-1 to set load)") inherited the hero's `nowrap` and wrapped the exercise name
one word per line; and the check-in's three-column grid was gated on viewport width, which is
meaningless now it lives in a 400px drawer.

## Done — honest set state, metric-aware fields, and a control pass

Five things reported from actual gym use, and what they turned out to be:

- **"The reps field only takes numbers."** It was `inputmode="numeric"` — a digits-only keypad
  on iOS — while **72 of the 180 rows** in the real programme prescribe a duration, a distance
  or prose. `metricOf()` now reads the prescription and the one field becomes `Hold (s)` /
  `Time (min)` / `Dist (m)` / `Work (cal)` / `Reps` / `Result`, with the matching keyboard and
  the prescription as its placeholder. No schema change: the unit is inferred from a string the
  generator already writes, and `deriveReps()` appends it so a hold reads `"3x45s"`.
- **"Clicking a future set number removes those sets."** It did, with no confirmation, on a
  chip that reads as "jump to set 4". Upcoming chips are inert placeholders now and the planned
  count now lives behind an explicit **Adjust sets** action, floored at the current set.
- **"No clear indication a set has been logged; sometimes Overview shows none."** Two causes.
  A commit changed almost nothing on screen (the next draft is seeded from the set just
  logged) — so there is now a `LOGGED 60×4 · 60×4` recap line, a toast, a chip pulse and a
  haptic. And the old finish action discarded a typed-but-unconfirmed set entirely: it set `done` without
  committing the draft, so the export, the pips and the Overview status all said the set never
  happened. `flushDraft()` closes that on early end, navigation, view change, export and
  backgrounding. Overview now always renders one of six status lines plus a `○ / ◐ / ✓` badge.
- **"The app should infer from the programme whether knee pain needs logging."** It reads
  `logHint`: split into a row of `Capture` chips, and scanned for pain cues to accent the pain
  field and nudge when the exercise ends. The drawer offers the site the block actually monitors.
  Deliberately **prompting, not hiding** — see below.
- **"The buttons don't feel premium."** One height scale, one full-width primary with the
  cards' own light-from-above treatment, the quieter actions at equal width on their own
  non-wrapping row, tabular numerals, and the set editor moved above the collapsibles so the
  primary action is reachable without scrolling on a 390px screen.

Decisions worth knowing, and where to push back:

- **The pain field is never hidden per exercise.** Accenting it where the programme asks is
  free; rendering it on some exercises and not others would make an empty `painDuring`
  ambiguous — `tracking.painPerExercise` promises the coach that empty means *not logged*.
  Hiding it would need a per-entry flag in the export, which is a schema change for a
  cosmetic win.
- **`flushDraft()` is not auto-logging.** Only a draft the athlete has actually typed into
  (`draft.dirty`) is committed; a seeded copy of the previous set is never one. `sets.length`
  still means sets performed.
- **Every flush must be followed by a re-render** — it writes through a session object read
  fresh from storage, and a stale card on screen would autosave over it. See
  `docs/architecture.md`.
- **320px still needs a scroll to reach the primary action** on an exercise with a long prose
  prescription. 390px (every current iPhone) fits without one. Fixing 320 properly would mean
  truncating prescription text, which is worse.
- **No hold timer and no rest countdown**, though both were designed and costed — see below.

## High value

**1. Interval / EMOM timer — including the hold and rest cases deliberately left out above.**
The programme leans on EMOM and interval formats ("EMOM every 90s", "45 sec hard / 75 sec easy", "2 min hard / 1 min easy"). Right now the athlete uses a separate timer app, which means leaving the tracker mid-session. An in-app timer that reads the `rest`/`reps` strings (or is set manually) would remove the one reason to switch apps. Must keep running with the screen locked or backgrounded if possible — verify behaviour before promising it.

Two smaller pieces of this were specified during the metric-field work and **deferred on
purpose**, because they share that verification problem and it is the whole risk: (a) a
stopwatch on a `Hold (s)`/`Time (min)` field, where stopping writes the elapsed seconds into
the field, and (b) a rest countdown seeded from `rest` that starts when a set is logged. Both
are cheap to draw and worthless if they stop counting when the screen locks, so they belong
with this item rather than ahead of it.

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
Today: export downloads a file, then the athlete saves it into the Drive folder via the share sheet. A "share" button using the Web Share API or a whole-week export could shorten that flow before accounts ship. Account-backed programme and log storage is now being planned separately; see `docs/backend-launch-plan.md` rather than extending this roadmap item with backend decisions.

**6. `localStorage` housekeeping.**
Old `tp_sess_v1::*` keys accumulate forever. Harmless at this volume, but a "clear sessions older than N months" action (after backup) keeps things tidy.

**7. Week-aware exercise filtering.** — **done**, both sides.

## Lower value / speculative

**8. Set-by-set logging.** — **done** as `tp-session-2`, reshaped into the default logging flow — see "Done — set-at-a-time logging" above. The earlier "probably not worth it" call was wrong in one specific case: when the first set lands at the wrong RPE and the rest are dropped (100 → 80 → 80), flattening to one load loses the shape of the session, which is exactly what the coach reasons about. The original opt-in-per-exercise shape traded that for a focus-loss bug and a UI that looked unfinished on the screen that should scan fastest; every exercise now logs one set at a time by default instead.

**9. Plate calculator.** Nice-to-have; the athlete is advanced and does this arithmetic automatically.

**10. Multiple programmes side by side. — done in the account profile.** The private cloud library
holds multiple programmes and activates one at a time. `tp_program_v1` deliberately remains the
single offline workout cache; session autosave does not need to know the library exists.

## Done — set-at-a-time logging, a read-only Overview, and three fixed defects

The all-in-one card put a full logging form on every exercise, which made the one screen
that should let you scan the session the most crowded one in the app — and the opt-in
per-set table (above) rendered every prescribed row at once, which was the direct cause of
the reported "RPE field escapes after one character" bug: a keystroke's redraw destroyed
the input being typed into. Both are gone. `<main>` is now Overview (read-only — tap a card
to open it) and Log (one exercise, one set at a time, with a row of chips for the sets
already logged). Two more reported defects were fixed in the same pass: the screen jumping
while typing (`paintNav()` was scrolling the pip strip on every keystroke in the whole app,
not just on navigation) and a refresh landing back on Week 1 (the fix for this already
existed but had shipped without a `sw.js` cache bump, so it never reached an installed
phone).

Decisions worth knowing:

- **The flat load/reps/RPE/pain fields are auto-filled from the sets and stay editable** —
  no schema bump, because `tp-session-3` already defined them as "the athlete's own summary,
  never recomputed", and that stayed literally true. A disagreement with `sets[]` now more
  often means a deliberate correction than an independent judgement call.
- **Skipping/ending is always offered**, even with zero sets logged or fewer than prescribed —
  cutting a set short for pain is exactly the signal the coach wants. The newer logging pass
  makes those two cases explicit and confirms what will be retained.
- **RPE moved to a finite picker** (1–10 in 0.5 steps), so a gym log needs one tap and never
  opens the keyboard. The stored string contract did not change.
- **Per-set logging is no longer switchable.** The `Tracked fields` toggle for it is gone;
  `tracking.perSetLogging` is stamped `true` unconditionally for reader compatibility.

## Done — lower-cognitive-load workout logging

- The prescribed number of ordinary sets is available by default, with one set visible at a
  time. **Log final set** completes and advances; extra/missed sets are handled by Adjust sets,
  Reopen, or the completion toast's Add set action.
- The ambiguous finish-early wording is gone. Untouched work says **Skip exercise**; partial
  work says **End after N of M**; both explain the consequence before changing state.
- Every RPE capture uses the reusable bottom-sheet picker, including set edits, summaries and
  circuit finishes.
- Circuit prescriptions are recognised from the existing programme strings. Fixed rounds use
  one-tap counting by default; AMRAP/EMOM/for-time/ladders ask for their natural final result.
  Quick rounds, Round details and Final result remain available as a quiet override.
- The `tp-session-3` wire shape is unchanged. Quick/detailed circuit rounds use `sets[]`; final
  result mode uses the flat fields. The review skill reads these two circuit representations
  explicitly instead of mistaking `sets: []` for an empty workout.

## Tracked separately

Accounts, private programme storage and cloud-backed logs are approved as an offline-first staged
release in `docs/backend-launch-plan.md`; keep its product and security decisions out of this feature
backlog. Analytics, a framework rewrite, an app-store native build, coach roles and public sharing
remain deferred.

## Housekeeping reminders

- Bump `CACHE` in `sw.js` whenever a shell file changes.
- Keep `program.json` in the repo as a **sample** only — never a real programme, never real logs.
- Re-check the JSON contracts in `docs/data-contracts.md` if either side of the loop changes.
