---
name: program-planner
description: Use when an athlete or coach wants to plan or scope a NEW training programme or block (strength, conditioning, hybrid, CrossFit, rugby, combat, general athletic) BEFORE it is written. Reads an existing athlete-profile doc, asks ONLY the essential facts that are still missing, then writes a reviewable "Program Planning Doc" and stops at an approval gate. Do NOT use this to write the actual sets-and-reps programme — that is the job of the program-builder skill. Triggers on phrases like "plan a new block", "set up a new training programme", "scope my next mesocycle", "let's plan my next block".
---

# Program Planner

Turns a request for a new training block into a single, reviewable **Program Planning Doc** that captures every decision needed to build the programme. It gathers facts intelligently (never re-asking what an athlete-profile doc already answers) and **stops before any sets-and-reps are written**. Generation is a separate, explicitly-approved step handled by the `program-builder` skill.

## When to use
- The user wants to start a new block/programme/mesocycle, or re-plan an existing one.
- The user has (or should have) an athlete-profile doc and coaching source material to draw on.

## When NOT to use
- The user has an approved plan and wants the actual programme written → use `program-builder`.
- The user wants a one-off single-session tweak → answer directly.

## Hard rule
**Never design exercises, sets, reps, loads, or weekly progressions in this skill.** This skill produces decisions and structure only. If the user asks you to "just write it too", confirm the plan is approved, then hand off to `program-builder`.

## Process

0. **Establish which athlete this is for.** Each athlete has a folder: `athlete/<slug>/`
   containing `personal-profile.md`, `plans/`, `programs/`, `logs/`. Use the athlete named in
   the request. If several folders exist and the request is ambiguous, ask before reading
   anything — never plan for one athlete off another's profile. If the athlete has no folder
   yet, create `athlete/<slug>/{plans,programs,logs}` and say so; the ignore rules already
   cover it (see `athlete/README.md`).

1. **Gather context first (no questions yet).**
   - Read `athlete/<slug>/personal-profile.md`. If it does not exist, say so plainly — the
     checklist below then has to be worked through by asking rather than by reading.
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

2. **Establish the essential facts.** Work through the checklist below. For every item the profile or sources already answer, mark it **established** and restate it — do not ask. Only genuine gaps become questions.

3. **Ask only the material gaps.** Use the AskUserQuestion tool. Batch questions (max ~4 at a time), keep them multiple-choice with a recommended default where possible, and ask only what would materially change a programme-level decision. For anything minor still unknown, state a bounded assumption instead of asking.

4. **Write the Program Planning Doc** to `athlete/<slug>/plans/` using the template in `reference/planning-doc-template.md`. Cite the profile where a fact came from it; label assumptions clearly.

5. **Stop at the approval gate.** Present the doc, summarise the key decisions and any open questions in 2–4 sentences, and ask the user to review and approve. Tell them: once approved, run the `program-builder` skill (or say "generate the programme") to build it. Do not proceed further.

## Essential-facts checklist (ask only if missing)

Group A — **Athlete & goal:** archetype (CrossFit / rugby / combat / general hybrid / pure strength), primary goal for THIS block, any target event and date.
Group B — **Training history:** training age / years of structured training, key strength baselines, technical proficiency with barbell, gymnastics, and Olympic lifts.
Group C — **Schedule & environment:** training days per week and which days, session time cap, and training environment (home / commercial gym / CrossFit box) including any shared-equipment / footprint etiquette constraints.
Group D — **Equipment:** what is reliably available (rower, ski, air/assault bike, sled + turf, pull-up rig / rack, KBs, DBs, boxes, GHD, machines, etc.).
Group E — **Injury & loading constraints:** current or historical injuries, tendinopathies and their pain-monitoring status, movements to avoid or dose carefully, and any medical clearances or red flags.
Group F — **Conditioning direction:** energy-system emphasis, impact tolerance, appetite for running / jumping / high-skill metabolic work.
Group G — **Recovery & monitoring:** sleep, nutrition, stress, wearables / metrics available (HRV, readiness, RHR), autoregulation preferences, and any history of overreaching or training-through-illness (drives hard-stop rules).
Group H — **Preferences:** disliked and enjoyed movements, appetite for novelty vs. familiarity.
Group I — **Block parameters:** desired block length, loading / deload preference, how hard to push intensity vs. tissue caution, and the primary + secondary adaptations for THIS block specifically.
Group J — **Prior-block feedback and accumulated load:** pull directly from the last programme's notes/feedback where available and note what to change; **and establish how many consecutive loading weeks the athlete has done since their last real deload** (step 1), because that decides whether this block can open at full load or needs a transition week first.

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
| 4+ | **A transition week runs before Week 1.** Reuse the block's own deload week rather than authoring a new one — it is already the right shape, and the numbering stays honest |

Two corollaries worth writing into any plan that needs a transition week:

- **"Week N" means the Nth week *trained*, not a calendar week.** Say so explicitly, because every
  gate and every "for 5 consecutive days" clause is otherwise read against the wrong dates later.
- **Time off sick or injured is not a deload you then repeat.** Several days of rest *is* the
  transition week; stacking a reduced week on top of a week spent unwell just costs a second week.

This is not hypothetical. Jacques trained four weeks of `2026-07-06_crossfit-original` — a block
with **no deload week in it at all** — and started `2026-08-03_tendon-led-crossfit` the next day.
Week 1 was week 5 of unbroken loading, Week 4's deload would have been week 8, and the week ended
in illness, which the profile already named as his failure mode. Tannah's parallel block made the
same arithmetic error at the same time. Both phase maps now carry a §5 recording it.

## Decision principles to apply while planning
- **Safety and medical escalation first**, then long-term continuity, then symptoms/recovery, then the block's primary adaptation, then secondary qualities, then adherence, then novelty.
- **Count the loading weeks before choosing the rhythm.** A deload/loading shape is only defensible against where the athlete actually *starts* — see "Week 1 is not week 1" above.
- **Prefer the smallest effective structure.** Do not default to a "3 loading + 1 deload" shape — justify the loading/deload rhythm from training age, goal, fatigue cost, symptoms, recovery history, and upcoming events.
- **Distinguish** evidence-supported principles, coaching inference, athlete-specific judgement, and genuine uncertainty. Flag high-stakes or injury-related decisions.
- Turn any overreaching / illness history into explicit **autoregulation hard stops** in the plan (e.g. consecutive below-baseline readiness → mandatory downshift).

## Output
A single Markdown file at `athlete/<slug>/plans/<Athlete or Block name> - Program Planning Doc.md`, ending with an explicit Approval section. Nothing else. No sets-and-reps, no spreadsheet.

The plan must state the **block length in weeks** explicitly, because `program-builder`
authors every one of those weeks as real rows and validates the count. It must also carry
this athlete's injury/loading constraints and readiness hard stops forward in full — the
builder reads the plan, not the profile, for those decisions.

It must also state the **consecutive loading weeks the athlete arrives with** and **how the block
opens as a result** (see "Week 1 is not week 1"). Record it as a number with its source — a
verified count from the previous block's files, or the athlete's own account where no files exist.
An unstated count reads as zero to every later reader.
