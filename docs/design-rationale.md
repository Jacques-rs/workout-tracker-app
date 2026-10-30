# Design rationale

**Why the app is shaped the way it is.** This file owns the *arguments*; the mechanism lives in
`docs/architecture.md` and the rules an agent must not break live in `CLAUDE.md`. Read it before
changing any of the decisions below — each was made deliberately with the athlete, and the
reasoning is the part that stops it being re-litigated badly. **If you think a decision is wrong,
say so; do not quietly design around it.**

## The problem it solves

The app once grew four structural surfaces designed independently, tied together by five kinds of
overlay and no single organising idea. The complaints that drove the current shape:

1. Too many loose structural parts; too much cognitive load.
2. Logging should be a focus mode showing only the current exercise. (Overview keeps its job.)
3. Navigation is ad hoc. There is no flow.
4. There is no heart — no core that links everything else.
5. Past workouts should be reachable seamlessly, and conflict copies should be far less invasive.

## The two ideas everything follows from

**The heart is a home page.** Not a feature promoted to the top — a hub you land on that answers
"what am I doing today" first and links to everything else.

**Tracking is date-first.** Every calendar date carries a workout state, and opening a date
resolves to exactly one thing. That is the whole navigation model.

**Home always shows today, never "the next thing"** — a home that silently shows tomorrow gets you
doing the wrong session. On a rest day a quiet second line points at the next one. Recent sessions
appear **inline**, not as a destination: you almost always want the last one and rarely the
fourteenth. Sync state is one line inside Account, never a badge on the home, so it cannot compete
with today's session for attention.

The calendar is one continuous scroll of weeks rather than a month/block switch, because a training
block does not care about month boundaries. It reads as a timeline.

## Why the schedule is only a suggestion

A programme is `(week, day)` with no dates. The schedule is derived; a stored session carrying a
date is a **claim**, and claims win. That is a deliberate choice against the obvious alternative
of storing a schedule and offering a "move session" operation: there is then no cascade to get
right and no schedule state that can drift out of sync with reality.

**Claiming picks week *and* day in one picker.** Being a week behind is the most common way a block
goes off-plan, and a day-only picker would quietly serve the wrong week's prescription — worse than
any navigation problem, because you would train off it.

A scheduled date that passes with nothing logged stays **not done** — greyed and quiet, never red,
never auto-rolled forward. Two sessions on one date are allowed and listed, but not designed for.

**Blocks follow one another and never overlap.** Every date belongs to at most one block, so the
schedule never offers two prescriptions for one day; a new block that starts early cuts the old one
short at its anchor, and the old block's *logged* dates are untouched because claims win. A new
block **asks** which Monday is week 1, with the Monday after the previous block preselected — a
silent default is how a block lands on top of the last week of the one before it. A trained block
that is replaced stays on the phone, because exercise ids are positional and a past session read
against the next block's programme would put its sets under the wrong names; an untrained one is
simply replaced, so a mis-import does not push the next start back.

## Why sessions are sealed

Without a status, "complete" has to be inferred from a session's entries, which cannot distinguish
"I finished" from "I did four of six and walked out" — a difference the coaching side cares about.

Sealing is **local and works with the radio off**, deliberately not tied to sync or export: a
dropped connection must not look like an unfinished workout. **An edit does not un-seal.**
Un-sealing because a typo was fixed would flip the calendar back to "unfinished", which is a lie
about that day; the edit marks the file *edited since export* instead — information the coaching
loop needs and the app previously had no way to record. **Export stays manual** and per-session:
the export is a file that has to be put somewhere, on your terms.

## Why the date view is list-first

Opening a date shows the Overview list; tapping an exercise enters focus. Focus-first is faster
mid-session but disorienting on open, and reviewing a finished workout wants the list, not a single
exercise.

**The check-in never gates Start.** The data matters — it is the tendon protocol, and
`amPainOnWaking` describes the response to the *previous* session — but a form standing between the
athlete and a warm-up gets skipped, or worse, filled with whatever number ends it fastest. A skipped
check-in is honest missing data; a faked one is poison.

## Why the focus logger is an instrument

One exercise, one set, with the name, prescription, committed sets, current fields, rest clock and
last time all visible at once.

**The rest clock counts down the prescribed rest, then keeps counting up** (`+0:15`), so it never
expires into a number that means nothing; with no countable rest it is a plain count-up. It hides
itself past about fifteen minutes, when you have left the gym and a large number is just noise.

