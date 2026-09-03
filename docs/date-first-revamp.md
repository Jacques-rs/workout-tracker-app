# Date-first revamp — design spec

**Status: agreed design, nothing implemented.** This document is the durable record of a design
conversation held on 2026-08-26. It is written to be handed to a session with no other context:
everything below was decided deliberately, and the reasoning is included because the reasoning is
the part that stops it being re-litigated badly.

Read `CLAUDE.md` first for the hard constraints. Nothing here breaks any of them —
no build step, no external runtime dependencies, offline-first, relative paths,
`localStorage` remains the source of truth for an in-progress log, and
`tp-program-2` in / `tp-session-3` out are unchanged.

## Start here

If you are picking this up cold, in order:

1. Read `CLAUDE.md` for the hard constraints. Nothing in this plan breaks any of them.
2. Read this document end to end. Every decision below was made deliberately with the athlete;
   the reasoning is included so it is not re-litigated badly. **If you think a decision is
   wrong, say so — do not quietly design around it.**
3. Look at the eleven agreed screens:
   <https://claude.ai/code/artifact/42a1f71e-f81d-4b39-a398-8d75476d5e59>
4. Start at **Phase 0** under "Implementation plan". Do not start with the UI.

**Check, don't assume, before you push:** which branch GitHub Pages serves has changed twice
already. `gh api repos/Jacques-rs/workout-tracker-app/pages --jq '.source.branch, .status'`.

## The problem this solves

The app grew four surfaces that were each designed on their own — a header, a scrolling `<main>`,
a drawer of accordions, and a Profile home added with the account layer — tied together by five
kinds of overlay and no single organising idea. The specific complaints:

1. Too many loose structural parts; too much cognitive load.
2. Logging should be a focus mode showing only the current exercise. (Overview keeps its job.)
3. Navigation is ad hoc. There is no flow.
4. There is no heart — no core that links everything else.
5. Past workouts should be reachable seamlessly, and conflict copies should be far less invasive.

## The two ideas everything else follows from

**The heart is a home page.** Not a feature — a home screen you land on, that answers "what am I
doing today" first and links to everything else. This is deliberately *not* one of the app's
sub-features promoted to the top; it is a hub.

**Tracking is date-first.** Every calendar date carries a workout state. Opening a date resolves
to exactly one of three things, which is the whole navigation model:

| | |
|---|---|
| **Resume** | an open (unsealed) session exists on this date |
| **Review** | a sealed session exists on this date — viewable, and editable |
| **Start** | no session yet — begin the scheduled day, or claim a different one |

Plus two honest extras: a **rest day** (no scheduled session; notes only) and **no programme
loaded**.

## Scheduling: how a date gets a workout

`tp-program-2` has no dates. A programme is `(week, day)` only, and the weekday exists solely as
prose inside a display string — `"Day 1 (Mon) - Clean Skill + Front Squat…"`, a convention
documented in `data-contracts.md` but **not enforced by `validate_program.py`**. The real
`program.json` uses Mon, Tue, Thu, Fri.

### The schedule is a suggestion, not a commitment

This is the single most important rule here. There is **no "move session" operation**, no cascade,
and no schedule state that can drift out of sync with reality.

- A **derived schedule** maps `(week, day)` → a date, from an anchor Monday plus the day's weekday.
- A **claim** is simply a stored session carrying that date. Claims always win.
- Therefore: `contentFor(date)` = any stored session on that date, else the derived suggestion.

Training Tuesday's session on Wednesday needs no feature — you open Wednesday, the app offers
Wednesday's suggestion, you pick a different day, and the session you create *is* the claim.

### Deriving the schedule

One function, three fallbacks, in this order — matching the documented "generator strict, app
lenient" stance:

1. A structured field on the programme, if one ever exists (`meta.startDate`, a real `weekday`
   per day). Nothing emits these today. The reader is written so that adding them later is a
   no-op in the app and needs no migration.
2. Parse `(Mon)` out of the day label.
3. Ask the athlete once, at import.

**Anchor default:** the Monday of the week the programme was imported, shown and editable in one
tap. Right most of the time, cheap when wrong.

