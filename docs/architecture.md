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

## Screen layout

Three surfaces, and which one a thing belongs on is the main design rule here:

- **Header** (sticky, two rows) — the ≡ button, a tappable context line (`Week 3 · Tue` over the day's theme), the view toggle, then the date + `n/m done` and either the progress bar (all-exercises view) or the pip strip (focus view). Nothing here is an input.
- **`<main>`** — exercise cards, and nothing else. In the all-exercises view, every card for the day; in the focus view, exactly one.
- **Drawer** — week, day, date, the session check-in, import/export, and settings. Everything that is decided once per session and then read rarely.

The footer bar swaps by view: export actions in the all-exercises view, `‹ Prev / n / N / Next ›` in the focus view. Export and Copy JSON are *also* always in the drawer, so the swap never strands them.

## JS layout inside `index.html`

The script is organised in labelled sections, in this order. Keep additions in the matching section.

1. **Helpers** — `$(sel)` querySelector shorthand, `el(tag, props, kids)` element factory, `toast()`, `slug()`, `todayISO()`.
2. **Settings** — `FIELD_DEFS` (the switchable fields), `loadSettings()`, `saveSettings()`, `painLbl()`, `renderFields(host)`.
2b. **Theme** — `PALETTES`, `MODES`, `themeId()`, `applyTheme()`, `renderAppearance(host)`. Two palettes (Amber / Mint) × light/dark = the four `html[data-theme]` blocks at the top of the `<style>`. `themeId()` resolves palette + mode (`auto`/`light`/`dark`) to one of them; `applyTheme()` sets `<html data-theme>` and syncs the `theme-color` meta. A `matchMedia` listener re-applies on device light/dark change, but only while mode is `auto`. A ~6-line script in `<head>` duplicates `themeId()` so the correct palette is painted before the body renders — if you change the resolution rule, change both.
2c. **Drawer** — `renderDrawer()` builds the whole panel: the week/date/day controls (and wires them, because they only exist once it has rendered), the check-in accordion, the data buttons, and the two settings accordions. `renderCheckin()` rebuilds *only* the check-in — day and date changes switch which session is open, and a full rebuild would throw away the scroll position and open/closed state of the sections below it. `accordion(key, title, build, statId)` remembers open/closed in the in-memory `ACC`. `checkinSummary()`/`checkinFilled()` drive the closed-state summary and the dot on the ≡. `openDrawer()`/`closeDrawer()`/`toggleDrawer()`/`drawerOpen()`.
3. **Categories** — `CATS`, `CAT_ALIASES`, `CAT_RULES`, `catOf(ex)`. Resolves an exercise's rail colour + tag; see `docs/data-contracts.md` for the fallback ladder.
4. **Program loading** — `isV2()` and `dayExercises()` (the schema fork; see quirks), `athleteId()`, `loadProgram(obj)` validates and persists; `boot()` loads settings, then restores the programme from `localStorage`, else fetches `./program.json`.
5. **Session persistence** — `sessionKey()`, `getSession()`, `saveSession()`.
6. **Rendering** — `renderAll()` = `renderHeader()` + `renderDrawer()` + `renderMain()`. Also `dayParts()`, `dayTheme()`, `fmtDate()`, `sessionCard()` (the check-in, rendered into the drawer), `exerciseCard(ex, s, idx)`, `heroEl()`, `chipsEl()`, `summaryText()`, `collapse()`, `updateProgress()`. Per-set logging lives here too: `entrySets()`, `renumber()`, `prescribedSets()`, `newSet()`, `setsEl()`.
6b. **View mode** — `viewMode()`, `setView()`, `syncView()` (toggle state, which footer group and which header strip is visible), `firstUndone()`, `resetFocus()`, `clampFocus()`, `goFocus(i)`, `stepFocus(d)`, `renderNav()` (rebuilds the pips) and `paintNav()` (repaints their state, the counter and the prev/next disabled flags on every save, without touching structure).
7. **Export** — `exportSets()`, `buildSessionExport()`, `exportSession()`, `copyJSON()`.
8. **Events** — wiring for the markup that exists for the whole life of the page, a guarded `keydown` listener (Escape closes the drawer, arrows page the focus view), service-worker registration, `boot()` call. The week/date/day controls are wired in `renderDrawer()` instead, because they are built there.

## State model

```js
STATE = { week: 1, day: "Day 1 (Mon) - ...", date: "2026-07-27", focus: 0 }
```

`STATE` is just the current view selection. `focus` is the index of the exercise shown in the focus view and is deliberately **not** persisted: on a cold start, and whenever the week, day or date changes, it is re-derived by `firstUndone()`, which lands on the first exercise not yet ticked off. Everything durable lives in `localStorage`:

| Key | Contents |
|---|---|
| `tp_program_v1` | The imported programme. One at a time. Holds **either** `tp-program-1` or `tp-program-2` — the storage key is not versioned, `meta.schema` inside it is. |
| `tp_sess_v1::<date>::<day>` | One session's logged data. |
| `tp_settings_v1` | Which optional fields are shown, plus `painLabel`, plus appearance (`palette`: `a`\|`b`, `mode`: `auto`\|`light`\|`dark`) and `view` (`list`\|`focus`). Defaults are all-on / `a` / `auto` / `list`, so a fresh install behaves like the original app apart from following the phone's light-dark setting. Appearance and view are cosmetic and deliberately **not** part of the session export — `tracking` is built from `FIELD_DEFS` alone, so nothing added here can leak into a log file. |

A stored session looks like:

```js
{ block, athlete, week, day, date,
  session: { bodyweightKg, sleep, readiness, hrvNote, amPainOnWaking, overall },
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
- **Changing the date switches sessions.** By design — it's how a session gets corrected or completed after the fact. It used to be load-bearing: `amPainNextDay` could *only* be filled by re-opening yesterday's session the next morning, which is exactly why it kept arriving empty and why `tp-session-3` replaced it with the pre-session `amPainOnWaking`. The date picker stays, but nothing in the normal flow depends on it now.
- **Exercises are filtered by `day` and `week` — but only for `tp-program-2`.** A v1 programme is a Week-1 template, so filtering it by week would empty the list; it keeps the day-only filter and the "apply your progression rule" banner. `isV2()` is the only place that decides, and `dayExercises()` is the only filter — rendering, the progress bar and the export all call it. See `docs/data-contracts.md`.
- **Per-set logging is opt-in per exercise.** The flat load / sets×reps / RPE row is the fast path and stays the summary; tapping "Log each set" materialises the prescribed number of rows. Each row carries an `auto` flag while the app owns it, so typing into set 1 flows down into every row the athlete has not touched — that is what keeps "all sets the same" at one tap per field rather than one per set. Typing into a row clears its flag and it stops following, so propagation can never overwrite entered data. `auto` is local only; `exportSets()` picks its keys explicitly, so it never reaches a log file. The flat fields are exported as logged and never recomputed from `sets`.
- **The check-in is not in the training view.** It renders into the drawer, and the drawer's closed summary line (plus a dot on the ≡ while nothing is filled) is how the athlete knows whether it is done. It is still the *same* `sessionCard()`, still autosaves on every input, and still tints itself by readiness — only its host moved. Anything that reads the check-in should call `renderCheckin()`, never `renderMain()`.
- **Marking done in the focus view advances to the next exercise.** Only forward, only on the card being looked at, and never on un-marking, so a mis-tap costs one tap of Prev. In the all-exercises view it does nothing of the sort. This is the only automatic navigation in the app.
- **`renderNav()` and `paintNav()` are split on purpose.** `saveSession()` runs on every keystroke; rebuilding a pip per exercise that often would fight the scroll position of the strip. `renderNav()` rebuilds structure when the exercise list changes, `paintNav()` only repaints attributes.
- **Old session keys are never cleaned up.** They accumulate in `localStorage`. Not a practical problem at this data volume; see roadmap.

## Service worker strategy

`CACHE` in `sw.js`. Check the file for the current value rather than trusting this line.

- **`program.json` → network-first, cache fallback.** So a re-deployed sample/programme is picked up when online, but still opens offline.
- **Everything else → cache-first**, falling back to network, falling back to `./index.html` (so a deep link offline still boots the app).
- `install` pre-caches the shell list and calls `skipWaiting()`; `activate` deletes old caches and calls `clients.claim()`.

**When you change any shell file, bump `CACHE`** — increment whatever is there now — or returning users keep the old cached app.

## Export flow

`exportSession()` builds the `tp-session-3` object, serialises it, and triggers a download via a `Blob` + object URL + synthetic `<a download>` click. Both it and `copyJSON()` are wrapped in `try/catch` that toasts the error: a throw here would look like the button doing nothing, at the one moment the session has to leave the phone.

Why a download rather than writing to the athlete's Drive folder directly: the File System Access API isn't available on iOS Safari, and the app deliberately has no backend or cloud credentials. On iPhone the download goes through the share sheet → *Save to Files* → the Drive folder. `copyJSON()` is the fallback path — clipboard, then paste into chat.

## Styling

Inline `<style>` in the head. Dark palette via CSS custom properties on `:root` (`--bg`, `--panel`, `--ink`, `--accent`, `--good/--warn/--bad`), a 4px spacing scale (`--s1`..`--s5`) and a type scale (`--t-xs`..`--t-hero`). Mobile-first, single column, `max-width: 720px`, `env(safe-area-inset-*)` respected for notch/home-bar.

Layout rules that are load-bearing on a phone, and easy to undo by accident:

- **`minmax(0, 1fr)`, never plain `1fr`,** in the log grids. An input's intrinsic width is wider than a phone column and `1fr` refuses to shrink below it.
- **Header buttons are `flex: 0 0 auto` + `nowrap`, except `.ctx`.** Otherwise they absorb the squeeze and render one character per line. The context line is the one thing allowed to shrink, and it ellipses rather than wraps. The rule is written `header .row>button:not(.ctx)` so `.ctx`'s own `flex: 1 1 auto` isn't outgunned.
- **The hero is capped at `max-width: 45%`, and `.hero small` wraps.** The RPE line is prose as often as a number ("RPE 7 (use RPE-1 to set load)") and inherits the hero's `nowrap`; without both rules a long one takes the whole row and wraps the exercise name to one word per line.
- **`.sets` spans the log grid (`grid-column: 1 / -1`).** It is a child of `.log`, so without it the per-set block lands in one ~90px column.
- **Number spinners are hidden.** They're unusable with chalked hands and cost ~15px of field width — enough to clip a pain score of `10`.
- The four-across log grid is gated on `min-width: 360px` and falls back to 2×2 below that.
- **The drawer opens and closes with `visibility`, not `[hidden]`** — a delayed `visibility` transition keeps the panel present until it has slid out, with no JS timers. The reduced-motion block has to zero that *delay* as well as the durations, or an invisible scrim keeps eating taps for 240ms.

## Deliberate non-goals

No framework, no bundler, no npm, no TypeScript, no CDN assets, no analytics, no accounts, no server, no cloud sync, **no in-app athlete switching**. Every one of these was considered and rejected for an offline gym tool.

**Multi-athlete lives on the coaching side, not here.** `athlete/<slug>/` gives each person their own profile, plans, programmes and logs, and the planner/builder skills take the athlete as an input. The app does not model people at all: a second athlete installs the PWA on her own phone, which gives her her own `localStorage` and therefore her own programme, settings and logs.

**The Tracked fields section is not multi-user support.** It's a per-device preference: which optional inputs render, and what the pain field is called. That is how one athlete's tendon protocol and another's shoulder rehab both reach the UI without the app knowing who anyone is. There are no profiles, no switching, and nothing keyed by person.

`meta.athleteId` is the one place a person's name appears in the data path. The app reads it from the imported programme and writes it back out in the session export, so a log file identifies the `athlete/<slug>/logs/` folder it belongs in. It is never used to select, filter, or key anything.
