# CLAUDE.md — Workout Tracker App

Context for working on this repo. Read this first.

## What this is

A single-purpose **installable PWA** that displays one athlete's training programme and logs each session **offline in the gym**, then exports the session as a JSON file for review by an AI coach in a separate Claude project.

It is a personal tool. There are no accounts, no backend, and no plan to add any. Do not build for scale or public distribution.

### More than one athlete — where the line is

Two people use this: Jacques and his partner. They are handled at **two different layers**, and conflating them is the mistake to avoid.

- **Coaching side (`athlete/`) is genuinely multi-athlete.** One folder per person — `athlete/<slug>/` holding `personal-profile.md`, `plans/`, `programs/`, `logs/`. The `program-planner` and `program-builder` skills take the athlete as an input and read only that person's profile. Injury protocols, pain-monitoring rules and readiness hard stops are per-athlete data, never hardcoded in a skill. See `athlete/README.md`.
- **The app is per-device, not multi-profile.** A second athlete installs the PWA on her own phone, which gives her her own `localStorage`, settings, programme and logs. One programme is stored at a time (`tp_program_v1`). Which optional fields appear, and what the pain field is called, is a per-device preference in the Tracked-fields sheet (`tp_settings_v1`) — that is how athlete-specific needs reach the UI.

So: **no profile switching, no account, nothing keyed by person inside the app.** If you find yourself adding a person dimension to a `localStorage` key, stop — that is tenancy, and it was rejected. The one exception is `athleteId`, which the app *carries through* from `program.json` into the session export purely so a log file says which `athlete/<slug>/logs/` folder it belongs in. It is a label, not a selector.

## The wider workflow this app sits in

This repo is **step 3** of a four-step loop. Steps 1, 2 and 4 are done by a Claude coaching project whose data now lives **inside this repo, under `athlete/`** (see Repo layout). The app and the coaching project still never talk to each other — the only integration is JSON files on disk.

1. **Plan** — a `program-planner` skill reads `athlete/<slug>/personal-profile.md`, interviews the athlete, and writes a Program Planning Doc into `athlete/<slug>/plans/`, which the athlete approves.
2. **Build** — a `program-builder` skill turns the approved plan into three artefacts in `athlete/<slug>/programs/`: a Markdown phase map, a colour-banded `.xlsx` with one tab per week, and **`program.json`** (schema `tp-program-2`). **Every week of the block is authored explicitly** — see below.
3. **Track (this repo)** — the athlete imports `program.json`, trains, and logs the session offline. The app exports **`session-<date>-<day>.json`** (schema `tp-session-3`).
4. **Review** — the athlete saves that file into `athlete/<slug>/logs/` and the `review-workout-log` skill compares logged loads/RPE/pain against the prescription for that week and day, proposes the smallest effective adjustment behind an approval gate, and on approval revises the week: `rows.json` is edited, both builder scripts re-run, the superseded `program.json` is archived to `revisions/`, `meta.version` bumps and `CHANGELOG.md` records **why**. The athlete then re-imports — a manual step the app does not prompt for.

**Implication for design decisions:** the app's job is to make *capturing decision-relevant data* fast and reliable under gym conditions. Every field exists because a coach needs it downstream. Read the relevant `athlete/<slug>/personal-profile.md` (local-only, gitignored) before removing or restyling any input — the pain, readiness and RPE fields exist for a specific tendon-monitoring protocol.

### Schemas — programme v2, session v3

The two sides version independently. Current: **`tp-program-2` in, `tp-session-3` out.**

- `tp-program-2` materialises every week as real rows, instead of Week 1 plus a prose progression rule. This fixed the live bug where the app showed Week 1 prescriptions no matter which week was selected. It also carries an optional `meta.version` — the revision number, bumped when a week is revised mid-block.
- `tp-session-2` added a per-set `sets[]` array alongside the flat summary fields, which stay authoritative for the summary and are never recomputed from `sets`.
- `tp-session-3` moved next-morning pain to a **pre-session** reading: `amPainOnWaking` (with `tracking.painOnWaking`) replaces `amPainNextDay`, and is captured at check-in. **It describes the response to the *previous* session, not this one** — that attribution flip is the thing to get right in any reader. It also adds `programVersion`, the revision the athlete actually trained off.