**Weekday fallback** when no label parses: distribute the programme's days across consecutive
weekdays from Monday.

### Missed, doubled, and behind

- A scheduled date that passes with nothing logged stays **not done** — greyed and quiet. Never
  red, never auto-rolled forward.
- **Two sessions on one date** are allowed and listed. Not designed for.
- **Being a week behind** is the most common way a block goes off-plan, so claiming a date picks
  **week *and* day** in one picker reading `Week 3 · Day 2`, with the schedule's guess
  preselected. Day-only would quietly serve the wrong week's prescription, which is worse than
  any navigation problem — you would train off it.

## Session lifecycle

Today a session has no status; "complete" is inferred from its entries. That cannot distinguish
"I finished" from "I did four of six and walked out" — a difference the coaching side cares about.

- **Finish session** seals it. Sealing is local and must work with the radio off; it is
  deliberately *not* tied to sync or export, or a dropped connection would look like an
  unfinished workout.
- **Editing a sealed session does not un-seal it.** Un-sealing would flip the calendar back to
  "unfinished" because you fixed a typo, which is a lie about that day.
- Instead, an edited-after-export session is marked **"edited since export"**. This is
  information the app does not have today and the coaching loop actually needs.
- **Export stays manual** and per-session, reachable from any past date. Auto-export cannot work:
  the export is a file that has to be put somewhere, on your terms.

## Screens

Eleven, one visual system, in flow order.

| # | Screen | Notes |
|---|---|---|
| 1 | **Home** | Today first and largest; the last few sessions inline; rows for Calendar, Programme, Account. |
| 2 | **Calendar** | Continuous vertical scroll of weeks. |
| 3 | **Date — scheduled, not started** | Check-in at the top; exercise list; Start. |
| 4 | **Date — in progress** | Resume. |
| 5 | **Date — sealed** | Review and edit. |
| 6 | **Focus logger — normal set** | Rest clock, last time, the current set. |
| 7 | **Focus logger — circuit** | Its own composition. |
| 8 | **Rest day** | Notes only. |
| 9 | **Claim picker** | "Doing a different day?" |
| 10 | **Programme** | |
| 11 | **Account** | |

### 1 · Home

Always shows **today**, never "the next thing" — a home that silently shows tomorrow gets you
doing the wrong session. On a rest day, a quiet second line points at the next session.

Six states, each with one primary action: scheduled-not-started → **Start** · in-progress →
**Resume** · sealed → **Review** · rest day → *no button, just the note* · scheduled-and-passed →
**Log it late** · no programme → **Import a programme**.

The last two or three sessions appear **inline**, not as a destination. You almost always want
"the last one" and rarely want "the fourteenth". Sync state is one line inside Account, never a
badge on the home, so it cannot compete with today's session for attention.

### 2 · Calendar

A continuous vertical scroll of weeks, with the block's weeks labelled W1–W8 and dates outside the
block still present but plain. One calendar, no month/block mode switch; it reads as a timeline,
which suits a block that does not care about month boundaries.

At seven columns a cell is roughly 48px — the date number and one state mark, nothing more. A
hairline pain-on-waking tick when it is above zero is proposed but unreviewed: it is the one
number the tendon protocol tracks over time, and the calendar is the only place a trend would
ever be visible.

### 3–5 · The date view

**List first, focus second.** Opening a date shows the Overview list; tapping an exercise enters
focus; back returns to the list. Focus-first is faster mid-session but disorienting on open, and
reviewing a logged workout wants the list, not a single exercise.

The Overview keeps its job exactly — every exercise, its prescription, its status, and no inputs.

**The check-in sits at the top of this screen and never gates Start.** The data matters — it is
the tendon protocol, and `amPainOnWaking` describes the response to the *previous* session — but
a form standing between you and a warm-up gets skipped, or worse, filled with whatever number
ends it fastest. A skipped check-in is honest missing data; a faked one is poison.

### Tracked fields are account-scoped, and everything they touch follows them

