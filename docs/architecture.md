# Architecture

## Files

| File | Role |
|---|---|
| `index.html` | The entire app: markup + inline `<style>` + inline `<script>`. No build step. |
| `sw.js` | Service worker. Caches the app shell for offline use. |
| `manifest.webmanifest` | PWA manifest — name, colours, icons, `display: standalone`. |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | App icons (barbell glyph on dark background). |
| `program.json` | Bundled **sample** programme (`tp-program-2`, 6 weeks × 4 days) so the app works on first open. Replaced at runtime by Import. |
| `samples/apptest.js` | `node samples/apptest.js` — dependency-free smoke test of filtering, per-set logging and export against both schema versions. |

## JS layout inside `index.html`

The script is organised in labelled sections, in this order. Keep additions in the matching section.

1. **Helpers** — `$(sel)` querySelector shorthand, `el(tag, props, kids)` element factory, `toast()`, `slug()`, `todayISO()`.
2. **Settings** — `FIELD_DEFS` (the switchable fields), `loadSettings()`, `saveSettings()`, `painLbl()`, `renderSettings()`, `openSheet()`/`closeSheet()`.
2b. **Theme** — `PALETTES`, `MODES`, `themeId()`, `applyTheme()`, `renderAppearance()`. Two palettes (Amber / Mint) × light/dark = the four `html[data-theme]` blocks at the top of the `<style>`. `themeId()` resolves palette + mode (`auto`/`light`/`dark`) to one of them; `applyTheme()` sets `<html data-theme>` and syncs the `theme-color` meta. A `matchMedia` listener re-applies on device light/dark change, but only while mode is `auto`. A ~6-line script in `<head>` duplicates `themeId()` so the correct palette is painted before the body renders — if you change the resolution rule, change both.
3. **Categories** — `CATS`, `CAT_ALIASES`, `CAT_RULES`, `catOf(ex)`. Resolves an exercise's rail colour + tag; see `docs/data-contracts.md` for the fallback ladder.
4. **Program loading** — `isV2()` and `dayExercises()` (the schema fork; see quirks), `athleteId()`, `loadProgram(obj)` validates and persists; `boot()` loads settings, then restores the programme from `localStorage`, else fetches `./program.json`.
5. **Session persistence** — `sessionKey()`, `getSession()`, `saveSession()`.
6. **Rendering** — `renderAll()` (header + selectors), `renderDayPicker()`, `renderMain()`, `sessionCard()`, `exerciseCard()`, `heroEl()`, `chipsEl()`, `summaryText()`, `collapse()`, `updateProgress()`. Per-set logging lives here too: `entrySets()`, `renumber()`, `prescribedSets()`, `newSet()`, `setsEl()`.
7. **Export** — `exportSets()`, `buildSessionExport()`, `exportSession()`, `copyJSON()`.
8. **Events** — selector/button wiring, service-worker registration, `boot()` call.

## State model

```js
STATE = { week: 1, day: "Day 1 (Mon) - ...", date: "2026-07-27" }
```

`STATE` is just the current view selection. Everything durable lives in `localStorage`:

| Key | Contents |
|---|---|
| `tp_program_v1` | The imported programme. One at a time. Holds **either** `tp-program-1` or `tp-program-2` — the storage key is not versioned, `meta.schema` inside it is. |
| `tp_sess_v1::<date>::<day>` | One session's logged data. |
| `tp_settings_v1` | Which optional fields are shown, plus `painLabel`, plus appearance (`palette`: `a`\|`b`, `mode`: `auto`\|`light`\|`dark`). Defaults are all-on / `a` / `auto`, so a fresh install behaves like the original app apart from following the phone's light-dark setting. Appearance is cosmetic and deliberately **not** part of the session export. |

A stored session looks like:

```js
{ block, athlete, week, day, date,
  session: { bodyweightKg, sleep, readiness, hrvNote, amPainNextDay, overall },
  entries: { "<exercise.id>": { done, load, reps, rpe, painDuring, notes,
                                sets: [ { set, load, reps, rpe, painDuring, note } ] } } }
```

Note `entries` is an **object keyed by exercise id** in storage, but is flattened to an **array** on export (see `buildSessionExport()`).

`sets` is absent from sessions saved before v2, so every read goes through `entrySets()`, which creates it lazily. `renumber()` renormalises `set` numbers **in the array before saving** — renumbering during render instead leaves stale numbers in storage after a removal, which is a bug that only shows up in an exported file.

Under v2 the same stored session can hold entries from more than one week (the key is date + day, not week), because the athlete can flip the week selector on the same date. That is harmless: exercise ids are week-scoped, and the export only emits the currently selected week's exercises.

### Autosave

Every input has an `oninput`/`onchange` handler that mutates the session object and calls `saveSession()` immediately. There is no save button and no debounce. This is deliberate: a phone dying mid-session must not lose logged sets.

