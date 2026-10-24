---
name: program-planner
description: Use when an athlete or coach wants to plan or scope a NEW training programme or block (strength, conditioning, hybrid, CrossFit, rugby, combat, general athletic) BEFORE it is written. Reads that athlete's profile doc — writing one from a template if none exists — asks ONLY the essential facts still missing, then writes a reviewable "Program Planning Doc" and stops at an approval gate. Do NOT use this to write the actual sets-and-reps programme — that is the job of the program-builder skill. Triggers on phrases like "plan a new block", "set up a new training programme", "scope my next mesocycle", "let's plan my next block", "set up a new athlete".
---

# Program Planner

Turns a request for a new training block into a single, reviewable **Program Planning Doc** that captures every decision needed to build the programme. It gathers facts intelligently (never re-asking what the athlete's profile already answers) and **stops before any sets-and-reps are written**. Generation is a separate, explicitly-approved step handled by the `program-builder` skill.

## When to use
- The user wants to start a new block/programme/mesocycle, or re-plan an existing one.
- The user has (or should have) an athlete-profile doc and coaching source material to draw on.

## When NOT to use
- The user has an approved plan and wants the actual programme written → use `program-builder`.
- A block is running and a logged session should adjust it → use `review-workout-log`.
- The user wants a one-off single-session tweak → answer directly.

## Hard rule
**Never design exercises, sets, reps, loads, or weekly progressions in this skill.** This skill produces decisions and structure only. If the user asks you to "just write it too", confirm the plan is approved, then hand off to `program-builder`.

## Which athlete

Establish this **before opening any file**, and never plan for one athlete off another's profile
or another's loading rules. The full procedure — how to resolve an ambiguous request, and what
to do when the athlete has no folder yet — is in `athlete/README.md`.

## Process

1. **Gather context first (no questions yet).**
   - Read `athlete/<slug>/personal-profile.md`. If it does not exist, say so plainly and write
     one as you go from `reference/athlete-profile-template.md`.
   - Read the shared coaching source material in `athlete/sources/` and the project instructions.
   - If a previous programme exists in `athlete/<slug>/programs/`, read its notes/feedback
     column, and read recent `athlete/<slug>/logs/*.json` — prior-block feedback and actual
     logged loads/RPE/pain are first-class inputs.
   - **Count the consecutive loading weeks the athlete arrives with, and write the number in the
     plan.** See "Week 1 is not week 1" below. Read the previous block's `program.json` or phase
     map and the dates on `logs/*.json`, then answer three questions: how many weeks did they
     *actually* train (not how many were authored); where was the last **real** deload; and how
     long is the gap between that block's last session and this block's first. A real deload
     reduces volume **and** RPE caps — a week that holds loads while keeping the sets is a
     maintenance week and does not reset anything. If the athlete has no logs or no previous block
     in the repo, ask them directly and record the answer as the athlete's account rather than as
     a verified fact.

2. **Establish the essential facts.** Work through the two templates below. For every item the profile or sources already answer, mark it **established** and restate it — do not ask. Only genuine gaps become questions.

3. **Ask only the material gaps.** Use the AskUserQuestion tool. Batch questions (max ~4 at a time), keep them multiple-choice with a recommended default where possible, and ask only what would materially change a programme-level decision. For anything minor still unknown, state a bounded assumption instead of asking.

4. **Write the Program Planning Doc** to `athlete/<slug>/plans/` using `reference/planning-doc-template.md`. Cite the profile where a fact came from it; label assumptions clearly. Write any newly-established durable fact back into `personal-profile.md` in the same pass.

5. **Stop at the approval gate.** Present the doc, summarise the key decisions and any open questions in 2–4 sentences, and ask the user to review and approve. Tell them: once approved, run the `program-builder` skill (or say "generate the programme") to build it. Do not proceed further.

## The two templates are the fact checklist

Read both before asking anything. Between them they name every fact a plan needs, split by **how
long the fact lasts** — which is what stops a returning athlete being re-interrogated about their
training age every block.

| Template | Owns | Ends up in |
|---|---|---|
| `reference/athlete-profile-template.md` | **Durable:** training history and baselines, injuries and loading constraints, environment and equipment, conditioning direction, recovery and monitoring, preferences. | `athlete/<slug>/personal-profile.md` |
| `reference/planning-doc-template.md` | **Per-block:** this block's goal and adaptations, target event, length, loading/deload rhythm, prior-block feedback, and the loading-week count from step 1. | `athlete/<slug>/plans/` |

- A profile section that is **filled** is established. Restate it in the plan, cite it, don't ask.
- A profile section that is **missing or contradicted by recent logs** is a question — and the
  answer goes back into `personal-profile.md`, not only into the plan. A durable fact recorded
  only in a plan gets asked again next block.
- **Every per-block section is decided every time**, however well you know the athlete.
- With no profile at all, expect the first block to take more rounds of questions than any later
  one. That cost is paid once per athlete, not once per block.

## Week 1 is not week 1

Blocks restart their week numbering. Fatigue does not. An athlete finishing one block and starting
the next on Monday opens "Week 1" carrying every loading week since their last deload — so a plan
with a deload at Week 4 can deliver the athlete's first recovery week in week 8 of unbroken
loading, without a single document saying anything untrue.

**The trap is that continuity gets counted as a benefit and never as a cost.** "No washout since
the last block, conditioning base intact" and "baselines are current, so open at real working
loads" are both true statements that argue for opening heavy, and neither prices the fatigue that
came with them. Nothing in the plan contradicts them, so nothing catches it.

**So:** carry out the count in step 1, state it in the plan, and let it decide how the block opens.

| Weeks of unbroken loading on arrival | How the block opens |
|---|---|
| 0–1 (came off a deload, or a real break) | Week 1 at full prescription, as authored |
| 2–3 | Week 1 as authored, but say in the plan that the first deload is non-negotiable and cannot be skipped for a good week |
| 4+ | **A transition week is authored as Week 1**, carrying a deload's reduced prescription. What the plan would have called Weeks 1..N shifts to 2..N+1, and the block is built as **N+1 weeks** |

Two corollaries for any plan that needs a transition week:

- **Renumber the phase map with it**, and state the resulting total. The transition week is a
  real authored week, not a note — the app renders the week the athlete selected, so a week that
  exists only in prose is a week they cannot train off. `program-builder` takes the total as
  `--weeks` and validates that every one of them has rows.
- **Time off sick or injured is not a deload you then repeat.** Several days of rest *is* the
  transition week; stacking a reduced week on top of a week spent unwell costs a second week.

## Decision principles to apply while planning
- **Safety and medical escalation first**, then long-term continuity, then symptoms/recovery, then the block's primary adaptation, then secondary qualities, then adherence, then novelty.
- **Count the loading weeks before choosing the rhythm.** A deload/loading shape is only defensible against where the athlete actually *starts* — see "Week 1 is not week 1" above.
- **Prefer the smallest effective structure.** Do not default to a "3 loading + 1 deload" shape — justify the loading/deload rhythm from training age, goal, fatigue cost, symptoms, recovery history, and upcoming events.
- **Distinguish** evidence-supported principles, coaching inference, athlete-specific judgement, and genuine uncertainty. Flag high-stakes or injury-related decisions.
- Turn any overreaching / illness history into explicit **autoregulation hard stops** in the plan (e.g. consecutive below-baseline readiness → mandatory downshift).

## Output

A single Markdown file at `athlete/<slug>/plans/<Athlete or Block name> - Program Planning Doc.md`, ending with an explicit Approval section. Nothing else. No sets-and-reps, no spreadsheet. A revised or newly-written `personal-profile.md` may land alongside it.

## Verification checklist (before presenting the plan)

`program-builder` reads **the plan**, not the profile, for the decisions below. A fact that is
missing here is a fact the builder will invent.

- **Block length in weeks is stated explicitly**, including any transition week — the builder
  authors every one of those weeks as real rows and validates the count against it.
- **The consecutive loading weeks on arrival is stated as a number, with its source** — a
  verified count from the previous block's files, or the athlete's own account where no files
  exist. An unstated count reads as zero to every later reader.
- **How the block opens follows from that number** (the table above), and if a transition week is
  needed the phase map is numbered with it.
- **This athlete's injury and loading constraints, pain-monitoring protocol and readiness hard
  stops are carried forward in full** — not summarised, and not left as a pointer to the profile.
- Every durable fact newly established in this session is written back to `personal-profile.md`.
- No exercises, sets, reps or loads appear anywhere in the doc.