`tp_settings_v1` holds `painOnWaking` (whether the field is tracked at all) and `painLabel`
(what the athlete calls it — default `"Knee"`). Today it is **device-local by design** and is
never synced; it appears only in the account *data export* (`js/account-data.js:36`).

**This moves to the account.** Which optional fields you track, and what you call them, follow
you to any device you sign in on. Two consequences, both deliberate:

- **Nothing renders a tracked field that is switched off.** The calendar's pain-on-waking mark
  appears only when `painOnWaking` is on. An athlete who does not track it sees no mark, no
  legend entry, and no column in the check-in — not a greyed one.
- **Every surface uses the athlete's own label**, not the word "pain": the check-in field, the
  logger's 0–10 row, the calendar legend, and the summary lines on the Overview. `painLabel` is
  already the mechanism (`index.html:1028`, `:1130`); this just extends it to the two new
  surfaces.

**Appearance and the rest clock stay on the device.** They are about where you are standing — a
basement at 6 a.m. and a kitchen at noon want different things — not about who you are. The
Account screen shows the split explicitly rather than presenting one undifferentiated list.

**Conflict rule:** last write wins, per field, on the settings record. A tracked-fields change
made offline on two devices is not worth a conflict copy — unlike a workout, nothing is lost by
resolving it, and the athlete can see and re-set it in one tap.

**Note against `CLAUDE.md`.** The "the app is per-device, not multi-profile" rule stays true —
this introduces no profile switching, and nothing in the session autosave path becomes keyed by
person. What changes is narrower: a preference that had no better home before accounts existed
now has one. `CLAUDE.md`'s "Tracked fields is a per-device preference" line needs updating when
this ships.

### 6 · Focus logger

One exercise, one set. Visible simultaneously: exercise name, prescription, the committed sets,
the current set's fields, the rest clock, and **what you lifted for this exercise last time**.

**Rest clock.** Counts **up** from the last logged set, with the prescribed rest marked on it —
not a countdown that expires and then means nothing. Passive: no sound, no buzz, no notification
permission, all of which fight the offline/no-dependency constraint and behave badly in an
installed iOS PWA. Hides itself past about fifteen minutes, when you have left the gym and a
large number is just noise.

*It cannot get buggy, by construction.* Logging a set writes a `lastSetAt` timestamp; the display
is always `now − lastSetAt`, recomputed on render by a single interval that only repaints. There
is no timer state to drift, corrupt or desynchronise — it survives a reload, a backgrounded tab
and an iOS PWA being killed. Worst case it shows a stale number for one repaint. Nothing in the
log path reads it, so it can never interfere with logging.

**Last time.** Match on exercise `id`, falling back to a normalised name so it keeps working
across blocks — which is exactly when it is most wanted. Show the same set number's `load × reps`
where it exists, else the top set, always with how long ago: `Set 3 last time · 100 × 5 · 12 days
ago`. Silent when there is nothing to show, rather than printing an empty row. **Not coloured as
a target** — it is a fact about the past, and making it green would quietly turn it into a
prescription.

### 7 · Circuits

The adaptive circuit logger keeps **all** of its function: five kinds (rounds, AMRAP, EMOM,
for-time, ladder) × three modes (quick / details / final). Roughly one exercise per session needs
it — 4 of the 30 week-1 rows in the real `program.json`. Losing modes would be a downgrade dressed
as a simplification.

What changes is form: a circuit gets its own composition — a large round counter, or a single
result field — rather than the three-numeral readout with two of them meaningless.

## What gets deleted

**The drawer, entirely.** Everything it holds has a better home: week/day → the schedule and the
claim picker · date → the calendar · check-in → the date view · import/export → Programme ·
appearance and tracked fields → Account. This is the largest single cut against "too many loose
structural parts": four accordions and a hamburger disappear and nothing loses a home.

Cost: Appearance and Tracked fields move two taps deeper, which is right for settings touched
twice a year. If mid-session settings turn out to matter, one sheet can come back — better to
find that out than to assume it.

## Visual direction

Dark "almanac": near-black ground, hairlines and typographic hierarchy instead of nested cards,
large tabular numerals, amber reserved for *now* and green for *logged*. The focus logger uses the
instrument treatment — big numerals on a rule, tiny letterspaced labels, one full-width action.

