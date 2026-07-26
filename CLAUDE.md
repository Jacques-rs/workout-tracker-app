# CLAUDE.md — Workout Tracker App

Context for working on this repo. Read this first.

## What this is

A single-purpose **installable PWA** that displays one athlete's training programme and logs each session **offline in the gym**, then exports the session as a JSON file for review by an AI coach in a separate Claude project.

It is a personal tool for one user (Jacques). There is no multi-user support, no accounts, no backend, and no plan to add any. Do not build for scale, tenancy, or public distribution.

One nuance: a second person (Jacques' partner) uses the app on **her own phone**, so which optional fields appear is a per-device preference in the Tracked-fields sheet (`tp_settings_v1`). That is *not* tenancy — there are still no profiles, no accounts, and nothing keyed by person. Keep it that way.

## The wider workflow this app sits in

This repo is **step 3** of a four-step loop. The other steps live in a separate Claude project ("training-prog-project") that this repo never talks to directly — the only integration is the JSON files.

1. **Plan** — a `program-planner` skill interviews the athlete and writes a Program Planning Doc, which the athlete approves.
2. **Build** — a `program-builder` skill turns the approved plan into three artefacts: a Markdown phase map, a colour-banded `.xlsx`, and **`program.json`** (schema `tp-program-1`).
3. **Track (this repo)** — the athlete imports `program.json`, trains, and logs the session offline. The app exports **`session-<date>-<day>.json`** (schema `tp-session-1`).
4. **Review** — the athlete drops that session file into the coaching project's `logs/` folder and asks Claude to review it; the coach compares logged loads/RPE/pain against the prescription and adjusts.

**Implication for design decisions:** the app's job is to make *capturing decision-relevant data* fast and reliable under gym conditions. Every field exists because a coach needs it downstream. See `docs/athlete-context.md` before removing or restyling any input.

## Architecture in one paragraph

`index.html` is the entire app — markup, CSS, and JS inline, no build step, no framework, no npm. `sw.js` caches the app shell for offline use. `manifest.webmanifest` plus three PNG icons make it installable. `program.json` at the repo root is a bundled **sample** so the app runs on first open; the athlete's real programme is loaded at runtime via the Import button and persisted in `localStorage`. Full detail in `docs/architecture.md`.

## Hard constraints — do not break these

- **No build step.** No bundler, transpiler, framework, or package manager. Someone must be able to edit `index.html` and reload.
- **No external runtime dependencies.** No CDN scripts or webfonts. The app must work with zero network. (Inline SVG/emoji-free glyphs or plain text only.)
- **Offline-first is the point.** It's used in a gym basement. Any feature that needs the network must degrade to a no-op, never block the UI.
- **Relative paths only** (`./sw.js`, `./program.json`). The app is hosted from a subpath (e.g. `https://user.github.io/workout-tracker-app/`) — absolute paths break it.
- **`localStorage` is the source of truth for in-progress logs.** Never clear it as a side effect. Autosave on every input; a dropped connection or closed tab must never lose a logged set.
- **Never commit real training data.** The bundled `program.json` stays a sample. Exported session logs and personal programmes belong in the athlete's private Drive folder, not this repo. (This matters because the repo may be public — see Deployment.)
- **Schema compatibility.** `tp-program-1` is produced by an external skill. If you change what the app expects, update `docs/data-contracts.md` and say so clearly in the response, because the generator must change in lockstep.

## Conventions

- Plain ES5/ES6-compatible vanilla JS. Small helpers (`$`, `el`) already exist at the top of the script — use them rather than adding a library.
- Dark UI, mobile-first, single 720px-max column. Touch targets ≥26px; inputs must be reachable one-handed with a chalked-up thumb.
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

Static hosting with HTTPS — required for install + service worker. Current approach: **Cloudflare Pages** connected to this repo (works with a private repo on the free tier; the live site can be gated behind Cloudflare Access). Alternatives: GitHub Pages (needs a *public* repo on the free plan) or drag-and-drop Netlify Drop. Build command: none. Output directory: `/`.

## Roadmap

See `docs/roadmap.md` for known gaps and candidate features, each with the reasoning. Don't add features not listed there without discussing the trade-off first — the athlete values reliability and speed in the gym over functionality.
