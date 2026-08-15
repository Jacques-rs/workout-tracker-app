# Architecture

## Files

| File | Role |
|---|---|
| `index.html` | The app shell, workout markup, inline styles and device-first workout logic. No build step. |
| `js/auth-config.js`, `js/auth-client.js`, `js/auth-ui.js` | Environment selection, Supabase session boundary and authentication dialogs. Kept outside the workout script. |
| `js/program-store.js` | Private programme-library boundary. Owns `programs` reads/writes, local-first import retry, activation identity and revision-checked soft deletion. |
| `js/profile-ui.js` | Account-first profile and programme-library states/actions. It receives callbacks and makes no backend call. |
| `vendor/supabase-js-2.111.0.min.js` | Pinned browser SDK; origin and checksum are recorded in `vendor/README.md`. |
| `sw.js` | Service worker. Caches the app shell for offline use. |
| `manifest.webmanifest` | PWA manifest — name, colours, icons, `display: standalone`. |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | App icons (barbell glyph on dark background). |
| `program.json` | Bundled **sample** programme (`tp-program-2`, 6 weeks × 4 days), opened only through **View sample programme**. |
| `samples/apptest.js` | Dependency-free smoke test of account entry, local namespaces, workout logging and export. |
| `samples/authtest.js`, `samples/profiletest.js`, `samples/programstoretest.js`, `samples/swtest.js` | Dependency-free tests for auth ownership, profile/library states, programme storage and the service-worker boundary. |
| `supabase/` | Repo-managed backend config, migrations, fake seed data, pgTAP access-policy tests and a local Auth/Mailpit integration test. |
| `scripts/verify.sh` | One local command for the database security suite and all existing contract/app checks. |

## Screen layout

Four surfaces, and which one a thing belongs on is the main design rule here:

- **Profile home** — the cold-start surface. Signed-out visitors get sign-in/recovery and the explicit sample action. An authenticated owner sees the private cloud programme library and the active device cache; an offline-known owner keeps the active cached workout and may queue one imported replacement for reconnect. History still says plainly that session sync is not connected. Explicit sign-out hides personal cache metadata without deleting it.
- **Header** (sticky, two rows) — the ≡ button and a tappable context line (`Week 3 · Tue 5 Aug` over the day's theme — the date lives on this line, not its own row) on row 1; a worded Overview/Log toggle and `n/m done` on row 2, with either the progress bar (Overview) or the pip strip (Log) beneath. Nothing here is an input. The progress bar has **two fill layers** (`#pbarDone`, and the dimmer `#pbarPart` behind it) so a session with four exercises half-logged doesn't read as 0% through, and the pips carry **three** states, not two (`data-done`, `data-part`).
- **`<main>`** — exercise cards, and nothing else. In Overview, every card for the day, read-only; in Log, exactly one, with a set editor.
  - **Log card order is load-bearing**: name → prescription → the `Capture` chips → **the set editor** → coach notes / progression rule / Summary & notes. The reference material sits *below* the editor because three collapsibles above the fields pushed the primary action off a 320×568 screen.
  - **Overview always renders a status line**, one of six states (see `statusLine()`), plus a right-aligned `○ / ◐ / ✓` badge. An absent line used to mean "untouched", which was indistinguishable from "the status didn't render" — and it left a typed-but-uncommitted set invisible everywhere outside the editor.
- **Drawer** — Profile home, week (a `‹ Week N ›` stepper), day, date, the session check-in, import/export, and settings. Everything that is decided once per session and then read rarely.

The footer bar swaps by view: export actions in Overview, `‹ Prev / n / N / Next ›` in Log. Export and Copy JSON are *also* always in the drawer, so the swap never strands them.

## Browser JavaScript layout

The vendored Supabase SDK loads first, followed by the auth and profile modules. `auth-config.js`
selects the local stack only for localhost/loopback and the hosted project elsewhere.
`auth-client.js` owns Supabase Auth calls and exposes state/actions to the rest of the app.
`auth-ui.js` renders sign-in, recovery and password-setup dialogs. `program-store.js` owns every
Data API call to `programs`; `profile-ui.js` renders account/library states from `TPAuth`,
`TPPrograms` and local callbacks, and never calls Supabase itself. Nothing in the client queries
`session_logs` yet. The workout script makes no direct backend call: it asks whether personal
cache/import access is allowed and hands programme operations to the store boundary.

The inline workout script is organised in labelled sections, in this order. Keep additions in the matching section.

1. **Helpers / app shell** — `$(sel)` querySelector shorthand, `el(tag, props, kids)` element factory, `toast()`, `slug()`, `todayISO()`, profile/workout surface switching, cached-programme entry and explicit sample entry.
2. **Settings** — `FIELD_DEFS` (the switchable fields), `loadSettings()`, `saveSettings()`, `painLbl()`, `renderFields(host)`.
2b. **Theme** — `PALETTES`, `MODES`, `themeId()`, `applyTheme()`, `renderAppearance(host)`. Two palettes (Amber / Mint) × light/dark = the four `html[data-theme]` blocks at the top of the `<style>`. `themeId()` resolves palette + mode (`auto`/`light`/`dark`) to one of them; `applyTheme()` sets `<html data-theme>` and syncs the `theme-color` meta. A `matchMedia` listener re-applies on device light/dark change, but only while mode is `auto`. A ~6-line script in `<head>` duplicates `themeId()` so the correct palette is painted before the body renders — if you change the resolution rule, change both.
2c. **Drawer** — `renderDrawer()` builds the whole panel: the week/date/day controls (and wires them, because they only exist once it has rendered), the check-in accordion, the data buttons, and the two settings accordions. `renderCheckin()` rebuilds *only* the check-in — day and date changes switch which session is open, and a full rebuild would throw away the scroll position and open/closed state of the sections below it. `accordion(key, title, build, statId)` remembers open/closed in the in-memory `ACC`. `checkinSummary()`/`checkinFilled()` drive the closed-state summary and the dot on the ≡. `openDrawer()`/`closeDrawer()`/`toggleDrawer()`/`drawerOpen()`.
3. **Categories** — `CATS`, `CAT_ALIASES`, `CAT_RULES`, `catOf(ex)`. Resolves an exercise's rail colour + tag; see `docs/data-contracts.md` for the fallback ladder.
4. **Program loading** — `isV2()` and `dayExercises()` (the schema fork; see quirks), `athleteId()`, `loadProgram(obj)` validates and persists a personal import. `boot()` loads settings and the profile; it does not silently enter a programme. `openCachedWorkout()` restores `tp_program_v1`, while `openSampleWorkout()` fetches the pre-cached sample without replacing it. Also the four **read-only readers of the prescription**, which turn what the generator wrote into what the UI asks for: `prescribedSets(ex)`/`targetSets(ex, e)` (how many set slots), `metricOf(ex)` (what the reps field measures — see below), `parseHints(ex)` (the `Capture` chips), and `painAsked(ex)`/`programPainSite()` (which exercises want a pain reading, and which body part this block monitors). All pure, all derived from the opened programme.
5. **Session persistence** — `sessionKey()`, `getSession()` (also runs `normalizeEntry()` over every entry — see "Migrating a stored entry" below), `saveSession()`; the set model itself: `blankEntry()`, `blankDraft()`/`seedDraft()`/`draftEmpty()`/`draftDirty()`, `entryState()`, `renumber()`, `deriveSummary()`/`deriveReps()`/`withUnit()`/`pickMode()`/`pickMax()`/`applyDerivedSummary()`, `normalizeEntry()`, `commitSet()`, `deleteSet()`, and the three that make a typed set unloseable: `commitDraftIfDirty()`, `flushDraft()`.
6. **Rendering** — `renderAll()` = `renderHeader()` + `renderDrawer()` + `renderMain()`. Also `dayParts()`, `dayTheme()`, `fmtDate()`/`fmtDateShort()`, `sessionCard()` (the check-in, rendered into the drawer), `field(label, node, unit, labelClass)`, `updateProgress()`, and the card builders: `exerciseHead(ex)` (shared), `hintChips()`, `overviewCard(ex, s, idx)`, `logCard(ex, s, idx)`, `buildSetEditor()` (recap + chips + count control + fields + actions), `buildSummaryPanel()` (the collapsed, editable flat fields), `summaryText()`, `statusLine()`, `setRecap()`, `painLogged()`, `collapse()`.
6b. **View mode** — `viewMode()`, `setView()`, `syncView()` (toggle state, footer/header visibility, and capture/restore of the runtime-only Overview scroll position), `firstUndone()`, `resetFocus()`, `clampFocus()`, `goFocus(i)`, `stepFocus(d)`, `renderNav()` (rebuilds the pips) and `paintNav()` (repaints their state, the counter and the prev/next disabled flags on every save, without touching structure — and scrolls the pip strip only when `STATE.focus` actually changed).
7. **Export** — `exportSets()`, `exportEntry()` (a named whitelist, not a rest-spread — see "State model" below), `buildSessionExport()`, `exportSession()`, `copyJSON()`.
8. **Events** — wiring for the markup that exists for the whole life of the page, a guarded `keydown` listener (Escape closes the drawer, arrows page the focus view), service-worker registration, `boot()` call. The week/date/day controls are wired in `renderDrawer()` instead, because they are built there.

## State model

```js
STATE = { week: 1, day: "Day 1 (Mon) - ...", date: "2026-07-27", focus: 0, setEdit: null }
APP = { surface: "profile" | "workout", source: null | "personal" | "sample" }
```

`APP` is runtime-only. A reload always starts on the profile, and the source selects the personal or demo local namespace while a workout is open. `STATE` is just the current workout selection. `focus` is the index of the exercise shown in Log view and is deliberately **not** persisted: on a cold start, and whenever the week, day or date changes, it is re-derived by `firstUndone()`, which lands on the first exercise not yet ticked off. `setEdit` is the index of a committed set being re-edited from its chip, or `null` while the athlete is typing the next new one (the "draft"); it lives in memory only and is cleared by every navigation function (`goFocus`, `resetFocus`, and therefore `selectDay`/`selectDate`/`selectWeek`/`loadProgram`, which all call it) — an edit target that survived a navigation would silently write into the wrong exercise's set. Everything durable lives in `localStorage`:

`OVERVIEW_SCROLL` is also memory-only. Leaving Overview captures the window offset, returning from Log restores it, and changing the programme, week, day or date resets it to zero. It deliberately does not survive a reload, where restoring a stale pixel offset into changed content would be misleading.

| Key | Contents |
|---|---|
| `tp_program_v1` | The imported programme. One at a time. Holds **either** `tp-program-1` or `tp-program-2` — the storage key is not versioned, `meta.schema` inside it is. |
| `tp_active_program_v1` | Stable cloud UUID, last known row revision and a `pending` retry marker for the active personal programme. It never contains the programme payload; that remains in `tp_program_v1`. |
| `tp_pos_v1` | The selected week/day for the personal cached programme. |
| `tp_sess_v1::<date>::<day>` | One session's logged data. |
| `tp_demo_pos_v1` | Sample-only week/day position. Never used for personal training. |
| `tp_demo_sess_v1::<date>::<day>` | Sample-only session data. Same local shape and export contract, separate namespace. |
| `tp_settings_v1` | Which optional fields are shown, plus `painLabel`, plus appearance (`palette`: `a`\|`b`, `mode`: `auto`\|`light`\|`dark`), `view` (`list`\|`focus`, meaning Overview\|Log) and `sv`, a one-shot settings-migration marker (see below). Defaults are all-on / `a` / `auto` / `focus`. Appearance and view are cosmetic and deliberately **not** part of the session export — `tracking` is built from `FIELD_DEFS` alone, so nothing added here can leak into a log file. |
| `tp_supabase_auth_v1` | Supabase's persisted browser session. Owned only by the SDK; never read by workout persistence or exported. |
| `tp_auth_owner_v1` | Minimal installation binding: first accepted user id/email, explicit local sign-out and an unfinished invite/recovery marker. It contains no token or workout payload. |

## Programme library

`TPPrograms` is the sole remote-storage boundary for the first cloud-data phase. On authenticated
profile entry it selects the owner's non-deleted `programs` rows through RLS. The profile receives
display summaries only; payloads remain private inside the store until the athlete activates one.
Activation writes the selected payload through the existing `loadProgram()` path, so
`tp_program_v1` remains the one offline workout source and existing position/session behavior does
not branch on cloud state. If the active cloud row has a newer revision than the cached marker, the
profile labels the update and waits for an explicit **Update device** action; a reconnect must not
replace the prescription underneath an open workout.

Import is local-first. The parsed contract payload is written to `tp_program_v1` immediately, a
browser-generated UUID and `pending: true` are written to `tp_active_program_v1`, and the insert is
then attempted asynchronously. An offline import therefore remains trainable; the same UUID is
retried on the next authenticated refresh, making an uncertain retry idempotent. A cached programme
from before the library phase is never uploaded silently — the profile offers an explicit **Back up
to library** action. Inactive cloud payloads are fetched while online but are not promised as a full
offline library; only the active programme is durable across reloads.

Remove is a soft delete (`deleted_at`) guarded by the row's last-seen `revision`. A zero-row update
means another device changed it, so the library refreshes and asks the athlete to review rather than
overwriting. Removing the active programme clears `tp_program_v1`, `tp_pos_v1` and its active marker,
but deliberately retains local session keys. No programme action writes `session_logs`.

A stored session looks like:

```js
{ block, athlete, week, day, date,
  session: { bodyweightKg, sleep, readiness, hrvNote, amPainOnWaking, overall },
  entries: { "<exercise.id>": { done, load, reps, rpe, painDuring, notes, summaryAuto, setTarget,
                                sets: [ { set, load, reps, rpe, painDuring, note } ],
                                draft: { load, reps, rpe, painDuring, note, dirty },
                                circuit: { mode, rounds, extra, time, result, minutes,
                                           load, note, touched } | null } } }
```

`draft.dirty` is the difference between "these fields are showing you the last set" and "you have typed this set", and it is what makes `flushDraft()` safe: only a dirty, non-empty draft is auto-committed, so nothing is dropped and nothing is invented. It is set by any `oninput` in the set editor while in draft mode, cleared by `seedDraft()`/`blankDraft()`, and — like the rest of `draft` — never exported.

`sets` holds only **committed** rows — an ordinary set or a completed circuit round. `draft` is the set/round currently being typed and is never exported. `circuit` holds only UI state for the adaptive circuit logger; the exporter deliberately omits it. `exportEntry()` is a named whitelist of exactly the six flat keys the contract defines, not a rest-spread over the entry, so `draft`, `circuit`, `setTarget` and `summaryAuto` cannot leak into a log file as the local shape grows. `summaryAuto` says whether ordinary flat values still follow `sets`; final-result circuits write their flat headline directly.

Note `entries` is an **object keyed by exercise id** in storage, but is flattened to an **array** on export (see `buildSessionExport()`).

`renumber()` renormalises `set` numbers **in the array before saving** — renumbering during render instead leaves stale numbers in storage after a removal, which is a bug that only shows up in an exported file.

Under v2 the same stored session can hold entries from more than one week (the key is date + day, not week), because the athlete can flip the week selector on the same date. That is harmless: exercise ids are week-scoped, and the export only emits the currently selected week's exercises.

### Migrating a stored entry

`getSession()` runs `normalizeEntry()` over every entry on every read, and persists the result if anything changed, so every consumer — rendering, export, the progress bar — sees the current shape regardless of which build wrote the file to disk:

1. Any row still carrying an `auto` key predates this build (the old "Log each set" table used it to mark a row it had seeded but the athlete never actually typed into) — drop those rows and rebuild the survivors without the key, then renumber. Without this, a 7-set exercise where only set 1 was ever typed into would export as 7 sets performed.
2. A pre-existing **flat-only** entry (per-set logging used to be opt-in, so most older logs are flat-only) is promoted into one committed set, so derivation below doesn't silently blank out data the athlete already logged. Not for a box ticked with nothing logged at all — a warm-up needs no invented set.
3. Ensure `draft`, `summaryAuto`, and any existing `circuit` object have the current local shape.
4. If anything changed, re-derive the flat summary from `sets`.

Idempotent by construction: run it twice and the second pass changes nothing, which matters because it runs on every read, including every autosave.

### Settings migration

An install from before Log became the default view has a stored `view: "list"` and no `sv` key. `loadSettings()` checks for `sv` once on boot; if absent, it forces `view` to `"focus"` and stamps `sv: 1`, then saves. Without this, an existing install would open straight onto the read-only Overview and look like logging had vanished.

### Autosave

Every input has an `oninput`/`onchange` handler that mutates the session object and calls `saveSession()` immediately. There is no save button and no debounce. This is deliberate: a phone dying mid-session must not lose logged sets.

## Known quirks (intentional, but surprising)

- **A session key is source + `date` + `day`, not week.** Personal and sample sources have separate prefixes. Within either namespace, changing the week selector does not switch sessions; it overwrites `week` on the current one. Harmless in practice (a given date has one session), but don't rely on week for keying.
- **Changing the date switches sessions.** By design — it's how a session gets corrected or completed after the fact. It used to be load-bearing: `amPainNextDay` could *only* be filled by re-opening yesterday's session the next morning, which is exactly why it kept arriving empty and why `tp-session-3` replaced it with the pre-session `amPainOnWaking`. The date picker stays, but nothing in the normal flow depends on it now.
- **Exercises are filtered by `day` and `week` — but only for `tp-program-2`.** A v1 programme is a Week-1 template, so filtering it by week would empty the list; it keeps the day-only filter and the "apply your progression rule" banner. `isV2()` is the only place that decides, and `dayExercises()` is the only filter — rendering, the progress bar and the export all call it. See `docs/data-contracts.md`.
- **Ordinary work is one set at a time; circuits are format-aware.** Fixed `N rounds` defaults to a one-tap round counter. AMRAP, EMOM, for-time work and ladders default to a tailored final-result form. A quiet mode sheet switches among Quick rounds, Round details and Final result; changing after data exists requires an explicit reset. `tracking.perSetLogging` remains stamped `true` for compatibility, even though a final-result circuit can validly export `sets: []` with populated flat fields.
- **A new draft always seeds from the set before it**, load/reps/rpe/pain carried forward and the note cleared — the point being that logging N identical sets costs one tap each, and correcting one downward costs one more. The only way to get a genuinely blank draft is for the athlete to clear every field by hand; `commitSet()` refuses to commit one either way, so that can never produce a phantom set.
- **A typed set cannot be lost, and this is not the same thing as auto-logging.** `commitDraftIfDirty()` runs before an ordinary early end, and `flushDraft()` does the same when paging away, changing context/view, exporting or backgrounding. In Round details mode it commits the dirty draft as a circuit round instead. Quick-round taps and final-result fields already save directly. **Every caller that flushes must also re-render** because the flush writes through a session object read fresh from storage.
- **The reps field is whatever the exercise measures**, decided by `metricOf(ex)` from the prescription string: `Hold (s)`, `Time (min)`, `Dist (m)`, `Work (cal)`, `Reps`, or `Result` for composite prose. It sets the label, the keyboard (`inputmode`), the placeholder and the unit appended by `deriveReps()`. The old fixed `inputmode="numeric"` was a digits-only keypad on iOS, which made a 45-second hold untypeable — so the fallback for anything unrecognised is a **full keyboard**, never a numeric one. Composite prose is tested first, or `"45 sec hard / 75 sec easy"` reads as a 45-second hold. The unit lives in the *label*, not as an overlay inside the field: `"min"` plus `"8-10"` does not fit a 68px column and clipped the value.
- **Upcoming set chips are inert `<span>`s, and planned-count changes are secondary.** Tapping an upcoming number used to delete planned sets. The quiet **Adjust sets** action opens a bottom sheet whose −/+ controls write `setTarget`, floored at the current set and capped at 12. The primary set path has no steppers. A one-slot exercise renders no chip strip at all.
- **The programme's `logHint` drives two pieces of UI.** `parseHints()` splits it on semicolons into the `Capture` chip row (four at most), and `painAsked()` accents the pain field's label on any exercise whose hint, coach notes or category say a reading matters, nudging once on Finish if none was logged. It **never hides the field** — `tracking.painPerExercise` means "this device collects per-exercise pain", and an exercise-by-exercise exception would make an empty value unreadable on the coaching side.
- **The flat summary follows `sets` until it doesn't.** `applyDerivedSummary()` recomputes it on every commit/edit/delete while `summaryAuto` is true; editing a flat field directly in "Summary & notes" sets `summaryAuto` to `false` for that entry and it stops following, permanently, for that exercise. Never partially — there's one flag for the whole group, not one per field.
- **Deriving the summary must fail safe on empty or partial data**: no fabricated `"0"` RPE from nothing logged, no `"NaN"` from RPE prose that doesn't parse (fall back to the last raw string), no reps string that asserts more sets than were actually committed. See `deriveReps()`/`pickMode()`/`pickMax()` for the exact rules, and `samples/apptest.js`'s "deriving the flat summary" block for the table they're tested against.
- **The check-in is not in the training view.** It renders into the drawer, and the drawer's closed summary line (plus a dot on the ≡ while nothing is filled) is how the athlete knows whether it is done. It is still the *same* `sessionCard()`, still autosaves on every input, and still tints itself by readiness — only its host moved. Anything that reads the check-in should call `renderCheckin()`, never `renderMain()`. `closeDrawer()` also calls `renderMain()` — Overview/Log cards built before the drawer was opened hold an older session object, and without this fix, the next keystroke in one would autosave that stale copy over whatever was just typed in the check-in.
- **Committing a set says so, three ways.** A `LOGGED 60×4 · 60×4` recap line above the chips, a toast naming the set, and a one-off pulse on the chip that just landed (plus `navigator.vibrate` where it exists, guarded). Before this, a commit changed almost nothing on screen — the next draft is seeded from the set just logged, so the fields read the same — which is why it never felt like anything had been recorded. Committing an *empty* draft now toasts why nothing happened instead of being a silent no-op.
- **The final planned set completes and advances automatically.** Before any work the secondary exit is **Skip exercise**; after partial work it is **End after N of M**. Both require a confirmation that states what will be retained. A toast after automatic completion offers **Add set** as the recovery path. Circuit quick mode opens one compact finish sheet after its final prescribed round.
- **`renderNav()` and `paintNav()` are split on purpose.** `saveSession()` runs on every keystroke; rebuilding a pip per exercise that often would fight the scroll position of the strip. `renderNav()` rebuilds structure when the exercise list changes, `paintNav()` only repaints attributes — and scrolls the strip into view only when `STATE.focus` actually changed, and never while an input has focus, which is the fix for the reported screen-jump-while-typing bug.
- **Old session keys are never cleaned up.** They accumulate in `localStorage`. Not a practical problem at this data volume; see roadmap.

## Service worker strategy

`CACHE` in `sw.js`. Check the file for the current value rather than trusting this line.

- **`program.json` → network-first, cache fallback.** So a re-deployed sample/programme is picked up when online, but still opens offline.
- **Same-origin app assets → cache-first**, falling back to network, falling back to `./index.html` (so a deep link offline still boots the app). The pinned Supabase SDK, auth/profile modules and bundled sample are in the pre-cached shell.
- **Cross-origin requests are never intercepted.** Supabase Auth and future Data API calls must reach the backend directly; a failed request must never be replaced with cached HTML.
- `install` pre-caches the shell list and calls `skipWaiting()`; `activate` deletes old caches and calls `clients.claim()`.

**When you change any shell file, bump `CACHE`** — increment whatever is there now — or returning users keep the old cached app.

## Export flow

`exportSession()` builds the `tp-session-3` object, serialises it, and triggers a download via a `Blob` + object URL + synthetic `<a download>` click. Both it and `copyJSON()` are wrapped in `try/catch` that toasts the error: a throw here would look like the button doing nothing, at the one moment the session has to leave the phone.

Why a download rather than writing to the athlete's Drive folder directly: the File System Access API isn't available on iOS Safari, and session synchronization is not connected yet. On iPhone the download goes through the share sheet → *Save to Files* → the Drive folder. `copyJSON()` is the fallback path — clipboard, then paste into chat. The staged replacement is tracked in `docs/backend-launch-plan.md`.

## Styling

Inline `<style>` in the head. Dark palette via CSS custom properties on `:root` (`--bg`, `--panel`, `--ink`, `--accent`, `--good/--warn/--bad`), a 4px spacing scale (`--s1`..`--s5`) and a type scale (`--t-xs`..`--t-hero`). Mobile-first, single column, `max-width: 720px`, `env(safe-area-inset-*)` respected for notch/home-bar.

Layout rules that are load-bearing on a phone, and easy to undo by accident:

- **`minmax(0, 1fr)`, never plain `1fr`,** in the log/set grids. An input's intrinsic width is wider than a phone column and `1fr` refuses to shrink below it.
- **Header row 1 buttons are `flex: 0 0 auto` + `nowrap`, except `.ctx`.** Otherwise they absorb the squeeze and render one character per line. The context line is the one thing allowed to shrink, and it ellipses rather than wraps.
- **The prescription is one or two plain lines under the name (`.rx` / `.rx.meta`), not a separate hero number or a row of pill chips.** Both `exerciseHead()` bodies build the same two lines: sets×reps + load + RPE, then tempo/rest if either is present. Because it's a normal wrapping line rather than a `nowrap` hero, prose RPE ("RPE 7 (use RPE-1 to set load)") no longer needs a special case to avoid wrapping the exercise name to one word per line.
- **The set editor (`.setgrid`) is four columns — Load / metric / RPE / Pain — collapsing to two below 360px, with `.nopain` dropping to three.** RPE is a button that opens the reusable bottom sheet, not a text input. Circuit result fields use a separate two-column `.circuitresult` grid.
- **`.setgrid input` needs `width: 100%`.** Below 360px the grid drops to two columns *wider* than an input's intrinsic width, so without it the input sits narrow inside its cell and the `/10` suffix — positioned against the cell, not the input — floats outside the box it belongs to.
- **`.lbl` is `nowrap` + ellipsis.** A field label that wraps to two lines pushes its own input below the others in the same grid row, which reads as a broken layout rather than as a long word. This is also why `metricOf()` keeps its labels short (`Dist`, `Work`) — the metric column is about 68px at 360px.
- **One height scale (`--h-field` / `--h-tap` / `--h-primary`) on `:root`.** The primary action being *shorter* than the fields above it was most of why the old set editor looked unfinished.
- **`.setactions` is two non-wrapping rows, and both carry the `.setactions` class** — one full-width primary, then quiet Adjust/Skip/End actions beneath. Keeping the class on both rows also lets `apptest.js`'s `actionBtn()` helper find every button one level deep.
- **`.sheet-wrap` is the one reusable bottom sheet** for RPE, set-count changes, mode selection and confirmations. It traps focus, closes on Escape/scrim, respects the home-bar safe area and never opens a keyboard for a finite choice.
- **Number spinners are hidden.** They're unusable with chalked hands and cost ~15px of field width — enough to clip a pain score of `10`.
- The four-across log/set grids are gated on `min-width: 360px` and fall back to 2×2 below that.
- **The drawer opens and closes with `visibility`, not `[hidden]`** — a delayed `visibility` transition keeps the panel present until it has slid out, with no JS timers. The reduced-motion block has to zero that *delay* as well as the durations, or an invisible scrim keeps eating taps for 240ms.

## Current client boundary

No framework, bundler, npm runtime, TypeScript, runtime CDN dependency, analytics or multi-athlete
profile switching. Supabase Auth and the private `programs` library are the only remote client
integrations. Programme payloads are cloud-backed, while the selected one remains in the existing
device cache. Session reads/writes remain local and the history card states plainly that cloud
history is not connected yet. Offline autosave remains the source of truth for in-progress training
and never waits for the backend.

**One installation belongs to one beta account.** The first accepted or signed-in account writes a
small owner marker. A later attempt by a different account is signed out locally and rejected without
deleting the cached programme or sessions; that athlete needs a separate browser profile or app
installation. A known owner who did not explicitly sign out can continue using cached workouts and
importing a programme while offline. An explicit sign-out removes only the local Supabase session,
returns to the profile and hides personal cache access until sign-in; it deletes no workout data.

The bundled sample is deliberate demo mode, not a fallback identity. It never replaces
`tp_program_v1`, carries a persistent sample banner, and uses `tp_demo_*` position/session keys so a
guest can explore without reading or overwriting an owner's cached training.

Multi-athlete programme authoring still lives on the coaching side. `athlete/<slug>/` gives each
person their own profile, plans, programmes and logs, and the planner/builder skills take the athlete
as an input. Authentication does not add in-app profile switching.

**The Tracked fields section is not multi-user support.** It remains a per-device preference: which optional inputs render, and what the pain field is called. Account identity stays in the dedicated auth module and owner marker, outside this UI preference model; in-app profile switching remains deferred.

`meta.athleteId` is the one place a person's name appears in the data path. The app reads it from the imported programme and writes it back out in the session export, so a log file identifies the `athlete/<slug>/logs/` folder it belongs in. It is never used to select, filter, or key anything.