Legibility is the binding constraint, not restraint: someone mid-session is tracking rest, target
load, RPE and pain at once, and all of it must be readable at arm's length, one-handed, with
chalked hands.

Colour still comes from CSS variables, so this is a new theme rather than a new rendering model.
Body type stays the system stack — no webfont, per the no-external-dependencies rule.

## Data model changes

All additive. **No migration is needed, and no existing data is stranded.**

Sessions are already keyed `tp_sess_v1::<date>::<day>` (`index.html:832`), so **every session
already on a phone lands on the correct calendar date for free.**

| Change | Shape | Notes |
|---|---|---|
| Block anchor | `tp_schedule_v1` → `{ programKey, anchorMonday }` | One date per programme. The only new stored state the schedule needs, because claims live in the sessions. |
| Session status | `status: "open" \| "sealed"`, `sealedAt` | Absent = `"open"`, so old records read correctly. |
| Export tracking | `exportedAt` | Compared against the last edit to derive "edited since export". |
| Rest clock | `lastSetAt` | Session-level: the clock is "time since you last logged anything", which is what you want between exercises as well as between sets. |

**Performance note.** "Last time" means reading sibling `tp_sess_v1::*` keys. Build the index once
when a session opens — never scan `localStorage` from a render path. `saveSession()` runs on every
keystroke, and the repaint-don't-rebuild rule in `CLAUDE.md` exists because of exactly this class
of mistake.

## Deliberately deferred

- **Off-programme workouts** (a pickup session, a race, a swim). Rest days are openable for notes,
  but a workout with no `(week, day)` and no prescribed rows has a real contract cost: either
  `tp-session-3` grows a variant, or `review-workout-log` receives a session it cannot compare
  against. Worth doing, worth not doing accidentally.
- **An active rest countdown** with sound or haptics. A real feature, not a detail.
- **Structured schedule fields** in the programme schema. The reader is built to accept them;
  emitting them is a `program-builder` change and must happen in lockstep.

## Implementation plan

Five phases. Each one is shippable on its own and leaves the app working in the gym; each has a
gate that must pass before the next begins. **Bump `CACHE` in `sw.js` at the end of every phase
that changes a shell file**, or a returning phone keeps the old app.

The ordering is not arbitrary:

- **Groundwork is headless**, so the hard logic is proven before any pixel moves.
- **The drawer is deleted last.** Until Phase 4 the old navigation still exists, so every earlier
  phase can be reverted without stranding the athlete mid-block.
- **The logger comes after the shell**, because a focus screen with nothing to navigate back to
  cannot be judged.

### Phase 0 — Scheduling and session state, headless

No visible change. The app still renders the current UI throughout.

- `scheduleFor(program)` → `{ anchorMonday, days: [{label, weekday}] }`, with the three fallbacks
  from "Deriving the schedule" in that order. One function; do not scatter weekday parsing.
- `dateFor(week, dayLabel)` and `scheduleForDate(date)` — the two directions, pure.
- `tp_schedule_v1` → `{ programKey, anchorMonday }`. The only new stored state; claims live in
  the sessions.
- Session record gains `status`, `sealedAt`, `exportedAt`, `lastSetAt`, all read tolerantly —
  **absent `status` means `"open"`**, so records already on the phone stay valid.
- A session index built once on open: `date → session`, and `exerciseId → most recent earlier
  logged set`. Never scan `localStorage` from a render path.

**Gate.** `samples/apptest.js` covers: anchor default; weekday parsed from a real label; the
label-missing fallback; the no-programme case; `dateFor`/`scheduleForDate` round-tripping across
a month boundary; and loading a pre-existing session that has no `status`. Full `verify.sh`.

### Phase 1 — The date view and the seal

The session becomes addressed by date rather than by three independent pickers.

- `STATE.date` becomes primary; `(week, day)` are derived from the schedule or read from the
  claim. `saveSession()` currently writes `s.week`/`s.day` from `STATE` on every save — that has
  to follow the claim instead, or a claimed session will be rewritten to the schedule's guess.
