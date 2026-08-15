# CLAUDE.md — Workout Tracker App

Context for working on this repo. `docs/architecture.md` is the canonical implementation
description; `docs/backend-launch-plan.md` is authoritative for the staged account and sync work.

## What this is

A single-purpose **installable PWA** that displays one athlete's training programme and logs each session **offline in the gym**, then exports the session as a JSON file for review by an AI coach in a separate Claude project.

The shipped client is still a personal, local-only tool. A Supabase foundation now exists for an
invite-only beta, but auth, programme storage and sync must arrive only in the phases defined in
`docs/backend-launch-plan.md`; do not bypass the offline-first boundaries or broaden the beta into a
public platform.

### More than one athlete — where the line is

Two people use this: Jacques and his partner. They are handled at **two different layers**, and conflating them is the mistake to avoid.

- **Coaching side (`athlete/`) is genuinely multi-athlete.** One folder per person — `athlete/<slug>/` holding `personal-profile.md`, `plans/`, `programs/`, `logs/`. The `program-planner` and `program-builder` skills take the athlete as an input and read only that person's profile. Injury protocols, pain-monitoring rules and readiness hard stops are per-athlete data, never hardcoded in a skill. See `athlete/README.md`.
- **The app is per-device, not multi-profile.** A second athlete installs the PWA on her own phone, which gives her her own `localStorage`, settings, programme and logs. One programme is stored at a time (`tp_program_v1`). Which optional fields appear, and what the pain field is called, is a per-device preference in the drawer's Tracked fields section (`tp_settings_v1`) — that is how athlete-specific needs reach the UI.

So, in the current client: **no profile switching and nothing keyed by person inside the workout
autosave path.** The account phase will add remote ownership at explicit module boundaries, not by
rewriting the existing `localStorage` keys. `athleteId` remains a contract label carried from the
programme into session export; it is not an authorization identifier.

## The wider workflow this app sits in

This repo is **step 3** of a four-step loop. Steps 1, 2 and 4 are done by a Claude coaching project whose data now lives **inside this repo, under `athlete/`** (see Repo layout). Cloud backup does not connect the production app to the AI coaching tools: their integration remains the versioned JSON contracts.

1. **Plan** — a `program-planner` skill reads `athlete/<slug>/personal-profile.md`, interviews the athlete, and writes a Program Planning Doc into `athlete/<slug>/plans/`, which the athlete approves.
2. **Build** — a `program-builder` skill turns the approved plan into three artefacts in `athlete/<slug>/programs/`: a Markdown phase map, a colour-banded `.xlsx` with one tab per week, and **`program.json`** (schema `tp-program-2`). **Every week of the block is authored explicitly** — see below.
3. **Track (this repo)** — the athlete imports `program.json`, trains, and logs the session offline. The app exports **`session-<date>-<day>.json`** (schema `tp-session-3`).
4. **Review** — the athlete saves that file into `athlete/<slug>/logs/` and the `review-workout-log` skill compares logged loads/RPE/pain against the prescription for that week and day, proposes the smallest effective adjustment behind an approval gate, and on approval revises the week: `rows.json` is edited, both builder scripts re-run, the superseded `program.json` is archived to `revisions/`, `meta.version` bumps and `CHANGELOG.md` records **why**. The athlete then re-imports — a manual step the app does not prompt for.

**Implication for design decisions:** the app's job is to make *capturing decision-relevant data* fast and reliable under gym conditions. Every field exists because a coach needs it downstream. Read the relevant `athlete/<slug>/personal-profile.md` (local-only, gitignored) before removing or restyling any input — the pain, readiness and RPE fields exist for a specific tendon-monitoring protocol.

### Schemas — programme v2, session v3

The two sides version independently. Current: **`tp-program-2` in, `tp-session-3` out.**

- `tp-program-2` materialises every week as real rows, instead of Week 1 plus a prose progression rule. This fixed the live bug where the app showed Week 1 prescriptions no matter which week was selected. It also carries an optional `meta.version` — the revision number, bumped when a week is revised mid-block.
- `tp-session-2` added a per-set `sets[]` array alongside the flat summary fields. The shape hasn't changed since, but per-set logging is no longer opt-in: the app now logs **one set at a time** by default (see "Where a thing goes on screen" below), so `sets[]` is normally populated for anything actually trained. The flat fields are auto-filled from `sets[]` as each set is confirmed and stay editable — never recomputed once the athlete overrides them.
- `tp-session-3` moved next-morning pain to a **pre-session** reading: `amPainOnWaking` (with `tracking.painOnWaking`) replaces `amPainNextDay`, and is captured at check-in. **It describes the response to the *previous* session, not this one** — that attribution flip is the thing to get right in any reader. It also adds `programVersion`, the revision the athlete actually trained off.

