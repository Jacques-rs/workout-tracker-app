# CLAUDE.md — Workout Tracker App

The working rules for this repo. `AGENTS.md` points here, so this file is not Claude-specific.

## Who owns which fact

Every fact has exactly one owner. **If two files disagree, the owner wins** — fix the copy rather
than the reader.

| Fact class | Owner |
|---|---|
| How the app works — routes, state, storage keys, sync, quirks, styling, service worker | `docs/architecture.md` |
| The JSON schemas and how to read every version | `docs/data-contracts.md` |
| *Why* the app is shaped this way — the design arguments | `docs/design-rationale.md` |
| What the account layer promises and the guardrails on it | `docs/backend.md` |
| Canary, release smoke and incident procedure | `docs/private-beta-runbook.md` |
| Everything not built: candidates, deferred, declined | `docs/roadmap.md` |
| Fixtures and the test inventory | `samples/README.md` |
| Coaching-side layout and privacy | `athlete/README.md` |
| Install/run for a human | `README.md` |
| **The rules below** — constraints, conventions, verification and deploy policy | this file |

## Parsimony — how to keep this repo readable

Docs and comments are context every future session pays for, and a stale line is worse than a
missing one because an agent believes it. Before adding prose, apply these.

- **One fact, one owner.** Need it somewhere else? Link to the owner. Never restate it — two copies
  become two versions, and the reader cannot tell which is current.
- **Present tense only.** No "used to", no "we changed X to Y", no "this fixed the bug where".
  Keep the constraint, drop the chronology: write "never `inputmode="numeric"` here — a digits-only
  keypad makes a 45-second hold untypeable", not "it used to be numeric, which broke holds". Git
  holds the history and `git log -S` finds it.
- **Nothing records completed work.** No "Done" sections, no shipped lists, no phase plan left in
  place after the phase. When something ships, its roadmap entry is *deleted*, not annotated. Same
  for **dated stamps and incident transcripts** — no "Last updated:", no "decided 2026-08-15", no
  outage post-mortems. Keep the rule an incident taught; drop the incident.
- **Never hand-copy a number a file already computes** — not a test count, a version, or a command
  list. Point at `scripts/verify.sh` or `samples/README.md`. Every such number here had drifted.
- **A comment says why, not what.** If it restates the line below it, delete it. If it is a longer
  argument than the code it sits above, it belongs in `docs/` — leave the invariant and a one-line
  pointer. Never stack a new comment on top of the one it replaces.
- **An instruction here must outlive its prompt.** A correction from one session, a workaround for
  one tool, a bug to re-check by hand — none of these are repo rules. Turn a regression into an
  assertion in `samples/apptest.js` and drop the rest.
- **Delete before you add.** A change that adds a paragraph should say what it removed, or why the
  fact had no existing owner.
- **Budget: this file stays under 275 lines, `AGENTS.md` under 15.** It is at that ceiling now, on
  purpose — the next rule has to displace an existing one, not sit beside it.

## What this is

A single-purpose **installable PWA** that displays one athlete's training programme, logs each
session **offline in the gym**, and exports it as JSON for review by an AI coach in a separate
Claude project. It is an invite-only, account-backed personal tool: Supabase Auth, the private
programme library, account-scoped settings and retryable session sync are all integrated, and none
of them sits in front of the device-first logging path. Do not bypass the offline-first boundaries
in `docs/backend.md`, and do not broaden the beta into a public platform.

### More than one athlete — where the line is

Two people use this, at **two different layers**, and conflating them is the mistake to avoid.

- **The coaching side (`athlete/`) is genuinely multi-athlete** — one folder per person, and the
  skills take the athlete as an input. Injury protocols, pain-monitoring rules and readiness hard
  stops are per-athlete *data*, never hardcoded in a skill. See `athlete/README.md`.
- **The app is per-device, not multi-profile.** The second athlete installs the PWA on her own phone
  and signs in as herself. One programme at a time (`tp_program_v1`). **There is no profile
  switching and nothing in the workout autosave path is keyed by person** — remote ownership lives
  at the auth and store boundaries, not by rewriting session keys. `athleteId` is a contract label
  carried into the export, never an authorization identifier.

