# Architecture

## Files

| File | Role |
|---|---|
| `index.html` | The entire app: markup + inline `<style>` + inline `<script>`. No build step. |
| `sw.js` | Service worker. Caches the app shell for offline use. |
| `manifest.webmanifest` | PWA manifest — name, colours, icons, `display: standalone`. |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | App icons (barbell glyph on dark background). |
| `program.json` | Bundled **sample** programme so the app works on first open. Replaced at runtime by Import. |

## JS layout inside `index.html`

The script is organised in labelled sections, in this order. Keep additions in the matching section.

1. **Helpers** — `$(sel)` querySelector shorthand, `el(tag, props, kids)` element factory, `toast()`, `slug()`, `todayISO()`.
2. **Settings** — `FIELD_DEFS` (the switchable fields), `loadSettings()`, `saveSettings()`, `painLbl()`, `renderSettings()`, `openSheet()`/`closeSheet()`.
2b. **Theme** — `PALETTES`, `MODES`, `themeId()`, `applyTheme()`, `renderAppearance()`. Two palettes (Amber / Mint) × light/dark = the four `html[data-theme]` blocks at the top of the `<style>`. `themeId()` resolves palette + mode (`auto`/`light`/`dark`) to one of them; `applyTheme()` sets `<html data-theme>` and syncs the `theme-color` meta. A `matchMedia` listener re-applies on device light/dark change, but only while mode is `auto`. A ~6-line script in `<head>` duplicates `themeId()` so the correct palette is painted before the body renders — if you change the resolution rule, change both.
3. **Categories** — `CATS`, `CAT_ALIASES`, `CAT_RULES`, `catOf(ex)`. Resolves an exercise's rail colour + tag; see `docs/data-contracts.md` for the fallback ladder.
4. **Program loading** — `loadProgram(obj)` validates and persists; `boot()` loads settings, then restores the programme from `localStorage`, else fetches `./program.json`.
5. **Session persistence** — `sessionKey()`, `getSession()`, `saveSession()`.
6. **Rendering** — `renderAll()` (header + selectors), `renderDayPicker()`, `renderMain()`, `sessionCard()`, `exerciseCard()`, `heroEl()`, `chipsEl()`, `summaryText()`, `collapse()`, `updateProgress()`.
7. **Export** — `buildSessionExport()`, `exportSession()`, `copyJSON()`.
8. **Events** — selector/button wiring, service-worker registration, `boot()` call.

## State model

```js
STATE = { week: 1, day: "Day 1 (Mon) - ...", date: "2026-07-27" }
```

`STATE` is just the current view selection. Everything durable lives in `localStorage`:

| Key | Contents |
|---|---|
| `tp_program_v1` | The imported programme (`tp-program-1`). One at a time. |
| `tp_sess_v1::<date>::<day>` | One session's logged data. |
| `tp_settings_v1` | Which optional fields are shown, plus `painLabel`, plus appearance (`palette`: `a`\|`b`, `mode`: `auto`\|`light`\|`dark`). Defaults are all-on / `a` / `auto`, so a fresh install behaves like the original app apart from following the phone's light-dark setting. Appearance is cosmetic and deliberately **not** part of the session export. |

A stored session looks like:

```js
{ block, athlete, week, day, date,
  session: { bodyweightKg, sleep, readiness, hrvNote, amPainNextDay, overall },
  entries: { "<exercise.id>": { done, load, reps, rpe, painDuring, notes } } }
```

Note `entries` is an **object keyed by exercise id** in storage, but is flattened to an **array** on export (see `buildSessionExport()`).

### Autosave

Every input has an `oninput`/`onchange` handler that mutates the session object and calls `saveSession()` immediately. There is no save button and no debounce. This is deliberate: a phone dying mid-session must not lose logged sets.

## Known quirks (intentional, but surprising)

- **Session key is `date` + `day`, not week.** Changing the week selector does not switch sessions; it overwrites `week` on the current one. Harmless in practice (a given date has one session), but don't rely on week for keying.
- **Changing the date switches sessions.** By design — it's how the athlete re-opens yesterday's session the next morning to fill in `amPainNextDay` before exporting.
- **Exercises are filtered by `day` only, not `week`.** Week 1 is the template; later weeks apply the prose `progression` rule. A banner appears when the selected week exceeds the highest authored week. See `docs/data-contracts.md`.
- **Old session keys are never cleaned up.** They accumulate in `localStorage`. Not a practical problem at this data volume; see roadmap.

## Service worker strategy

`CACHE = "tp-tracker-v3"` in `sw.js`.

- **`program.json` → network-first, cache fallback.** So a re-deployed sample/programme is picked up when online, but still opens offline.
- **Everything else → cache-first**, falling back to network, falling back to `./index.html` (so a deep link offline still boots the app).
- `install` pre-caches the shell list and calls `skipWaiting()`; `activate` deletes old caches and calls `clients.claim()`.

**When you change any shell file, bump `CACHE`** (e.g. `tp-tracker-v2`) or returning users keep the old cached app.

## Export flow

`exportSession()` builds the `tp-session-1` object, serialises it, and triggers a download via a `Blob` + object URL + synthetic `<a download>` click.

Why a download rather than writing to the athlete's Drive folder directly: the File System Access API isn't available on iOS Safari, and the app deliberately has no backend or cloud credentials. On iPhone the download goes through the share sheet → *Save to Files* → the Drive folder. `copyJSON()` is the fallback path — clipboard, then paste into chat.

## Styling

Inline `<style>` in the head. Dark palette via CSS custom properties on `:root` (`--bg`, `--panel`, `--ink`, `--accent`, `--good/--warn/--bad`), a 4px spacing scale (`--s1`..`--s5`) and a type scale (`--t-xs`..`--t-hero`). Mobile-first, single column, `max-width: 720px`, `env(safe-area-inset-*)` respected for notch/home-bar. A sticky header holds the progress bar, week/date and day tabs; a fixed footer bar holds the export actions.

Layout rules that are load-bearing on a phone, and easy to undo by accident:

- **`minmax(0, 1fr)`, never plain `1fr`,** in the log grids. An input's intrinsic width is wider than a phone column and `1fr` refuses to shrink below it.
- **Header buttons are `flex: 0 0 auto` + `nowrap`.** Otherwise they absorb the squeeze and render one character per line instead of letting the block name wrap.
- **Number spinners are hidden.** They're unusable with chalked hands and cost ~15px of field width — enough to clip a pain score of `10`.
- The four-across log grid is gated on `min-width: 360px` and falls back to 2×2 below that.

## Deliberate non-goals

No framework, no bundler, no npm, no TypeScript, no CDN assets, no analytics, no accounts, no server, no cloud sync, no multi-athlete support. Every one of these was considered and rejected for a single-user offline gym tool.

**The Tracked-fields sheet is not multi-user support.** It's a per-device preference: which optional inputs render. A second person uses the app by installing it on their own phone, which gives them their own `localStorage` and therefore their own settings and logs. There are no profiles, no switching, and nothing keyed by person.