**Every reader must accept every version indefinitely.** A v1 programme can be sitting in `localStorage` on a phone mid-block, and v1/v2 log files are already on disk. In the app the whole programme-version difference is decided by `isV2()`, and every consumer asks `dayExercises()` — v2 filters by day **and** week, v1 by day only and keeps the "apply your progression rule" banner. Do not scatter `meta.schema` checks beyond those two functions. The session schema has no such branch: the app only ever *writes* the newest version, and reading old logs is the coaching side's job.

`samples/` carries fixtures for every version, and `samples/apptest.js` exercises both programme versions. Full detail in `docs/data-contracts.md`.

## Architecture in one paragraph

`index.html` is the current app — markup, CSS, and JS inline, no build step, framework or npm runtime. `sw.js` caches the app shell. `program.json` is a bundled **sample** and imported programmes persist in `localStorage`. The repo-managed backend lives under `supabase/`, but no frontend module calls it yet. Full detail in `docs/architecture.md`.

### Where a thing goes on screen

There are three surfaces, and putting something on the wrong one is the mistake that made the old layout cluttered:

- **Header** — a two-row strip: ≡ and a tappable context line (`Week 3 · Tue 5 Aug` over the day's theme — the date lives here, not in its own row) on row 1; a worded Overview/Log toggle and the done count on row 2, with the progress bar (or, in Log, the exercise pips) beneath. **No inputs.**
- **`<main>`** — exercise cards, and nothing else.
- **Drawer** — week (a stepper, not a `<select>`), day, date, the session check-in, import/export, settings. Everything entered once per session and then only read.

`<main>` has two views, chosen by the header toggle and remembered per device:

- **Overview** — every exercise for the day, **read-only, zero inputs.** Name, prescription, and **always** a status line plus a `○ / ◐ / ✓` badge: "Not started", "2 of 4 sets logged", "Set 3 typed — not logged yet", or the full summary once finished. Always, because an absent line used to mean "untouched" and was indistinguishable from a status that failed to render. Tap a card to open it in Log.
- **Log** — one exercise at a time. Ordinary work is logged **per set**: the prescribed count is already present, only one set's fields are visible, and the full-width primary commits it. The final planned set completes and advances automatically. Adding/removing planned sets lives behind the quiet **Adjust sets** action. Before any work the explicit exit is **Skip exercise**; after partial work it is **End after N of M**, with a confirmation that says exactly what will be kept. A completed card offers Reopen / Add another set.
  - Circuit prescriptions use an adaptive logger instead of generic kg/result fields. Fixed rounds default to one large **Complete round N** tap; AMRAP, EMOM, for-time work and ladders default to a tailored final-result form. **Quick rounds / Round details / Final result** is always available as a quiet mode override. The last prescribed quick round opens one compact finish sheet for optional time/result, final RPE, pain and a note.
  - **RPE is a bottom-sheet picker**, 1–10 in 0.5 steps, everywhere it is captured. Stored values remain strings, and legacy prose remains visible until the athlete replaces it.
  - The **reps field is whatever the exercise measures** — `metricOf()` reads the prescription and gives it a label, unit, keyboard and placeholder (`Hold (s)`, `Time (min)`, `Dist (m)`, `Work (cal)`, `Reps`, `Result`). Never re-hardcode `inputmode="numeric"` there: two prescriptions in five are a duration, a distance or prose, and a digits-only keypad made a 45-second hold untypeable.
  - **Upcoming set chips are inert.** They are a plan, not a destination and not a delete button. The Adjust sets sheet can never reduce the plan below the current set.
  - **A typed set is never lost.** `flushDraft()` commits a draft the athlete has typed into when they end early, page away, change day/week/view, export, or background the app. This includes a detailed circuit round. Only a *dirty* draft — a seeded copy of the last set is not a set that happened. **Anything that flushes must re-render**, or a card holding the older session object autosaves over the commit.

The two views do **not** render the same card builder any more — one is read-only, one is an editor, and forcing them through one branchy function invites more drift than it prevents. What they must still share, and do, is `exerciseHead()`: the rail colour, name and prescription line. If you touch how an exercise's identity is displayed, change it there so Overview and Log cannot show two different prescriptions for the same row.

Every keystroke inside the Log editor writes into the row/draft and autosaves; only a deliberate tap (commit / save / cancel / delete / finish) may rebuild the set-editor DOM — see "Repaint, don't rebuild" below. This is what fixed the reported bug where typing in a set field lost focus after one character.

## Repo layout

```
index.html  sw.js  manifest.webmanifest  icon-*.png   the PWA — deploy root, committed
program.json                                          bundled SAMPLE programme, committed
samples/                                              fixtures for development (every schema version)
docs/                                                 committed docs (see README table)
athlete/                                              coaching project data
  README.md              layout + privacy rules              (committed)
  skills/                planner, builder, review-log        (committed)
  sources/               coaching research notes             (committed)
  <slug>/                ONE FOLDER PER ATHLETE              (gitignored)
    personal-profile.md    health, injuries, strength baselines
    plans/                 Program Planning Docs
    programs/<block>/      phase map, .xlsx, rows.json, program.json,
                           CHANGELOG.md, revisions/program-v<N>.json
    logs/*.json            exported session logs
```

A **block folder** is whichever directory holds that block's `program.json`; revisions and the
changelog sit beside it. New blocks get their own subfolder under `programs/`; older flat ones
are left where they are rather than migrated.

The PWA must stay at the **repo root** — GitHub Pages serves `/`, and moving it breaks the deployed URL and every installed home-screen icon.

`Fitness/training-prog-project/` remains the backup for everything gitignored under `athlete/` — gitignored files can be lost by a branch switch or `git clean`. The skills themselves are now canonical in `athlete/skills/`; see `athlete/README.md`.

### Two worktrees

- `Fitness/workout-tracker-app/` — branch `main`.
- `Fitness/workout-tracker-app-dev/` — branch `dev`. Do the work here.

**`dev` is currently the branch GitHub Pages serves**, so pushing `dev` deploys. It used to be
`main`, and the docs went stale when it changed — so **check, don't assume**:

```bash
gh api repos/Jacques-rs/workout-tracker-app/pages --jq '.source, .status'
```

Both are git worktrees of the same clone, so `athlete/` exists only in the worktree it was created in.

## Hard constraints — do not break these

- **No build step.** No bundler, transpiler, framework, or package manager. Someone must be able to edit `index.html` and reload.
- **No external runtime dependencies.** No CDN scripts or webfonts. The app must work with zero network. (Inline SVG/emoji-free glyphs or plain text only.)
- **Offline-first is the point.** It's used in a gym basement. Any feature that needs the network must degrade to a no-op, never block the UI.
- **Relative paths only** (`./sw.js`, `./program.json`). The app is hosted from a subpath (`https://jacques-rs.github.io/workout-tracker-app/`) — absolute paths break it.
- **`localStorage` is the source of truth for in-progress logs.** Never clear it as a side effect. Autosave on every input; a dropped connection or closed tab must never lose a logged set.
- **Never commit real training data. The GitHub repo is public.** Every `athlete/<slug>/` folder holds medical detail and a training record. The ignore rules are **deny-by-default**: `athlete/*` (no trailing slash, so it matches stray files too), with `.gitignore`, `README.md`, `skills/` and `sources/` named back in. That way a new athlete's folder, and anything unanticipated inside it, is covered the moment it exists. **Do not invert this into a list of things to exclude** — then anything you didn't think of is published by default. The bundled `program.json` stays a sample. Before any commit that touches `athlete/`, run `git status` and `git check-ignore -v <path>`; health data in public git history is permanent, and deleting the file later does not remove it.
- **Schema compatibility.** `tp-program-2` is produced by an external skill. If you change what the app expects, update `docs/data-contracts.md` and say so clearly in the response, because the generator must change in lockstep. The app accepts programme v1 and v2; dropping v1 support strands a phone mid-block. On the session side the app writes `tp-session-3` only — but `review-workout-log` must keep reading v1 and v2 logs, which are already on disk.

## Conventions

- Plain ES5/ES6-compatible vanilla JS. Small helpers (`$`, `el`) already exist at the top of the script — use them rather than adding a library.
- Mobile-first, single 720px-max column. Touch targets ≥26px; inputs must be reachable one-handed with a chalked-up thumb.
- **Themed via CSS variables — never hardcode a colour.** Two palettes (Amber / Mint) × light/dark are declared as four `html[data-theme]` blocks at the top of the `<style>`; the Appearance section of the drawer picks palette + mode (Auto follows the device). Every colour in a rule below those blocks must be a `var(--…)`, or it will survive a theme switch and look broken in one of the four. The only exceptions are two neutral greys (a `color-mix` fallback and a swatch hairline). Category rail colours live in `--cat-*`, so `CATS` in the JS holds `var()` references, not hex.
- `type="number"` for **integer** fields with no partial-invalid state (pain scores, 0–10). For a field that can hold a decimal mid-type (RPE: `"7.5"`) or non-numeric prose (Load: `"BW+20"`), use `type="text" inputmode="decimal|numeric"` instead — a real `type="number"` input reports `.value === ""` while the text isn't yet a valid number (typing the `.` in `7.5`), so the autosaved value would flicker blank. Text + `inputmode` still gets the right keyboard and keeps the value exactly as typed, which is also what the export contract requires (every prescription and logged value is a string).
- **`inputmode="numeric"` is a digits-only keypad on iOS** — there is no way to type a letter or a decimal point. Use it only where the value genuinely cannot be anything but whole digits, and never as a *default*: the fallback for a field whose content you can't predict is a full keyboard. This is what `metricOf()` decides for the reps field.
- **Field labels are `nowrap` + ellipsis, so keep them short.** A label that wraps to two lines drops its own input below the others in the same grid row. The metric column is ~68px at 360px, which is why the metric labels are `Dist` and `Work` rather than `Distance` and `Calories`.
- **Put a unit in the label, not as an overlay inside a narrow field.** `.fld .unit` is fine for `/10` and `kg`; a 3-character suffix like `min` alongside a 4-character value clips the value in a 68px column.
- Keep the JS organised in the existing sections: settings → theme → drawer → categories → program loading → session persistence → rendering → view mode → export → events.
- **Repaint, don't rebuild, on autosave.** `saveSession()` runs on every keystroke and calls `updateProgress()`. Anything reached from there must set attributes and text on nodes that already exist (`paintNav()` is the model). Rebuilding a strip or a card that often fights the scroll position and can steal focus mid-word. The set editor in Log view follows the same rule: an input's `oninput` writes into the row/draft and saves, never rebuilds its own container — that rebuild-on-keystroke was the cause of the old "RPE field escapes after one character" bug. A deliberate button tap may rebuild the editor, but set transitions remain passive and never focus a field; only an action explicitly targeting an input, such as **+ note**, may focus the new node.
- `paintNav()` scrolls the pip strip into view **only when `STATE.focus` changes**, and never while an input has focus — doing it on every autosave (which used to run on every keystroke, anywhere in the app) was the other half of the reported screen-jumping bug.
- Bump the `CACHE` constant in `sw.js` whenever shell files change, or returning users get a stale app.

## Verifying changes

There is no test suite. After edits, at minimum:

```bash
python3 -m http.server 8000        # then open http://localhost:8000

# JS syntax — index.html has TWO script blocks (the head theme script and the app),
# so check each one; a naive sed of the first <script> to the last </script> fails.
python3 - <<'EOF'
import re, subprocess
for i, b in enumerate(re.findall(r"<script[^>]*>(.*?)</script>", open("index.html").read(), re.S)):
    open(f"/tmp/blk{i}.js", "w").write(b)
    print(i, subprocess.run(["node", "--check", f"/tmp/blk{i}.js"]).returncode)
EOF

# every JSON in the repo parses
python3 -c "import json,glob;[json.load(open(f)) for f in ['program.json','manifest.webmanifest']+glob.glob('samples/*.json')]"

# generator scripts still import and reject bad input
python3 -m py_compile athlete/skills/program-builder/scripts/*.py

# every programme in the repo satisfies the tp-program-* contract
python3 athlete/skills/program-builder/scripts/validate_program.py \
  program.json samples/program.sample.json samples/program.v2.sample.json

# app logic: week filtering, per-set round-trip, export shape, v1 + v2
node samples/apptest.js

# the validator itself: fixtures pass, 23 known breakages are rejected
python3 samples/validatortest.py
```

Two test files, and they check opposite directions. `samples/apptest.js` proves the app reads
a **good** programme correctly — dependency-free, it stubs enough DOM to load the inline script
and drive it. `samples/validatortest.py` proves the builder refuses to emit a **bad** one.
Neither tests rendering, layout or offline behaviour. Extend `apptest.js` when you touch
filtering, logging or export; extend `validatortest.py` when you add a rule to
`validate_program.py` — a validator with no negative test is worse than none, because it buys
false confidence.

Then manually, **against both fixture versions** (`samples/program.sample.json` and
`samples/program.v2.sample.json`): import it, log some sets, reload the page (state must
survive — including the week and day, not just the log itself), toggle airplane mode (app
must still open), and export a session. Check the layout on a narrow screen — 320px is the
real floor. A v1 programme must keep working; that's the whole point of keeping both
fixtures.

Since the UI is Overview/Log plus a drawer, also: open the drawer and change week (the
stepper), day and date (the check-in must reload with the session, and the day list's
pressed state must follow); in Log, page through with Prev/Next and the pips, log a few sets
one at a time — type a full RPE like `7.5` and confirm focus never leaves the field and the
page never jumps — edit a past set from its chip, and Finish an exercise both with and
without every prescribed set logged; then switch back to Overview and confirm it shows the
right status with no inputs anywhere on it. Do it in at least one light theme — a rule that
hardcodes a colour looks fine in the palette you wrote it in.

Four more, all of them things that have actually been reported:

1. **The metric field.** `Spanish squat isometric` (`3 × 45 sec`) must read `Hold (s)` with
   placeholder `45`; the warm-up (`8-10 min`) `Time (min)`; `Backward sled drag` (`20 m`)
   `Dist (m)`; the MetCon (`4 rounds`, prose reps) four set slots and a free-text `Result`.
   No field may open a digits-only keypad unless the value can only be whole digits.
2. **Nothing destructive under an innocent tap.** Tapping an upcoming set number must do
   *nothing*. `⊖` must refuse to go below what is already logged.
3. **Type a set and Finish without logging it**, then export: `sets[]` must contain it.
   Repeat with Next, a day change, a week change and a switch to Overview.
4. **Check 320px as well as 390px, and check for horizontal overflow, not just for looks.**
   Chrome clamps its window width, so a `--window-size=320` screenshot is a *crop* of a wider
   layout and will hide the very thing you are looking for. Load the app in a 320-wide
   `<iframe>` and compare `documentElement.scrollWidth` against `clientWidth`.

Before committing anything under `athlete/`, also run `git status` and
`git check-ignore -v athlete/<slug>/personal-profile.md athlete/<slug>/logs/`.

## Deployment

Static hosting with HTTPS — required for install + service worker. No build step, output directory `/`.

**Current setup: GitHub Pages**, serving `/` from the **`dev`** branch of the **public** repo `Jacques-rs/workout-tracker-app`, live at <https://jacques-rs.github.io/workout-tracker-app/>. Pushing `dev` deploys. It is the `legacy` (Jekyll) builder, not a workflow. The repo is public because that is the free way to get HTTPS hosting from GitHub Pages — which is exactly why the `athlete/` rules above are non-negotiable.

**When a push doesn't show up on the phone, check in this order** — the first two are free and rule out the expensive third:

```bash
gh api repos/Jacques-rs/workout-tracker-app/pages --jq '.source.branch, .status'
curl -s https://jacques-rs.github.io/workout-tracker-app/sw.js | grep CACHE   # which build is LIVE
gh run list -R Jacques-rs/workout-tracker-app --limit 5                       # the real build record
gh run view <id> -R Jacques-rs/workout-tracker-app --log-failed               # why it failed
curl -s https://www.githubstatus.com/api/v2/summary.json | grep -o '"name":"Pages","status":"[a-z_]*"'
```

**Read the workflow run, not the `pages/builds` API.** Pages deploys via the
`pages-build-deployment` workflow, whose run has two jobs, and which one failed is the whole
answer:

| | |
|---|---|
| `build` failed | **Our content.** A Jekyll/Liquid error, a bad file. Read the log and fix the repo. |
| `build` passed, `deploy` failed | **Not our content** — the site was built fine and only publishing failed. Usually GitHub's side (on 2026-08-06 it was `Invalid actions OIDC token`, during an Actions+Pages major outage); otherwise a Pages config or permission problem. Check the status page before touching the repo, and **re-run the failed job** once it clears rather than inventing a commit. |

Do not trust `pages/builds/latest.duration` to tell you whether a build ran — during that
outage it reported `0` for a run that had spent four minutes building successfully.

**Only once the live `sw.js` shows the new `CACHE` value** is a stale phone the service
worker's fault, and the fix for that is a reload (the worker calls `skipWaiting()` +
`clients.claim()`, so one is usually enough; an installed iOS PWA sometimes wants the app
closed and reopened).

Alternatives if the repo ever needs to go private: **Cloudflare Pages** (private repos on the free tier, and the site can be gated behind Cloudflare Access) or **Netlify Drop** (drag the folder in, no repo; URL is unlisted but public).

## Roadmap

See `docs/roadmap.md` for ordinary feature candidates and `docs/backend-launch-plan.md` for the
approved backend sequence. Don't jump phases or add unlisted scope: reliability and speed in the
gym remain more important than functionality.