**Settings have two scopes, and which one owns a key is decided in exactly one place**:
`ACCOUNT_KEYS` / `DEVICE_KEYS`, with `setSetting()` the only writer. Account-scoped settings follow
the athlete to any device (last write wins, per field); device-scoped ones stay on the phone.
`docs/design-rationale.md` says why the split falls where it does.

## The wider workflow this app sits in

This repo is **step 3** of a four-step loop: a coaching project **plans** and **builds** a
programme, the athlete **tracks** it here, and `review-workout-log` **reviews** the exported log and
revises the next week. Steps 1, 2 and 4 live under `athlete/` — see `athlete/README.md`. Cloud
backup does not connect the app to those tools: their only integration is the versioned JSON
contracts, `program.json` in and `session-<date>-<day>.json` out. A revised week is re-imported by
hand; the app does not prompt for it.

**Implication for design decisions:** the app's job is to make *capturing decision-relevant data*
fast and reliable under gym conditions. Every field exists because a coach needs it downstream.
Read the relevant `athlete/<slug>/personal-profile.md` (local-only, gitignored) before removing or
restyling any input — the pain, readiness and RPE fields serve a specific tendon-monitoring protocol.

### Schemas — programme v2 in, session v3 out

The two sides version independently. **`tp-program-2` in, `tp-session-3` out.** Full detail in
`docs/data-contracts.md`; two things matter at this level. **Every reader must accept every version,
indefinitely** — a v1 programme can be sitting in `localStorage` on a phone mid-block, and v1/v2 log
files are already on disk. In the app the entire programme-version difference is decided by
`isV2()`, and every consumer asks `dayExercises()`; **do not scatter `meta.schema` checks beyond
those two functions.** The app only ever *writes* the newest session version — reading old logs is
the coaching side's job. And **`amPainOnWaking` describes the response to the *previous* session,
not this one**; that attribution flip is the thing to get right in any reader.

## Architecture in one paragraph

`index.html` is the app — markup, CSS and JS inline, no build step, framework or npm runtime.
`sw.js` caches the app shell. Every remote boundary is a small module in `js/`, one per concern, and
none is called from a render or input handler. `vendor/supabase-js-*.min.js` is pinned and vendored,
never loaded from a CDN. `program.json` is a bundled **sample**. `docs/architecture.md` has the
file-by-file table.

### Screen rules you can break by accident

`docs/architecture.md` describes the screens; `docs/design-rationale.md` says why. These are the
invariants:

- **`showRoute()` is the only thing that touches a surface's `hidden` flag.** Never toggle one from
  a handler.
- **`STATE.week` / `STATE.day` must always be read off the claim, never re-derived from the
  schedule.** `saveSession()` writes them from `STATE` on every keystroke, so a `STATE` re-derived
  from the schedule silently rewrites the claim — and the athlete trains off the wrong week. This is
  the subtlest way to break the date-first model.
- **Editing a sealed session does not un-seal it.** It sets the edited-since-export flag. Un-sealing
  because a typo was fixed would flip the calendar back to "unfinished", which is a lie about that day.
- **The check-in never gates Start**, and the primary action sits above it.
- **Overview is read-only — zero inputs** — and always renders a status line plus a `○ / ◐ / ✓`
  badge. The two views do **not** share a card builder, but they must share `exerciseHead()`: change
  how an exercise's identity is displayed *there*, so they cannot show two different prescriptions
  for one row.
- **Never re-hardcode `inputmode="numeric"` on the reps field** — `metricOf()` decides its label,
  unit, keyboard and placeholder, and two prescriptions in five are a duration, a distance or prose.
- **Upcoming set chips are inert** — a plan, not a destination and not a delete button. The Adjust
  sets sheet can never reduce the plan below the current set.
- **Amber means *now*; green means *logged*.** A secondary action that borrows either competes with
  the one tap that matters, so quiet actions are muted and underlined.
- **A typed set is never lost.** `flushDraft()` commits a draft the athlete typed into when they end
  early, page away, change day/week/view, export or background the app. Only a *dirty* draft — a
  seeded copy of the last set is not a set that happened. **Anything that flushes must re-render**,
  or a card holding the older session object autosaves over the commit.