- The claim picker (screen 9): week and day together, schedule's guess preselected.
- **Finish session** seals. Editing a sealed session does not un-seal it; it sets the
  edited-since-export flag.
- Export sets `exportedAt`.

**Gate.** Reload mid-session restores the date *and* the claimed `(week, day)`, not the
schedule's guess. Seal → edit → the calendar state does not change but "edited since export"
appears. A v1 programme still opens and logs. Airplane mode throughout.

### Phase 2 — Home and calendar

- The home hub (screen 1) and the calendar (screen 2).
- Profile home's account content moves to the Account screen; the separate history view retires.
- The rows on the home replace it as the way to reach Programme and Account.

**Gate.** Every date resolves to exactly one of the five states. **Sessions already in
`localStorage` appear on their correct dates with no migration** — this is the property worth
testing explicitly, because it is the whole justification for keeping the existing session key.
Check horizontal overflow at 320 *and* 390 by loading in a 320-wide iframe and comparing
`documentElement.scrollWidth` to `clientWidth`; a narrow screenshot is a crop and will hide it.

### Phase 3 — The focus logger

- The new logger (screen 6): the three values as the interface, the rest clock, "last time".
- The circuit variant (screen 7), keeping all five kinds × three modes.

**Gate.** The regressions that have actually been reported before, all of which this phase can
reintroduce: type a full `7.5` into RPE and confirm focus never leaves the field and the page
never jumps; confirm `oninput` writes and saves but never rebuilds its own container; confirm
`metricOf()` still drives the reps field, so a 45-second hold does not get a digits-only keypad.
Then: the rest clock survives a reload, a backgrounded tab and a killed PWA; a typed-but-unlogged
set still reaches `sets[]` on Finish, Next, a date change and a view change.

### Phase 4 — Delete the drawer, reconcile the docs

- Remove the drawer, its four accordions, the hamburger, the week stepper, the day list and the
  standalone date picker.
- Tracked fields and the pain label become account-scoped; Appearance and the rest clock stay on
  the device.
- **`CLAUDE.md` needs real edits, not a footnote:** "Where a thing goes on screen" describes a
  header/main/drawer model that no longer exists, and "Tracked fields is a per-device preference"
  becomes wrong. `docs/architecture.md` needs the same pass.

**Gate.** Full `verify.sh`; both fixtures imported, logged and exported; airplane mode; 320 and
390; at least one light theme, since a hardcoded colour looks fine in the palette it was written
in.

### Risks worth naming up front

- **`saveSession()` overwriting the claim** (Phase 1) is the most likely subtle bug in the whole
  plan: it writes `week`/`day` from `STATE` on every keystroke today.
- **Timezone drift** in date maths. Dates are local calendar days, never UTC instants; build them
  from `todayISO()`'s existing local-date approach rather than `Date.parse`.
- **A programme whose day labels carry no weekday** must still import and be trainable. The
  fallback is not optional.
- **The index in Phase 0** is a cache. Anything that writes a session must invalidate it, or
  "last time" will go stale mid-block.

### Out of scope for all five phases

Off-programme workouts, an active rest countdown, and any change to `tp-program-2` /
`tp-session-3`. See "Deliberately deferred". If one of these looks necessary to finish a phase,
that is a signal to stop and ask, not to widen the phase.

## Verification

`./scripts/verify.sh` is the implementation gate. Beyond it, this work specifically needs:

- `samples/apptest.js` extended for schedule derivation (anchor + weekday parse + both fallbacks),
  date→session resolution, and the seal/edit/export-staleness states.
- Both fixtures still import and drive a session: `samples/program.sample.json` (v1) and
  `samples/program.v2.sample.json` (v2). A v1 programme must keep working.
- Reload mid-session: the open date, the claimed `(week, day)` and the rest clock must all survive.
- Airplane mode: every gesture in this document works with the radio off.
- 320px as well as 390px, checking `documentElement.scrollWidth` against `clientWidth` in a
  320-wide iframe — a `--window-size=320` screenshot is a crop, not a narrow layout.
