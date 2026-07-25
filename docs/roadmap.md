# Roadmap & known gaps

Ordered roughly by value-per-effort. Each item says *why*, because the guiding principle is that reliability and speed in the gym beat extra features.

## High value

**1. Interval / EMOM timer.**
The programme leans on EMOM and interval formats ("EMOM every 90s", "45 sec hard / 75 sec easy", "2 min hard / 1 min easy"). Right now the athlete uses a separate timer app, which means leaving the tracker mid-session. An in-app timer that reads the `rest`/`reps` strings (or is set manually) would remove the one reason to switch apps. Must keep running with the screen locked or backgrounded if possible — verify behaviour before promising it.

**2. "Prefill from last time" per exercise.**
Most logged values barely change week to week. Showing last session's actual load/reps/RPE as placeholder text (or a one-tap "same as last week") would cut logging time significantly. The data is already in `localStorage` — this is mostly a lookup across session keys.

**3. Backup / restore all data.**
Everything lives in `localStorage`. There is currently no way to snapshot it. A single "Export all data" (and matching import) protects against a cleared browser, a lost phone, or storage eviction. **Risk worth verifying:** browsers can evict storage for sites that go unused; installed PWAs are generally more durable, but a periodic backup is the cheap insurance either way.

## Medium value

**4. Session history / trend view.**
A simple list of past sessions, and per-exercise history (load and RPE over weeks, plus the knee-pain trend). The pain trend is genuinely decision-relevant — "no upward trend week over week" is one of the coaching rules — so surfacing it in-app would let the athlete self-correct before the coach review.

**5. Reduce the export→save friction.**
Today: export downloads a file, then the athlete saves it into the Drive folder via the share sheet. Options, in increasing effort: (a) a "share" button using the Web Share API so it goes straight to Files/Drive; (b) exporting a whole week in one file; (c) real cloud sync via the Drive API, which would mean credentials and a backend — explicitly rejected so far.

**6. `localStorage` housekeeping.**
Old `tp_sess_v1::*` keys accumulate forever. Harmless at this volume, but a "clear sessions older than N months" action (after backup) keeps things tidy.

**7. Week-aware exercise filtering.**
The app currently filters by day only, because the generator authors Week 1 as a template. If the `program-builder` skill is ever changed to author all weeks explicitly, the filter must become day **and** week, and the "apply your progression rule" banner should be removed. Coordinate both sides — see `docs/data-contracts.md`.

## Lower value / speculative

**8. Set-by-set logging.** Currently one row per exercise (actual load, sets×reps, RPE). Per-set rows would be more precise for top-set + back-off work, but adds taps in the gym. Probably not worth it — the coach reasons about top sets and overall quality, not every rep.

**9. Plate calculator.** Nice-to-have; the athlete is advanced and does this arithmetic automatically.

**10. Multiple programmes side by side.** Only one programme is stored (`tp_program_v1`). Fine for a linear block structure; would only matter if running two blocks at once.

## Explicitly not doing

Accounts, multi-user, a backend, analytics, a framework rewrite, an app-store native build. All rejected: they add maintenance and failure modes to a tool whose main virtue is that it opens instantly and works with no signal.

## Housekeeping reminders

- Bump `CACHE` in `sw.js` whenever a shell file changes.
- Keep `program.json` in the repo as a **sample** only — never a real programme, never real logs.
- Re-check the JSON contracts in `docs/data-contracts.md` if either side of the loop changes.
