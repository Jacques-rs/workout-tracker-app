# `athlete/` — coaching project data

This folder holds everything the **coaching side** of the loop needs: the skills that plan
and build programmes, the research they draw on, and one folder per athlete containing that
person's private data.

Nothing in here is served by the PWA. The app and the coaching project never talk to each
other — the only integration is JSON files on disk.

## Layout

```
athlete/
  README.md                  this file                                    committed
  skills/                    program-planner, program-builder             committed
  sources/                   coaching research notes                      committed
  <athlete>/                 ONE FOLDER PER ATHLETE                       gitignored
    personal-profile.md        health, injuries, strength baselines
    plans/                     Program Planning Docs (planner output)
    programs/                  Architecture map, .xlsx, rows.json, program.json
    logs/                      session-<date>-<day>.json exported by the app
```

`skills/` and `sources/` are **shared** — the coaching framework is the same for everyone.
What differs per athlete is the profile, the plan, the programme and the logs.

Folder names are lowercase slugs (`jacques`, not `Jacques`). The display name lives in
`personal-profile.md` and in `meta.athlete` inside `program.json`.

## Adding an athlete

```bash
mkdir -p athlete/<slug>/{plans,programs,logs}
```

Then write `athlete/<slug>/personal-profile.md` and run `program-planner`. There is nothing
to register and no file to edit — the ignore rules already cover the new folder (see below).

## Privacy — read before committing anything here

**The GitHub repo is public.** `personal-profile.md` contains medical detail and `logs/`
contains the training record.

The rule is **deny-by-default**, in `athlete/.gitignore` and again in the repo-root
`.gitignore`: everything under `athlete/` is ignored, and only `.gitignore`, `README.md`,
`skills/` and `sources/` are named back in. Two consequences worth knowing:

- A new athlete's folder is safe the moment it is created. Nothing to register, nothing to edit.
- So is anything unanticipated — a scratch note, an `archive/` folder, or a session export the
  phone share sheet dropped at `athlete/` instead of `athlete/<slug>/logs/`.

The pattern is `athlete/*` with **no trailing slash**, so it matches stray files and not just
directories. Do not add the slash, and do not invert this into a list of things to exclude:
then anything you didn't think of is published by default, permanently, in a public repo.

Before any commit that touches this folder:

```bash
git status
git check-ignore -v athlete/<slug>/personal-profile.md athlete/<slug>/logs/
```

Both must report a match. If either says nothing, stop.

## Injury and athlete-specific needs

Athlete-specific loading rules (tendon pain monitoring, movements to avoid, readiness hard
stops) live in that athlete's `personal-profile.md` and are carried into the Program Planning
Doc by `program-planner`. The skills themselves stay general — they read the profile they are
pointed at rather than hardcoding any one person's constraints.

On the app side the equivalent knob is the **Tracked-fields sheet** (`tp_settings_v1`), which
chooses which optional inputs render and what the pain field is called. That is a per-device
preference, not a profile: a second athlete uses the app by installing it on her own phone,
which gives her her own storage, settings and logs. See `docs/architecture.md`.