## Repo layout

```
index.html  sw.js  manifest.webmanifest  icon-*.png  privacy.html   the PWA — deploy root
program.json          bundled SAMPLE programme
js/  vendor/          remote-boundary modules; pinned Supabase browser SDK
supabase/  scripts/   migrations, seed, pgTAP tests; verify.sh
samples/  docs/       fixtures + tests; the docs in the table above
.github/workflows/    verify on PR, hourly availability check
athlete/              README.md + skills/ + sources/ committed; <slug>/ GITIGNORED
```

The PWA must stay at the **repo root** — Pages serves `/`, and moving it breaks the deployed URL and
every installed home-screen icon. `Fitness/training-prog-project/` backs up everything gitignored
under `athlete/`, because a branch switch or `git clean` can delete those silently. Several
worktrees of this clone exist (`git worktree list`); `athlete/` exists only in the one that made it.

## Hard constraints — do not break these

- **No build step.** No bundler, transpiler, framework or package manager. Someone must be able to
  edit `index.html` and reload.
- **No runtime network dependency.** No CDN script or webfont; the Supabase SDK is vendored. The app
  must open with zero network, because it is used in a gym basement — anything needing the network
  degrades to a no-op and never blocks the UI.
- **Relative paths only** (`./sw.js`, `./program.json`). The app is hosted from a subpath.
- **`localStorage` is the source of truth for in-progress logs.** Never clear it as a side effect.
  Autosave on every input; a dropped connection or closed tab must never lose a logged set. The
  remote stores are queues *behind* it, never in front. `tp_pos_v1` is retired — position is derived
  from the open date, and a stored one could disagree with the claim.
- **Never commit real training data. The GitHub repo is public.** Every `athlete/<slug>/` folder
  holds medical detail and a training record, so the ignore rules are **deny-by-default**:
  `athlete/*` (no trailing slash, so it catches stray files too) with only `.gitignore`,
  `README.md`, `skills/` and `sources/` named back in. **Do not invert this into a list of things to
  exclude** — then anything you did not think of is published by default. Before any commit touching
  `athlete/`, run `git status` and `git check-ignore -v <path>`: health data in public git history
  is permanent, and deleting the file later does not remove it.
- **Schema compatibility.** `tp-program-2` comes from an external skill, so if you change what the
  app expects, update `docs/data-contracts.md` and its fixtures in the same commit and say so in the
  response — the generator must change in lockstep. Dropping v1 support strands a phone mid-block.

## Conventions

- Plain ES5/ES6-compatible vanilla JS. Use the existing `$` and `el` helpers, not a library.
- Mobile-first, single 720px-max column. Touch targets ≥26px, reachable one-handed with a chalked-up
  thumb. **320px is the real floor.**
- **Themed via CSS variables — never hardcode a colour.** Two palettes × light/dark are four
  `html[data-theme]` blocks at the top of the `<style>`; every colour in a rule below them must be a
  `var(--…)`, or it survives a theme switch and looks broken in one of the four. Category rail
  colours live in `--cat-*`, so `CATS` holds `var()` references, not hex.
- `type="number"` only for **integer** fields with no partial-invalid state, such as a pain score.
  For anything that can hold a decimal mid-type (RPE `"7.5"`) or prose (Load `"BW+20"`), use
  `type="text" inputmode="decimal|numeric"`: a real number input reports `.value === ""` while the
  text is not yet valid, so the autosaved value flickers blank. Text + `inputmode` keeps the value
  exactly as typed, which the export contract requires — every logged value is a string.
- **`inputmode="numeric"` is a digits-only keypad on iOS**, with no letters and no decimal point.
  Use it only where the value genuinely cannot be anything else, and **never as a default**: the
  fallback for a field whose content you cannot predict is a full keyboard.
- **Field labels are `nowrap` + ellipsis, so keep them short** — one that wraps drops its own input
  below the others in the same grid row. The metric column is ~68px at 360px, hence `Dist`/`Work`.
  Put a unit **in the label**, not as an overlay inside the field: a 3-character suffix beside a
  4-character value clips it in that column.