**Every reader must accept every version indefinitely.** A v1 programme can be sitting in `localStorage` on a phone mid-block, and v1/v2 log files are already on disk. In the app the whole programme-version difference is decided by `isV2()`, and every consumer asks `dayExercises()` — v2 filters by day **and** week, v1 by day only and keeps the "apply your progression rule" banner. Do not scatter `meta.schema` checks beyond those two functions. The session schema has no such branch: the app only ever *writes* the newest version, and reading old logs is the coaching side's job.

`samples/` carries fixtures for every version, and `samples/apptest.js` exercises both programme versions. Full detail in `docs/data-contracts.md`.

## Architecture in one paragraph

`index.html` is the entire app — markup, CSS, and JS inline, no build step, no framework, no npm. `sw.js` caches the app shell for offline use. `manifest.webmanifest` plus three PNG icons make it installable. `program.json` at the repo root is a bundled **sample** so the app runs on first open; the athlete's real programme is loaded at runtime via the Import button and persisted in `localStorage`. Full detail in `docs/architecture.md`.

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

The PWA must stay at the **repo root** — GitHub Pages serves `/` from `main`, and moving it breaks the deployed URL and every installed home-screen icon.

`Fitness/training-prog-project/` remains the backup for everything gitignored under `athlete/` — gitignored files can be lost by a branch switch or `git clean`. The skills themselves are now canonical in `athlete/skills/`; see `athlete/README.md`.

### Two worktrees

- `Fitness/workout-tracker-app/` — branch `main`. This is what GitHub Pages serves. Don't develop here.
- `Fitness/workout-tracker-app-dev/` — branch `dev`. Do the work here; merge `dev` → `main` to deploy.

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
- **Themed via CSS variables — never hardcode a colour.** Two palettes (Amber / Mint) × light/dark are declared as four `html[data-theme]` blocks at the top of the `<style>`; the Appearance section of the settings sheet picks palette + mode (Auto follows the device). Every colour in a rule below those blocks must be a `var(--…)`, or it will survive a theme switch and look broken in one of the four. The only exceptions are two neutral greys (a `color-mix` fallback and a swatch hairline). Category rail colours live in `--cat-*`, so `CATS` in the JS holds `var()` references, not hex.
- `type="number"` for numeric fields so phones show the number pad.
- Keep the JS organised in the existing sections: program loading → session persistence → rendering → export → events.
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

# app logic: week filtering, per-set round-trip, export shape, v1 + v2
node samples/apptest.js
```

`samples/apptest.js` is the closest thing to a test suite here — dependency-free, it stubs
enough DOM to load the inline script and drive it. It does **not** test rendering, layout or
offline behaviour. Extend it when you touch filtering, logging or export.

Then manually, **against both fixture versions** (`samples/program.sample.json` and
`samples/program.v2.sample.json`): import it, tick items, reload the page (state must
survive), toggle airplane mode (app must still open), and export a session. Check the layout
on a narrow screen — the per-set row is five columns wide and 320px is the real floor. A v1
programme must keep working; that's the whole point of keeping both fixtures.

Before committing anything under `athlete/`, also run `git status` and
`git check-ignore -v athlete/<slug>/personal-profile.md athlete/<slug>/logs/`.

## Deployment

Static hosting with HTTPS — required for install + service worker. No build step, output directory `/`.

**Current setup: GitHub Pages**, serving `/` from the `main` branch of the **public** repo `Jacques-rs/workout-tracker-app`, live at <https://jacques-rs.github.io/workout-tracker-app/>. Pushing to `main` deploys. The repo is public because that is the free way to get HTTPS hosting from GitHub Pages — which is exactly why the `athlete/` rules above are non-negotiable.

Alternatives if the repo ever needs to go private: **Cloudflare Pages** (private repos on the free tier, and the site can be gated behind Cloudflare Access) or **Netlify Drop** (drag the folder in, no repo; URL is unlisted but public).

## Roadmap

See `docs/roadmap.md` for known gaps and candidate features, each with the reasoning. Don't add features not listed there without discussing the trade-off first — the athlete values reliability and speed in the gym over functionality.
