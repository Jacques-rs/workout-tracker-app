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
2. **Program loading** — `loadProgram(obj)` validates and persists; `boot()` restores from `localStorage`, else fetches `./program.json`.
3. **Session persistence** — `sessionKey()`, `getSession()`, `saveSession()`.
4. **Rendering** — `renderAll()` (header + selectors), `renderMain()`, `sessionCard()`, `exerciseCard()`, `rxLine()`, `collapse()`, `updateProgress()`.
5. **Export** — `buildSessionExport()`, `exportSession()`, `copyJSON()`.
6. **Events** — selector/button wiring, service-worker registration, `boot()` call.

## State model

```js
STATE = { week: 1, day: "Day 1 (Mon) - ...", date: "2026-07-27" }
```

`STATE` is just the current view selection. Everything durable lives in `localStorage`:

| Key | Contents |
|---|---|
| `tp_program_v1` | The imported programme (`tp-program-1`). One at a time. |
| `tp_sess_v1::<date>::<day>` | One session's logged data. |

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

`CACHE = "tp-tracker-v1"` in `sw.js`.

- **`program.json` → network-first, cache fallback.** So a re-deployed sample/programme is picked up when online, but still opens offline.
- **Everything else → cache-first**, falling back to network, falling back to `./index.html` (so a deep link offline still boots the app).
- `install` pre-caches the shell list and calls `skipWaiting()`; `activate` deletes old caches and calls `clients.claim()`.

**When you change any shell file, bump `CACHE`** (e.g. `tp-tracker-v2`) or returning users keep the old cached app.

## Export flow

`exportSession()` builds the `tp-session-1` object, serialises it, and triggers a download via a `Blob` + object URL + synthetic `<a download>` click.

Why a download rather than writing to the athlete's Drive folder directly: the File System Access API isn't available on iOS Safari, and the app deliberately has no backend or cloud credentials. On iPhone the download goes through the share sheet → *Save to Files* → the Drive folder. `copyJSON()` is the fallback path — clipboard, then paste into chat.

## Styling

Inline `<style>` in the head. Dark palette via CSS custom properties on `:root` (`--bg`, `--panel`, `--ink`, `--accent`, `--good/--warn/--bad`). Mobile-first, single column, `max-width: 720px`, `env(safe-area-inset-*)` respected for notch/home-bar. A fixed footer bar holds progress + export actions.

## Deliberate non-goals

No framework, no bundler, no npm, no TypeScript, no CDN assets, no analytics, no accounts, no server, no cloud sync, no multi-athlete support. Every one of these was considered and rejected for a single-user offline gym tool.
