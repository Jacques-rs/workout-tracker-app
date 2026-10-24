# PLAN — gym instruments (branch `feat/gym-instruments` only)

**This file is temporary.** It lives on this branch and is deleted in the last commit before
merge. Anything durable it decides moves to its owner first (see *Landing* at the bottom).
It must not reach `dev`.

## Scope

| # | Piece | Status |
|---|---|---|
| A | Previous-session detail: tap "last time" to see every set | build first, no platform risk |
| S | Spike: what an installed iPhone PWA actually does with timers, wake lock and sound | gates B and C |
| B | Rest countdown with an end-of-rest cue | after S |
| C | Interval / EMOM timer | after S |
| D | Share sheet on export | optional, last |

Out of scope: restore from backup (not needed now), one-tap "same as last week" (A replaces
it: show the numbers, don't copy them), per-exercise trends (roadmap #5).

---

## A. Previous-session detail

**Problem.** The rail shows one line, `Set 3 last time  80 × 5`. The athlete wants the whole
previous session for the exercise: every set's load, reps, RPE and pain, plus notes.

**Which session counts as "previous".** One function, `previousFor(ex, date)`, answers this
for both the rail and the sheet, so they can never show different sessions:

1. The **same programme day in the previous week** of the same block (`day` equal, `week − 1`),
   if that session logged this exercise. That is the comparable session for progression.
2. Otherwise the most recent earlier session that logged it. That is today's
   `lastLoggedFor()`: id first, then normalised name, so it still works across blocks.

Rule 1 matters when an exercise appears on two days a week. Today the rail shows Thursday's
numbers on Monday, when last Monday's are the ones to beat.

**Interaction.**
- `lastTimeNode()` becomes a button. It keeps the quiet styling: never green, never amber
  (design-rationale: "last time" is a fact, not a target). Its touch target must be at least
  26px, and the rail must not grow taller at 320px.
- Tapping it opens a sheet through `sheetOpen()`:
  - **Header:** the date, `Week n · Day X`, and how long ago (`agoWords`).
  - **That week's prescription:** read from `dateProgram()` for *that* date, never from
    `PROGRAM`, because exercise ids repeat across blocks and loads progress week to week.
  - **One row per set:** `set · load × reps(unit) · RPE · pain`. A field that is switched off
    renders nowhere. A set's note goes under its row.
  - **The exercise's summary and notes**, if any.
- **Read-only, zero inputs, no "use these" button.** Nothing is copied into the draft. That
  is the no-surprises rule, and the reason A replaces roadmap #2.
- Circuit exercises show rounds (`Round n · result`) instead of sets.
- With no previous session the rail stays silent, as it does today, so there is nothing to tap.

**Tests (`samples/apptest.js`).**
- `previousFor` picks last week's same day over a more recent other day.
- It falls back to the most recent session when last week's same day has no entry for the
  exercise.
- It matches across blocks by name.
- It returns nothing for a date with no history.
- The sheet has no `input`, `textarea` or `select`.
- No pain column renders when the pain field is switched off.
- The sheet's prescription comes from the earlier date's programme.

---

## S. Spike: verify before promising (gates B and C)

The roadmap has the right warning: a timer is worthless if it stops when the screen locks.
Check each item on the real phone, as an **installed home-screen PWA**, on current iOS:

1. Does a `setInterval` repaint stop while the screen is locked? (Expected: yes.) Does the
   derived display correct itself on unlock? (It should, by construction.)
2. Does the Screen Wake Lock API work in standalone mode? Does it survive switching apps and
   coming back? Re-acquire it on `visibilitychange`.
3. Does a Web Audio beep (generated with an oscillator, no audio file, no network) play in
   the foreground after a user tap? Does the silent switch mute it?
   `navigator.audioSession.type = "playback"` may change that.
4. `navigator.vibrate`: expected to do nothing on iOS. Confirm, then treat haptics as an
   Android-only bonus.
5. Can anything signal at end of rest **while locked**? Expected: no. There are no scheduled
   notifications without push, and push is out of scope. If so, the design rule becomes "keep
   the screen on while a timer runs" and never "alert in the background".

**Where the spike runs.** It needs HTTPS, so it has to be a page Pages serves. Proposal: a
throwaway `spike-timer.html`. It goes on `dev` only for the test, is never in the `sw.js`
shell list, and is removed in the next commit. *Decision needed.*

Write the results into this file. They decide B's and C's cue design.

---

## B. Rest countdown

**Invariant kept:** there is still no timer state. The display stays derived from
`lastSetAt`, so a reload, a locked screen or a killed PWA cannot corrupt it.

- **While inside the prescribed rest** (`parseRestSeconds()` > 0): count **down** in amber,
  e.g. `1:12 left`.
- **At zero:** flip to a quiet count-up, `+0:15`. This answers the rationale's objection to "a
  countdown that expires and then means nothing": it never expires, it just changes sign.
- **No prescribed rest:** the current count-up, unchanged.
- **Cue:** one short beep, plus vibration where supported, fired by the repaint tick when it
  sees the moment of crossing zero (`0 ≤ sec − target < 2`). It needs no "already cued" flag,
  and a reload long after zero stays quiet. It only fires in the foreground.
- **The cue is a device-scoped setting** in `DEVICE_KEYS`, next to the rest clock, because it
  is about where you are standing. *Default on or off? Decision needed.*

**Changes to an existing rule:** design-rationale's "passive: no sound, no buzz" paragraph
gets rewritten when this lands. The new rule: sound is opt-in, foreground-only, and needs no
permission.

**Tests:** the countdown and count-up text on each side of the target; the cue predicate fires
exactly once across a run of ticks; the cue predicate stays false after a simulated reload past
the target.

---

## C. Interval / EMOM timer

**Formats in real programmes:** `rest: "EMOM / 90 sec"` and `reps: "45 sec hard / 75 sec easy"`.
`parseInterval(ex)` returns `{work, rest, period, rounds}` or null. Rounds come from the sets
target. Anything it cannot parse gets a manual **Set up timer** sheet with work, rest and
rounds steppers.

**Same invariant as the rest clock:**
- The only state is `timer: {startedAt, spec}` on the exercise entry. It autosaves, and the
  named whitelist in `buildSessionPayload()` keeps it out of the export.
- Round, phase and time remaining are all derived from `now − startedAt`, so the timer survives
  a lock, a reload and a killed PWA.
- **Pause** would add `pausedAt` and an accumulated `pausedMs`. *v1 or not? Decision needed.*
  The recommendation is start/stop only. An EMOM you pause is not an EMOM.

**UI.**
- The timer takes the rest clock's place in the instrument rail while it runs, so the rail
  stays one row high.
- Work phase in amber ("now"), rest phase muted, with `Round 3 / 8` beside it.
- Start and Stop are quiet actions, not amber, so they don't compete with Log.
- **Screen Wake Lock** is held while the timer runs, released on Stop, Finish or when the
  timer completes, and re-acquired on `visibilitychange`, subject to S.
- Cues on phase boundaries: the same beep as B, under the same setting, foreground only.

**Logging: the timer never logs.** A round boundary may make the existing round or Log
action more prominent, but committing still takes a tap (no-surprises rule).
`commitCircuitRound()` and `commitSet()` are untouched.

**Stretch (C2): a hold stopwatch** on `Hold (s)` and `Time (min)` fields. It shows the elapsed
time, and **Use 0:45** writes it into the field only on that tap. It stays out of v1 unless
it's nearly free once C exists.

**Tests:** `parseInterval` on every `rest` and `reps` string in both fixtures, plus negatives
(`"As needed"`, `"-"`, prose); round and phase derived across boundaries; the export payload
never contains `timer`.

---

## D. Share on export (optional)

In `downloadSessionPayload()`: when `navigator.canShare({files})` is true, offer the share
sheet. Otherwise, or if sharing is cancelled or fails, fall back to the current download.
`markExported()` still runs only once a file has actually been produced or shared. One
commit; delete roadmap #6 when it lands.

---

## Order of commits

1. A: `previousFor` and tests, then the sheet, then the rail button. 320px overflow check.
2. S: the spike, its results written up here, then the spike page removed.
3. B, then C, each with tests, a `CACHE` bump and the light-theme + 320px manual pass.
4. D if wanted.
5. **Landing commit:** move the durable facts out, delete this file.

## Landing — where the durable facts go

- `docs/roadmap.md`: delete #1 (timer) and #2 ("same as last week", superseded by A). Delete
  #6 if D ships. Add C2 as an entry if it doesn't ship.
- `docs/design-rationale.md`: rewrite the rest clock paragraph (B). Add why "previous" means
  last week's same day first (A).
- `docs/architecture.md`: the instrument rail, the `timer` session field, and any new
  section banner.
- `CLAUDE.md`: probably nothing. The "repaint, don't rebuild" and "amber means now" rules
  already cover it. Only an invariant that is genuinely new earns a line, within budget.
- `samples/README.md`: the test inventory, if new suites are added.
- `sw.js`: a `CACHE` bump with every shell change.

## Open decisions for Jacques

1. Rule 1 for "previous" (same day last week first): agree?
2. Beep default: on or off?
3. Spike page temporarily on `dev`: OK?
4. Timer pause in v1: yes or no? (Recommendation: no.)
5. Should a round boundary make the Log action more prominent, or stay silent visually too?