## Known quirks (intentional, but surprising)

- **Session key is `date` + `day`, not week.** Changing the week selector does not switch sessions; it overwrites `week` on the current one. Harmless in practice (a given date has one session), but don't rely on week for keying.
- **Changing the date switches sessions.** By design — it's how the athlete re-opens yesterday's session the next morning to fill in `amPainNextDay` before exporting.
- **Exercises are filtered by `day` and `week` — but only for `tp-program-2`.** A v1 programme is a Week-1 template, so filtering it by week would empty the list; it keeps the day-only filter and the "apply your progression rule" banner. `isV2()` is the only place that decides, and `dayExercises()` is the only filter — rendering, the progress bar and the export all call it. See `docs/data-contracts.md`.
- **Per-set logging is opt-in per exercise.** The flat load / sets×reps / RPE row is the fast path and stays the summary; tapping "Log each set" materialises the prescribed number of rows. Each row carries an `auto` flag while the app owns it, so typing into set 1 flows down into every row the athlete has not touched — that is what keeps "all sets the same" at one tap per field rather than one per set. Typing into a row clears its flag and it stops following, so propagation can never overwrite entered data. `auto` is local only; `exportSets()` picks its keys explicitly, so it never reaches a log file. The flat fields are exported as logged and never recomputed from `sets`.
- **Old session keys are never cleaned up.** They accumulate in `localStorage`. Not a practical problem at this data volume; see roadmap.

## Service worker strategy

`CACHE` in `sw.js`. Check the file for the current value rather than trusting this line.

- **`program.json` → network-first, cache fallback.** So a re-deployed sample/programme is picked up when online, but still opens offline.
- **Everything else → cache-first**, falling back to network, falling back to `./index.html` (so a deep link offline still boots the app).
- `install` pre-caches the shell list and calls `skipWaiting()`; `activate` deletes old caches and calls `clients.claim()`.

**When you change any shell file, bump `CACHE`** — increment whatever is there now — or returning users keep the old cached app.

## Export flow

`exportSession()` builds the `tp-session-2` object, serialises it, and triggers a download via a `Blob` + object URL + synthetic `<a download>` click. Both it and `copyJSON()` are wrapped in `try/catch` that toasts the error: a throw here would look like the button doing nothing, at the one moment the session has to leave the phone.

Why a download rather than writing to the athlete's Drive folder directly: the File System Access API isn't available on iOS Safari, and the app deliberately has no backend or cloud credentials. On iPhone the download goes through the share sheet → *Save to Files* → the Drive folder. `copyJSON()` is the fallback path — clipboard, then paste into chat.

## Styling

Inline `<style>` in the head. Dark palette via CSS custom properties on `:root` (`--bg`, `--panel`, `--ink`, `--accent`, `--good/--warn/--bad`), a 4px spacing scale (`--s1`..`--s5`) and a type scale (`--t-xs`..`--t-hero`). Mobile-first, single column, `max-width: 720px`, `env(safe-area-inset-*)` respected for notch/home-bar. A sticky header holds the progress bar, week/date and day tabs; a fixed footer bar holds the export actions.

Layout rules that are load-bearing on a phone, and easy to undo by accident:

- **`minmax(0, 1fr)`, never plain `1fr`,** in the log grids. An input's intrinsic width is wider than a phone column and `1fr` refuses to shrink below it.
- **Header buttons are `flex: 0 0 auto` + `nowrap`.** Otherwise they absorb the squeeze and render one character per line instead of letting the block name wrap.
- **Number spinners are hidden.** They're unusable with chalked hands and cost ~15px of field width — enough to clip a pain score of `10`.
- The four-across log grid is gated on `min-width: 360px` and falls back to 2×2 below that.

## Deliberate non-goals

No framework, no bundler, no npm, no TypeScript, no CDN assets, no analytics, no accounts, no server, no cloud sync, **no in-app athlete switching**. Every one of these was considered and rejected for an offline gym tool.

**Multi-athlete lives on the coaching side, not here.** `athlete/<slug>/` gives each person their own profile, plans, programmes and logs, and the planner/builder skills take the athlete as an input. The app does not model people at all: a second athlete installs the PWA on her own phone, which gives her her own `localStorage` and therefore her own programme, settings and logs.

**The Tracked-fields sheet is not multi-user support.** It's a per-device preference: which optional inputs render, and what the pain field is called. That is how one athlete's tendon protocol and another's shoulder rehab both reach the UI without the app knowing who anyone is. There are no profiles, no switching, and nothing keyed by person.

`meta.athleteId` is the one place a person's name appears in the data path. The app reads it from the imported programme and writes it back out in the session export, so a log file identifies the `athlete/<slug>/logs/` folder it belongs in. It is never used to select, filter, or key anything.