- **Keep the JS in its existing banner-delimited sections, in the existing order.**
  `docs/architecture.md` lists them all; if you add one, add it there too.
- **Repaint, don't rebuild, on autosave.** `saveSession()` runs on every keystroke and calls
  `updateProgress()`, so anything reached from there must set attributes and text on nodes that
  already exist (`paintNav()` is the model). An input's `oninput` writes into the row/draft and
  saves and must **never** rebuild a container it lives in — that is what makes a field lose focus
  mid-word. A deliberate tap may rebuild the editor, but set transitions stay passive and never
  focus a field; only an action explicitly targeting an input, such as **+ note**, may focus one.
  `paintNav()` scrolls the pip strip **only when `STATE.focus` changes**, never while an input has
  focus.
- Bump `CACHE` in `sw.js` whenever a shell file changes, or returning users get a stale app.

## Verifying changes

```bash
./scripts/verify.sh     # the implementation gate — runs everything
```

It needs Docker and the pinned Supabase CLI, and covers the database security suite, schema lint,
the local Auth flow, inline-JS syntax, the JSON fixtures, the programme validator and every
dependency-free test. `.github/workflows/verify.yml` runs the same script on every PR and on
`dev`/`main`. Extend `samples/apptest.js` when you touch filtering, logging or export, and
`samples/validatortest.py` when you add a rule to `validate_program.py` — a validator with no
negative test is worse than none, because it buys false confidence.

**Deployed browser testing is a separate release-smoke gate**; if no controllable browser is
connected, report that smoke as pending.

**Hosted Supabase Auth email is approval-gated.** Before triggering an invite, password recovery,
signup confirmation, email change or resend against the hosted project, ask Jacques for explicit
approval and warn that it spends the project's shared hourly Auth-email allowance. A general request
to test authentication is not approval to spend it. Local Supabase/Mailpit tests are exempt and run
inside `./scripts/verify.sh`.

Then manually, **against both fixture versions** in `samples/` (a v1 programme must keep working,
which is the whole point of keeping both): import, log a few sets, reload (**the open date and the
claimed `(week, day)` must both come back**), toggle airplane mode, export. Walk every route —
Start a scheduled date, Resume a claimed one, Review a sealed one, open a rest day, claim a
different week *and* day and confirm the prescriptions follow the week, then Finish and confirm an
edit leaves the date sealed but marks the file stale. Do it in at least one **light** theme; a rule
that hardcodes a colour looks fine in the palette you wrote it in.

**Check 320px for horizontal overflow, not just for looks** — the one check `apptest.js` cannot make
for you. Load the app in a 320-wide `<iframe>` and compare `documentElement.scrollWidth` against
`clientWidth` on every surface. A narrow browser-window screenshot will not show this: Chrome clamps
its window width, so the image is a crop of a wider layout.

## Deployment

**GitHub Pages** serves `/` from the **`dev`** branch of the **public** repo
`Jacques-rs/workout-tracker-app`, live at <https://jacques-rs.github.io/workout-tracker-app/>, via
the `legacy` (Jekyll) builder. Pushing `dev` deploys. The repo is public because that is the free
way to get the HTTPS a service worker requires — which is exactly why the `athlete/` rules above are
non-negotiable. **Check the branch, don't assume it:**

```bash
gh api repos/Jacques-rs/workout-tracker-app/pages --jq '.source.branch, .status'
curl -s https://jacques-rs.github.io/workout-tracker-app/sw.js | grep CACHE   # which build is LIVE
gh run list -R Jacques-rs/workout-tracker-app --limit 5                       # the real build record
```

When a push doesn't reach the phone, **read the workflow run, not the `pages/builds` API** — the run
has two jobs and which one failed is the whole answer. `build` failed is **our content**: read the
log and fix the repo. `build` passed but `deploy` failed is **not our content** — the site built and
only publishing failed, usually GitHub's side, so check <https://www.githubstatus.com> and **re-run
the failed job** rather than inventing a commit. Only once the live `sw.js` shows the new `CACHE`
value is a stale phone the worker's fault, and the fix for that is a reload.
