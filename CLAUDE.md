# CLAUDE.md — Workout Tracker App

Context for working on this repo. Read this first.

## What this is

A single-purpose **installable PWA** that displays one athlete's training programme and logs each session **offline in the gym**, then exports the session as a JSON file for review by an AI coach in a separate Claude project.

It is a personal tool for one user (Jacques). There is no multi-user support, no accounts, no backend, and no plan to add any. Do not build for scale, tenancy, or public distribution.

One nuance: a second person (Jacques' partner) uses the app on **her own phone**, so which optional fields appear is a per-device preference in the Tracked-fields sheet (`tp_settings_v1`). That is *not* tenancy — there are still no profiles, no accounts, and nothing keyed by person. Keep it that way.

## The wider workflow this app sits in

This repo is **step 3** of a four-step loop. Steps 1, 2 and 4 are done by a Claude coaching project whose data now lives **inside this repo, under `athlete/`** (see Repo layout). The app and the coaching project still never talk to each other — the only integration is JSON files on disk.

1. **Plan** — a `program-planner` skill interviews the athlete and writes a Program Planning Doc, which the athlete approves.
2. **Build** — a `program-builder` skill turns the approved plan into three artefacts: a Markdown phase map, a colour-banded `.xlsx`, and **`program.json`** (schema `tp-program-1`).
3. **Track (this repo)** — the athlete imports `program.json`, trains, and logs the session offline. The app exports **`session-<date>-<day>.json`** (schema `tp-session-1`).
4. **Review** — the athlete saves that file into `athlete/logs/` and asks Claude to review it; the coach compares logged loads/RPE/pain against the prescription and adjusts.

**Implication for design decisions:** the app's job is to make *capturing decision-relevant data* fast and reliable under gym conditions. Every field exists because a coach needs it downstream. Read `athlete/personal-profile.md` (local-only, gitignored) before removing or restyling any input — the pain, readiness and RPE fields exist for a specific tendon-monitoring protocol.

## Architecture in one paragraph

`index.html` is the entire app — markup, CSS, and JS inline, no build step, no framework, no npm. `sw.js` caches the app shell for offline use. `manifest.webmanifest` plus three PNG icons make it installable. `program.json` at the repo root is a bundled **sample** so the app runs on first open; the athlete's real programme is loaded at runtime via the Import button and persisted in `localStorage`. Full detail in `docs/architecture.md`.

## Repo layout

```
index.html  sw.js  manifest.webmanifest  icon-*.png   the PWA — deploy root, committed
program.json                                          bundled SAMPLE programme, committed
samples/                                              fixtures for development
docs/                                                 committed docs (see README table)
athlete/                                              coaching project data — NOT for committing
  personal-profile.md    athlete health + strength context   (gitignored)
  logs/*.json            exported session logs               (gitignored)
  sources/               coaching research notes             (currently committed)
```

The PWA must stay at the **repo root** — GitHub Pages serves `/` from `main`, and moving it breaks the deployed URL and every installed home-screen icon.

The `program-planner` and `program-builder` skills have **not** moved into this repo yet; they still live in `Fitness/training-prog-project/skills/`. That folder also remains the backup for everything under `athlete/` — gitignored files can be lost by a branch switch or `git clean`.

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
- **Never commit real training data. The GitHub repo is public.** `athlete/personal-profile.md` contains medical detail and `athlete/logs/` contains the training record; both are gitignored and must stay that way. The bundled `program.json` stays a sample. Before any commit that touches `athlete/`, run `git status` and `git check-ignore -v <path>` — a mis-scoped rule puts health data in public git history permanently, where deleting the file later does not remove it.
- **Schema compatibility.** `tp-program-1` is produced by an external skill. If you change what the app expects, update `docs/data-contracts.md` and say so clearly in the response, because the generator must change in lockstep.

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
node --check <(sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d')   # JS syntax
python3 -c "import json;[json.load(open(f)) for f in ['program.json','manifest.webmanifest']]"
```

Then manually: import a sample programme, tick items, reload the page (state must survive), toggle airplane mode (app must still open), and export a session (file must parse and match `tp-session-1`).

## Deployment

Static hosting with HTTPS — required for install + service worker. No build step, output directory `/`.

**Current setup: GitHub Pages**, serving `/` from the `main` branch of the **public** repo `Jacques-rs/workout-tracker-app`, live at <https://jacques-rs.github.io/workout-tracker-app/>. Pushing to `main` deploys. The repo is public because that is the free way to get HTTPS hosting from GitHub Pages — which is exactly why the `athlete/` rules above are non-negotiable.

Alternatives if the repo ever needs to go private: **Cloudflare Pages** (private repos on the free tier, and the site can be gated behind Cloudflare Access) or **Netlify Drop** (drag the folder in, no repo; URL is unlisted but public).

## Roadmap

See `docs/roadmap.md` for known gaps and candidate features, each with the reasoning. Don't add features not listed there without discussing the trade-off first — the athlete values reliability and speed in the gym over functionality.
