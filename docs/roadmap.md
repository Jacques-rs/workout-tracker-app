# Roadmap & known gaps

**Only what is not built.** Nothing here records completed work — when something ships, its
entry is deleted, not annotated. Ordered roughly by value-per-effort, and each item says *why*,
because reliability and speed in the gym beat extra features.

## Medium value

**1. Per-exercise trend view.** Load and RPE over weeks, plus the pain trend. "No upward trend
week over week" is one of the coaching rules, so surfacing it in-app would let the athlete
self-correct before the coach review. The past-sessions *list* is not part of this — the hub and
the calendar already are that.

**2. A timer for what the parser cannot read.** The interval timer appears only when the
prescription states an EMOM period or a work/rest pair, which covers every interval row today. A
"Set up timer" sheet (work, rest, rounds) would cover a hand-written or unusual format.

**3. `localStorage` housekeeping.** `tp_sess_v1::*` keys accumulate forever. Harmless at this
volume, but a "clear sessions older than N months" action — after a backup — keeps it tidy.

**4. Log an earlier block's session late.** The claim picker offers the weeks of the block that
owns the date, so the old block's last session, done on the new block's first Monday, can only be
claimed by moving the new block's start. A "from the previous block" choice in the picker, shown
only in a block's first week or two, would cover it.

## Lower value / speculative

Sessions sync to the account, so a saved file is a secondary copy, not the backup — which is why
the restore item sits here.

**5. Restore from a backup.** Account → Your data → Save a copy of everything produces a complete `tp-account-export-1`
file, but nothing reads one back. Cheap insurance against evicted storage on a device that never
synced.

**6. Plate calculator.** The athlete does this arithmetic automatically.

## Deferred on purpose

Each of these is a real feature with a cost worth naming, not an oversight.

- **Off-programme workouts** (a pickup session, a race, a swim). A workout with no `(week, day)`
  and no prescribed rows means either `tp-session-3` grows a variant or `review-workout-log`
  receives a session it cannot compare against. Worth doing; worth not doing accidentally.
- **Rest-day notes.** A rest day offers the next session and the claim picker. A place to write
  "travelled, walked 8km" is small, but needs a store that can never be mistaken for a workout.
- **A structured per-day weekday.** The reader already accepts `{label, weekday}` day entries;
  emitting them is a `program-builder` change and must land in lockstep.
- **A prescribed per-set array.** Ramping sets stay in the `load` string ("60/70/80 kg"). Only
  add one if that stops being expressive enough — it doubles the generator's surface.
- **Swipe gestures.** Horizontal swipe collides with the pip strip and with text fields.
  Prev/Next and the pips are unambiguous; arrow keys work on a desktop browser.
- **Analytics, a framework rewrite, a native app-store build, coach roles beyond the one-way
  coach link, shared or team accounts, public programme discovery, subscriptions, live
  collaborative editing, and any server-side AI call.** None are in scope for a personal invite-only tool.

## Accepted limitations

- **320px needs one scroll** to reach the primary action on an exercise with a long prose
  prescription. 390px — every current iPhone — fits without one. Fixing 320 properly means
  truncating prescription text, which is worse.
- **A rest day loses the morning reading.** `amPainOnWaking` is captured only on days the athlete
  trains, so the morning after a session followed by a rest day is never recorded. A standalone
  rest-day check-in means a second export shape for a reading that matters less than the trend it
  feeds; `review-workout-log` compensates by attributing readings by date gap.
