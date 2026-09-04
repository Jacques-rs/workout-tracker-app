# Roadmap & known gaps

**Only what is not built.** Nothing here records completed work — when something ships, its
entry is deleted, not annotated. Ordered roughly by value-per-effort, and each item says *why*,
because reliability and speed in the gym beat extra features.

## High value

**1. Interval / EMOM timer.** The programme leans on interval formats ("EMOM every 90s",
"45 sec hard / 75 sec easy"), so the athlete uses a separate timer app and leaves the tracker
mid-session. A timer that reads the `rest`/`reps` strings, or is set by hand, removes the one
reason to switch apps. Two smaller pieces belong with it rather than ahead of it: a stopwatch on
a `Hold (s)`/`Time (min)` field that writes elapsed seconds into the field, and an **active rest
countdown** seeded from `rest`, with sound or haptics. All three are cheap to draw and worthless
if they stop counting when the screen locks — **verify background behaviour before promising
any of them.** That verification is the whole risk and the reason this has not been started.

**2. One-tap "same as last week".** The logger already shows last session's load/reps/RPE
(`lastTimeNode()`) and seeds each draft from the previous set, so the lookup exists. What is
missing is the single tap that accepts it outright.

**3. Restore from a backup.** `Export account data` produces a complete `tp-account-export-1`
file, but nothing reads one back. Without restore, the export protects against a lost phone only
if it is re-entered by hand. Browsers can evict storage for unused sites; installed PWAs are more
durable, but restore is the cheap insurance.

**4. Emit `category` from `program-builder`.** Cards colour-code by category (skill / strength /
conditioning / tendon work) and no programme schema emits one, so the app *guesses* from the
exercise name. It is right on the current sample, but a renamed exercise can silently change
colour. An optional `category` per exercise replaces the guess with a declaration; the app already
prefers a declared value and degrades to no-tag. Needs a 14th spreadsheet column, so it is a
`program-builder` change. See `docs/data-contracts.md`.

## Medium value

**5. Per-exercise trend view.** Load and RPE over weeks, plus the pain trend. "No upward trend
week over week" is one of the coaching rules, so surfacing it in-app would let the athlete
self-correct before the coach review. The past-sessions *list* is not part of this — the hub and
the calendar already are that.

**6. Reduce export→save friction.** Export downloads a file, which the athlete then files into
Drive through the share sheet. `navigator.share` is unused; a share button or a whole-week export
would shorten it.

**7. `localStorage` housekeeping.** `tp_sess_v1::*` keys accumulate forever. Harmless at this
volume, but a "clear sessions older than N months" action — after a backup — keeps it tidy.

## Lower value / speculative

**8. Plate calculator.** The athlete does this arithmetic automatically.

## Deferred on purpose

Each of these is a real feature with a cost worth naming, not an oversight.

- **Off-programme workouts** (a pickup session, a race, a swim). A workout with no `(week, day)`
  and no prescribed rows means either `tp-session-3` grows a variant or `review-workout-log`
  receives a session it cannot compare against. Worth doing; worth not doing accidentally.
- **Rest-day notes.** A rest day offers the next session and the claim picker. A place to write
  "travelled, walked 8km" is small, but needs a store that can never be mistaken for a workout.
- **Structured schedule fields.** The reader already accepts `meta.startDate` and a per-day
  `weekday`; emitting them is a `program-builder` change and must land in lockstep.
- **A prescribed per-set array.** Ramping sets stay in the `load` string ("60/70/80 kg"). Only
  add one if that stops being expressive enough — it doubles the generator's surface.
- **Swipe gestures.** Horizontal swipe collides with the pip strip and with text fields.
  Prev/Next and the pips are unambiguous; arrow keys work on a desktop browser.
- **Analytics, a framework rewrite, a native app-store build, coach roles, shared or team
  accounts, public programme discovery, subscriptions, live collaborative editing, and any
  server-side AI call.** None are in scope for a personal invite-only tool.

## Accepted limitations

- **320px needs one scroll** to reach the primary action on an exercise with a long prose
  prescription. 390px — every current iPhone — fits without one. Fixing 320 properly means
  truncating prescription text, which is worse.
- **A rest day loses the morning reading.** `amPainOnWaking` is captured only on days the athlete
  trains, so the morning after a session followed by a rest day is never recorded. A standalone
  rest-day check-in means a second export shape for a reading that matters less than the trend it
  feeds; `review-workout-log` compensates by attributing readings by date gap.