**Sound is opt-in, foreground-only and needs no permission.** A phone's browser cannot reliably
signal while it is locked — timers stop, scheduled audio does not play, and notifications need a
permission prompt the logging path must never depend on. So the cue (a beep, plus a buzz where the
phone supports it) is a per-device switch, off by default, fired by the repaint that sees the rest
run out; a locked phone gets no cue and the display is right the moment it unlocks.

**The interval timer keeps the screen on instead of trying to alarm through a lock.** It is the one
signal a locked phone cannot miss, because it never locks. There is no pause — an EMOM you pause is
not an EMOM — but Restart starts it fresh. It never logs a round: a round that happened is still the
athlete's tap, and the Log action does not change at a round boundary, because it is already the
one amber thing to press.

**"Last time" is never coloured as a target, and never copied.** It is a fact about the past, and
making it green — or putting it into a field — would quietly turn it into a prescription or a set
that did not happen. Its popup shows every set read-only. It prefers **the same programme day of the
previous week**, because an exercise trained twice a week should be compared with last Monday on a
Monday; failing that, the most recent session. It matches on a normalised name as well as `id` so it
keeps working across blocks — which is exactly when it is most wanted — and stays silent rather
than printing an empty row.

**Nothing is logged without a tap that says log.** In the gym you do not want to think, so the app
never changes what you are looking at, or what counts as logged, behind your back. Committing a
typed set when the phone locks or you page away looked safe, but it logged sets the athlete had not
confirmed and could leave the editor on a set nobody planned. A typed set therefore waits, visibly
marked "typed, not logged", and the two moments it would otherwise go missing — Finish and Export
— ask about it rather than deciding. For the same reason a value copied from the last set is shown
muted under a "copied" tag until it is typed over, so a guess never looks like an entry. Pain is
never copied: tapping Log without looking would record a stale score and hide a rise, while an
empty one honestly reads as no reading.

**Circuits keep all of their function** — five kinds (rounds, AMRAP, EMOM, for-time, ladder) ×
three modes (quick / details / final). Roughly one exercise per session needs it. Losing modes
would be a downgrade dressed as a simplification. What differs from ordinary work is only *form*:
a large round counter or a single result field, rather than a three-numeral readout with two of
them meaningless.

## Why some settings follow the account and some stay on the phone

Which optional fields the athlete tracks, and what they are called, are about **who you are**, so
they follow the athlete to any device: someone who tracks a tendon reading on one phone must not
silently stop collecting it on another. Appearance and whether the rest clock beeps are about
**where you are standing** — a basement at 6 a.m. and a kitchen at noon want different things.

A tracked-fields change made offline on two devices is not worth a conflict copy: unlike a workout,
nothing is lost by resolving it and it can be re-set in one tap. Hence last write wins, per field.

**A field that is switched off renders nowhere** — no check-in column, no calendar mark, no legend
entry, not even a greyed one — while a reading already in storage is still exported.

## Why consent hides fields instead of blocking the app

Health-data consent must be freely given, so refusing it cannot cost the athlete their training
log; and the app is used in a basement with no signal, so the answer has to be on the phone before
the first set. Consent therefore gates the health fields through the same read model as a switch
— an athlete without it simply sees fewer fields — and never sits between them and Start.

**Readiness is outside consent and always tracked.** It is how a session is steered (progress,
hold or regress), a self-rating rather than a body reading, and the one check-in value every
programme relies on — a switch that could turn it off bought nothing. **Not now is a decision**,
recorded and not asked again: a prompt that comes back between sets is how people stop reading
prompts. Only new consent terms ask again.

## Visual direction

A dark "almanac": near-black ground, hairlines and typographic hierarchy instead of nested cards,
large tabular numerals, **amber reserved for *now*** and green for *logged*. The focus logger uses
the instrument treatment — big numerals on a rule, tiny letterspaced labels, one full-width action.

**Legibility is the binding constraint, not restraint.** Someone mid-session is tracking rest,
target load, RPE and pain at once, and all of it must be readable at arm's length, one-handed, with
chalked hands.

Colour comes from CSS variables, so a new look is a new theme rather than a new rendering model.
Body type stays the system stack — no webfont, per the no-external-dependencies rule.

## The one decision still worth fresh eyes

The hairline pain-on-waking tick on the calendar. It is the one number the tendon protocol tracks
over time and the calendar is the only place a trend would ever be visible, but it was implemented
without review.
