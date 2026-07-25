# Athlete & domain context

> **Privacy note:** this file contains personal health context. If this repo is ever made public, trim or remove it (the app functions without it — it exists so design decisions aren't made blind). Keeping the repo private is the simpler option.

Why this doc exists: several UI choices in the app look like clutter unless you know what they're for. Before removing a field, simplifying a form, or "tidying" the log grid, check here.

## The athlete in one line

Advanced recreational hybrid athlete (~12 years structured training), training 4 days/week (Mon, Tue, Thu, Fri), 75–90 min per session, in a **commercial gym** (Virgin Active) — not a CrossFit box. Current goal: CrossFit/rugby-style strength and conditioning.

## The constraint that shapes the app

**Recurrent bilateral patellar tendinopathy** (inferior pole), with an Osgood-Schlatter history. Baseline discomfort sits around 2–4/10 and flares after long periods of sitting (flights, bus rides).

The coaching model used is a pain-monitoring approach: training continues **as long as** pain stays within limits during and after the session, **returns to baseline by the next morning**, and doesn't trend upward week over week. Green/Amber/Red governs whether load progresses, holds, or regresses.

**Design implications — do not remove these:**

- **Per-exercise `painDuring` (0–10)** on every logged exercise. Knee load varies hugely between movements; a single session-level pain score is useless for deciding *which* exercise to regress.
- **`amPainNextDay` (0–10)** at session level, and the ability to **re-open a past session by changing the date** so it can be filled in the morning after. Next-morning response is the primary decision signal — an app that only captures in-session pain would break the coaching loop.
- The **`logHint`** line ("Log: …") per exercise. It's generated per movement precisely so the athlete knows that, say, the sled needs a knee-response note while a warm-up needs nothing.

## Readiness and a specific failure mode

The athlete has a **history of pushing through fatigue to the point of getting ill**, typically after consecutive days of below-baseline HRV. Recovery data comes from a Garmin (Forerunner 265 + HRM Pro).

The coaching rules treat a *single* low score as noise and a *multi-day trend* as signal. Hence the session check-in captures `readiness` (Green/Amber/Red), `sleep` (1–5), and a free-text `hrvNote`.

**Design implication:** these fields are small and quick on purpose. Don't make them mandatory (that kills adherence), but don't bury them either — they're what lets the coach say "hold this week" instead of "add load."

## Movement preferences and exclusions

Currently excluded or tightly dosed for tendon reasons: wall balls, box jumps, running volume, split squats/walking lunges, fast eccentrics in deep knee flexion, and squatting under fatigue in conditioning pieces. Disliked: farmer carries (boredom). No gymnastics rings available, so bar muscle-ups are used instead.

**Design implication:** the app is a *renderer* — it must never editorialise, filter, or reorder what the programme prescribes. Exclusions are handled upstream by the coach, not here.

## Gym environment

A shared commercial gym: conditioning is deliberately designed to occupy **one station, or at most two**. The `focus` text often contains a footprint note ("one bike = considerate footprint").

**Design implication:** the `focus`/coach-notes field must stay readable in-app; it carries operational instructions, not just cues.

## What "good" looks like in the gym

- Open the app, and today's session is one tap away (day + date default sensibly).
- Log a set in under ~5 seconds, one-handed, possibly with chalk on hands.
- Never lose data: no signal, locked screen, or backgrounded app must be safe.
- Prescription (sets/reps/load/RPE/tempo/rest) legible at a glance; coach notes and progression rules available but **collapsed**, so the default view isn't a wall of text.

That last point is the core tension in the design: the programme carries a lot of prose per exercise, and the gym needs almost none of it. Progressive disclosure is the answer — keep it.
