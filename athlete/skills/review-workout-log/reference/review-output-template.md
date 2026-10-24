# Review output template

The shape of the chat response `review-workout-log` produces. It is a response, not a file —
nothing is written to disk before approval.

Keep it short. The athlete reads this on a phone, often between meetings. Sections that have
nothing to say get one line, not a paragraph of hedging.

---

## 1. What you did

One or two sentences: which session, which week and day, and the headline. Name the file so
there is no ambiguity about which log this is.

> **Week 4, Day 1 (Mon)** — logged 2026-07-27. Session completed; front squat top set came in
> 20 kg under prescription and the sled was cut short.

If `programVersion` is behind the current `meta.version` (or, on an older log, the `prescribed`
values disagree), say it **here**, before anything else:

> ⚠️ This log is stamped v2; the programme is on v3. You trained off the older week — re-import
> `program.json` before the next session. The deviations below are read against what your app
> actually showed you, not against v3.

## 2. Against the prescription

A short table, only for exercises that matter (the ones the builder gave a `logHint`). Skip
warm-ups and mobility.

| Exercise | Prescribed | Logged | Read |
|---|---|---|---|
| Heel-elevated front squat | 4×4 @ ~100 kg, RPE 7 | 100/80/80, RPE 9→7 | First set overshot; the drop was the right call |
| Sled push | 6×20 m @ 80 kg | 3×20 m @ 80 kg | Cut for knee pain — see below |

Per-set detail goes in the Logged column as the shape (`100/80/80`), never averaged.

State deviations plainly, including favourable ones. Say what was skipped.

## 3. Symptoms and readiness

Only if the athlete tracks them (`tracking`). Three things, in this order:

- **Pain during** — this session, per exercise where it moved.
- **Pain on waking** — and *which morning it describes*. On a v3 log it is the response to the
  **previous** session, so name that session: "woke at 4/10 the morning after Friday's sled".
  If the gap to the previous log is more than a day, call it a baseline rather than a response.
  If it is blank, say it wasn't logged rather than reading it as zero.
- **The trend across the block** — the clause that actually decides. One line:
  `W1 2/10 · W2 2/10 · W3 4/10 · W4 6/10 — upward three weeks running.`

Then readiness / sleep / HRV in one sentence, and what it does to the reading above.

Red flags (sharp pain, swelling, giving way, night pain, anything neurological) get their own
line at the top of this section and a direct recommendation to get it assessed. Do not soften
it and do not program around it.

## 4. What I'd change

The smallest effective adjustment, as a short list. Each item: exercise, old → new, and the
reason in one clause tied to the data above.

> - **W5 Day 1 front squat → low-bar back squat**, same sets/reps, RPE 7. Reason: knee pain
>   trending up three weeks and it's depth-and-knee-travel driven.
> - **W5 sled held at 80 kg** rather than the planned 90 kg. Reason: 6/10 during, above the
>   5/10 gate.

If nothing needs to change, this section is one line: **"Nothing — run W5 as written."** That
is a normal outcome and saying it is better than finding something.

## 5. Rules for the gym

Pre-authorised, so nothing waits on a reply. Two or three branches, each decidable from
something the athlete can observe, every branch authorised.

> **Monday, before the squat:**
> - Knee ≤2/10 on waking → top set as written.
> - 3–4/10 → hold last week's load, drop the last set.
> - Sharp at any point → skip the sled, finish with the 5×45 s isometric.

These also go into the row's `Progression Rule` cell on approval, so the app shows them on the
card. Say that.

## 6. Approval

Explicit, and explicit that nothing has been written.

> Nothing's been changed yet. Say the word and I'll revise W5, snapshot the current version as
> v2, and log the reason in the changelog — then you re-import `program.json` into the app.

---

## After approval

Confirm in four lines or fewer:

> Done — programme now at **v3**. Snapshot of v2 in `revisions/program-v2.json`, reason logged
> in `CHANGELOG.md`. Workbook rebuilt.
>
> **Re-import `program.json` into the tracker** — the app will keep showing the old W5 until
> you do.

The re-import instruction is the last line. Every time.
