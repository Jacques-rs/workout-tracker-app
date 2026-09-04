# Architecture

## Files

| File | Role |
|---|---|
| `index.html` | The app shell, workout markup, inline styles and device-first workout logic. No build step. |
| `js/auth-config.js`, `js/auth-client.js`, `js/auth-ui.js` | Environment selection, Supabase session boundary and authentication dialogs. Kept outside the workout script. |
| `js/program-store.js` | Private programme-library boundary. Owns `programs` reads/writes, local-first import retry, activation identity and revision-checked soft deletion. |
| `js/session-store.js` | Device-first session queue and the sole `session_logs` Data API boundary. Owns retry, revision checks, conflict copies, backfill and history paging. |
| `js/settings-store.js` | Device-first account-scoped settings boundary — the sole `user_settings` Data API caller. Owns the per-field last-write-wins merge and the offline retry. |
| `js/account-data.js` | Sole account portability/deletion boundary. Combines the owner-scoped RPC snapshot with safe current-device state; it never exports credentials or demo data. |
| `js/profile-ui.js` | The Account and Programme sections, plus the entry-gate states. It receives stores/callbacks and makes no backend call. |
| `vendor/supabase-js-2.111.0.min.js` | Pinned browser SDK; origin and checksum are recorded in `vendor/README.md`. |
| `sw.js` | Service worker. Caches the app shell and signed-out privacy notice for offline use. |
| `manifest.webmanifest` | PWA manifest — name, colours, icons, `display: standalone`. |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | App icons (barbell glyph on dark background). |
| `program.json` | Bundled **sample** programme (`tp-program-2`, 6 weeks × 4 days), opened only through **View sample programme**. |
| `samples/apptest.js` | Dependency-free smoke test of account entry, local namespaces, workout logging and export. |
| `samples/authtest.js`, `samples/profiletest.js`, `samples/programstoretest.js`, `samples/sessionstoretest.js`, `samples/settingsstoretest.js`, `samples/swtest.js` | Dependency-free tests for auth ownership, the Account/Programme sections, the cloud stores, the account-settings merge and the service-worker boundary. |
| `supabase/` | Repo-managed backend config, migrations, fake seed data, pgTAP access-policy tests and a local Auth/Mailpit integration test. |
| `scripts/verify.sh` | One local command for the database security suite and all existing contract/app checks. |

## Screen layout

**The heart is a home page, and tracking is date-first.** Those two ideas decide everything below;
`docs/date-first-revamp.md` is the durable record of the design conversation and the reasoning
behind each decision. Read it before changing any of this.

Five surfaces, one visible at a time. **`showRoute(route)` is the only thing that touches their
`hidden` flags** — five screens toggled from five different handlers is how the previous layout
ended up with no flow.

- **`entry` → `#profileView`** — the sign-in gate, owned by `profile-ui.js`. Signed-out visitors get sign-in/recovery and the explicit sample action; a conflicting or unavailable account gets its own honest state. **A known owner never sees this**: `bootSurface()` loads the cached programme and routes to the hub.
- **`home` → `#homeView`** — the hub. Today first and largest, with **one** primary action for its state; the last two or three sessions inline (not a destination — you almost always want "the last one"); then one row each to Calendar, Programme and Account. Sync state is a line inside Account and **never** a badge here, so it cannot compete with today's session for attention.
- **`calendar` → `#pageView`** — a continuous vertical scroll of weeks, eight grid columns (a `W1`–`Wn` label plus seven days). Dates outside the block are present but plain. A cell holds the date number and one state mark and nothing else, because at seven columns it is ~37px at 320 and ~47px at 390. An optional hairline marks a non-zero pain-on-waking reading, and only when the athlete tracks it.
- **`date` → `#workoutView`** — the date view and the focus logger. Sticky header (two rows), `<main>`, and the action bar.
- **`programme` / `account` → `#pageView`** — the private library and the block anchor; the account, its one-line sync state, and the two settings scopes.

Inside the date view:

- **Header** (sticky, two rows) — a back arrow and a tappable context line on row 1; a worded Overview/Log toggle and `n/m done` on row 2, with either the progress bar (Overview) or the pip strip (Log) beneath. Nothing here is an input. **The context line reads differently per view**: the block name and `Week n of m` in Overview, where the date view states the date itself directly below, and `Week 3 · Thu 3 Sep` over the day's theme in Log, where there is no date head. Saying the date twice on one screen is exactly the duplication this replaced. Tapping it opens the claim picker. The progress bar has **two fill layers** (`#pbarDone`, and the dimmer `#pbarPart` behind it) so a session with four exercises half-logged doesn't read as 0% through, and the pips carry **three** states, not two (`data-done`, `data-part`).
- **`<main>` in Overview — the date view.** In order: `dateHead()` (the date, what is on it, its state, one primary action, and the quiet claim action), any banners, the check-in, the exercise cards, then `dateFoot()` (Finish session, or the seal/export status). **The check-in never gates Start**, which is why the primary action sits above it.
  - **Overview always renders a status line**, one of six states (see `statusLine()`), plus a right-aligned `○ / ◐ / ✓` badge. An absent line used to mean "untouched", which was indistinguishable from "the status didn't render" — and it left a typed-but-uncommitted set invisible everywhere outside the editor.
- **`<main>` in Log — the focus logger.** Exactly one exercise. Order is load-bearing: name → prescription → the `Capture` chips → **the instrument rail** (rest clock and "last time") → **the set editor** → coach notes / progression rule / Summary & notes. The reference material sits *below* the editor because three collapsibles above the fields pushed the primary action off a 320×568 screen.

The action bar swaps by view: export actions in Overview, `‹ Prev / n / N / Next ›` in Log.
Import lives on the Programme screen; export is per-session and lives on the date view.

## Browser JavaScript layout

The vendored Supabase SDK loads first, followed by the auth and profile modules. `auth-config.js`
selects the local stack only for localhost/loopback and the hosted project elsewhere.
`auth-client.js` owns Supabase Auth calls and exposes state/actions to the rest of the app.
`auth-ui.js` renders sign-in, recovery and password-setup dialogs. `program-store.js` owns every
Data API call to `programs`; `session-store.js` owns every Data API call to `session_logs`.
`settings-store.js` owns every Data API call to `user_settings`.
`profile-ui.js` renders the Account and Programme sections from those stores and local callbacks,
and never calls Supabase itself. The workout script makes no direct backend call: after device
autosave it hands an immutable `tp-session-3` snapshot to the synchronous queue boundary, and a
settings change is written locally and then staged the same way.

The inline workout script is organised in labelled sections, in this order. Keep additions in the matching section.

1. **Helpers / app shell** — `$(sel)` querySelector shorthand, `el(tag, props, kids)` element factory, `toast()`, `slug()`, `showRoute()` and the `open*Page()` helpers, `bootSurface()`, cached-programme entry and explicit sample entry.
1b. **Local calendar days** — `isoOf()`, `todayISO()`, `parseISO()`, `addDays()`, `weekdayOf()`, `mondayOf()`, `daysBetween()`. **Every date in the app is a local calendar day, never a UTC instant**: `new Date("2026-01-01")` parses as midnight UTC and lands on 31 December west of Greenwich, which would shift a whole block by a day. Nothing may reach for `Date.parse`, and `daysBetween()` rounds because a DST boundary makes the raw difference 23 or 25 hours.
2. **Settings** — `FIELD_DEFS` (the switchable fields), the two scopes (`ACCOUNT_KEYS` / `DEVICE_KEYS`), `loadSettings()` (which also migrates a pre-split install), `saveSettings()` (device half), `setSetting(key, value)` — **the only way to write a setting** — `adoptAccountSettings()` for a record merged from another device, `painLbl()`/`painLblShort()`, `renderFields(host)`.
2b. **Theme** — `PALETTES`, `MODES`, `themeId()`, `applyTheme()`, `renderAppearance(host)`. Two palettes (Amber / Mint) × light/dark = the four `html[data-theme]` blocks at the top of the `<style>`. `themeId()` resolves palette + mode (`auto`/`light`/`dark`) to one of them; `applyTheme()` sets `<html data-theme>` and syncs the `theme-color` meta. A `matchMedia` listener re-applies on device light/dark change, but only while mode is `auto`. A ~6-line script in `<head>` duplicates `themeId()` so the correct palette is painted before the body renders — if you change the resolution rule, change both.
2c. **What a session says about itself** — `checkinSummary()`/`checkinFilled()`, which drive the check-in's own one-line status on the date view.
2d. **Moving around the block** — `selectDay()`, `selectWeek()`, `selectDate()`. Each is either a **claim** (a write) or a **date change** (a re-resolve), never an independent axis that could drift out of step. The drawer that used to hold a week stepper, a day list and a standalone date picker is gone: the claim picker holds week and day together, and the calendar holds the date.
3. **Categories** — `CATS`, `CAT_ALIASES`, `CAT_RULES`, `catOf(ex)`. Resolves an exercise's rail colour + tag; see `docs/data-contracts.md` for the fallback ladder.
4. **Program loading** — `isV2()` and `dayExercises()` (the schema fork; see quirks), `dayLabels()` (**the only correct way to read `meta.days`** — a structured day entry is an object, and letting one reach `STATE.day` would break the session key, the day filter and the header at once), `athleteId()`, `loadProgram(obj)` validates and persists a personal import. `boot()` loads settings then `bootSurface()`, which loads the cached programme for a known owner and lands on the hub. `openCachedWorkout()` restores `tp_program_v1`, while `openSampleWorkout()` fetches the pre-cached sample without replacing it.
4b. **The derived schedule** — `WEEKDAYS`/`parseWeekday()`, `dayEntries()`, `programKeyOf()`, `anchorFor()`/`saveAnchor()`/`setAnchorMonday()`, `scheduleFor(program)`, `refreshSchedule()` and the live `SCHEDULE`, then the two directions: `dateFor(week, dayLabel)` and `scheduleForDate(date)`. Three fallbacks for the weekday, in order: a structured field on the programme if one ever exists, the label's `(Mon)`, then distribute across consecutive weekdays from Monday. The anchor defaults to the Monday of the week the programme was imported and is **persisted the first time it resolves**, which is what makes it mean "imported" rather than re-deriving to whatever Monday it is now.
4c. **What a date is** — `dateStateOf(iso)` (the five states), `suggestedWeek()`, `nextScheduled()`, `sessionStored()`, `openState()`, `adoptDate()`, `openDate()`, `applyClaim(week, day)`, `startSession()`.
4d. **Sealing** — `sealSession()`, `unsealSession()`, `markExported()`. Sealing is local and works with the radio off; editing a sealed session never un-seals it. Also the four **read-only readers of the prescription**, which turn what the generator wrote into what the UI asks for: `prescribedSets(ex)`/`targetSets(ex, e)` (how many set slots), `metricOf(ex)` (what the reps field measures — see below), `parseHints(ex)` (the `Capture` chips), and `painAsked(ex)`/`programPainSite()` (which exercises want a pain reading, and which body part this block monitors). All pure, all derived from the opened programme.
5. **Session persistence** — `sessionKey()` (empty when no day is claimed, so a stray autosave cannot file a `::null` record), `normalizeSessionState()`/`sealed()`/`editedSinceExport()`/`nextStamp()`, `getSession()` (also runs `normalizeEntry()` over every entry — see "Migrating a stored entry" below), `saveSession()`; device storage always completes before `TPSessions.stage()` snapshots personal work for asynchronous sync. The set model itself: `blankEntry()`, `blankDraft()`/`seedDraft()`/`draftEmpty()`/`draftDirty()`, `entryState()`, `renumber()`, `deriveSummary()`/`deriveReps()`/`withUnit()`/`pickMode()`/`pickMax()`/`applyDerivedSummary()`, `normalizeEntry()`, `commitSet()`, `deleteSet()`, and the three that make a typed set unloseable: `commitDraftIfDirty()`, `flushDraft()`. Every commit path also takes the session so `stampLastSet()` can write `lastSetAt` — the rest clock's only state.
5b. **The session index** — `sessionIndex()`, `invalidateSessionIndex()`, `sessionsOn(date)`, `lastLoggedFor(ex, date)`, `normName()`. A **cache** over the sibling `tp_sess_v1::*` keys, built once and dropped by every write. `saveSession()` runs on every keystroke, so **never call the builder from a render path** — ask `sessionIndex()`.
6. **Rendering** — `renderAll()` = `renderHeader()` + `renderMain()`. Also `dayParts()`, `dayTheme()`, `fmtDate()`/`fmtDateShort()`/`fmtDateLong()`/`relDay()`/`fmtTime()`, `sessionCard()` (the check-in, rendered into `#checkinHost` on the date view by `renderCheckin()`), `field(label, node, unit, labelClass)`, `updateProgress()`, and the card builders: `exerciseHead(ex)` (shared), `hintChips()`, `overviewCard(ex, s, idx)`, `logCard(ex, s, idx)`, `buildSetEditor()` (recap + chips + count control + fields + actions), `buildSummaryPanel()` (the collapsed, editable flat fields), `summaryText()`, `statusLine()`, `setRecap()`, `painLogged()`, `collapse()`.
6c. **The date view** — `dateHead()`, `dateFoot()`, `sessionProgressLine()`, `sealLine()`, `openClaimPicker()` (screen 9 — week and day together, the current selection preselected), `confirmFinish()`, `confirmReopen()`.
6d. **The hub and the calendar** — `renderHome()`/`homeToday()`/`homeRow()`, `recordProgress()` (progress for a session we are *not* standing in, so it cannot call `dayExercises()`), `recentSessions()`, `lastMissed()`, `accountLine()`; then `renderCalendar()`, `calendarRange()`, `calendarMark()`, `calendarPain()`, `calendarLegend()`.
6e. **Programme and Account** — `anchorPanel()` (the block anchor, editable in one tap, with the derived weekdays shown so it can be checked rather than trusted), `renderProgrammePage()`, `settingsGroup()`, `renderAccountPage()` — which labels the two settings scopes explicitly.
6f. **The focus logger's instruments** — `parseRestSeconds(ex)`, `restSeconds(s)`, `fmtClock()`, `restClockNode()`, `startRestTick()`; `heaviestSet()`, `agoWords()`, `lastTimeNode()`; `instrumentRail()`. One interval for the whole app, and it only ever repaints.
6b. **View mode** — `viewMode()`, `setView()`, `syncView()` (toggle state, footer/header visibility, and capture/restore of the runtime-only Overview scroll position), `firstUndone()`, `resetFocus()`, `clampFocus()`, `goFocus(i)`, `stepFocus(d)`, `renderNav()` (rebuilds the pips) and `paintNav()` (repaints their state, the counter and the prev/next disabled flags on every save, without touching structure — and scrolls the pip strip only when `STATE.focus` actually changed).
7. **Export** — `exportSets()`, `exportEntry()` (a named whitelist, not a rest-spread — see "State model" below), pure `buildSessionPayload(stored, program)` for export/backfill, `buildSessionExport()`, `exportSession()`, `copyJSON()`.
8. **Events** — wiring for the markup that exists for the whole life of the page, a guarded `keydown` listener (Escape closes the action sheet, arrows page the focus view), service-worker registration, `boot()` call. The week, day and date controls are no longer standing widgets: they are the claim picker and the calendar, built on demand.

## State model

```js
STATE = { week: 1, day: "Day 1 (Mon) - ...", date: "2026-07-27", focus: 0, setEdit: null }
APP = { surface: "profile" | "workout", route: "entry" | "home" | "calendar" | "date" | "programme" | "account",
        source: null | "personal" | "sample", from: "home" | "calendar" }
SCHEDULE = { anchorMonday: "2026-07-27", weeks: 6, days: [{ label, weekday }] } | null
```

`APP` is runtime-only. A cold start always resolves through `bootSurface()` — the entry gate for a
guest, the hub for a known owner. `source` selects the personal or demo local namespace while a
workout is open; `from` is where a jump to the date view came from, so back returns there rather
than always to the hub (one level, because there is nothing deeper to remember). `surface` is kept
in step with `route` for the callers that still ask the older question.

**`STATE.date` is primary, and `week`/`day` are derived from it** — read off the claim when a
session is stored on that date, otherwise the schedule's suggestion. Nothing about the position is
stored separately any more: the old `tp_pos_v1` could disagree with the claim, and when it did it
put the wrong week's prescriptions on screen. The date always starts at **today**, because a screen
that silently shows another day gets you doing the wrong session.

`focus` is the index of the exercise shown in Log view and is deliberately **not** persisted: on a
cold start, and whenever the week, day or date changes, it is re-derived by `firstUndone()`, which
lands on the first exercise not yet ticked off. `setEdit` is the index of a committed set being
re-edited from its chip, or `null` while the athlete is typing the next new one (the "draft"); it
lives in memory only and is cleared by every navigation function (`goFocus`, `resetFocus`, and
therefore `adoptDate`/`applyClaim`/`selectDay`/`selectDate`/`selectWeek`/`loadProgram`, which all
call it) — an edit target that survived a navigation would silently write into the wrong exercise's
set. `SCHEDULE` and `SESSION_INDEX` are both derived caches: the first is recomputed when the
programme or the anchor changes, the second dropped by every session write. Everything durable
lives in `localStorage`:

`OVERVIEW_SCROLL` is also memory-only. Leaving Overview captures the window offset, returning from Log restores it, and changing the programme, week, day or date resets it to zero. It deliberately does not survive a reload, where restoring a stale pixel offset into changed content would be misleading.

| Key | Contents |
|---|---|
| `tp_program_v1` | The imported programme. One at a time. Holds **either** `tp-program-1` or `tp-program-2` — the storage key is not versioned, `meta.schema` inside it is. |
| `tp_active_program_v1` | Stable cloud UUID, last known row revision and a `pending` retry marker for the active personal programme. It never contains the programme payload; that remains in `tp_program_v1`. |
| `tp_schedule_v1` | `{ programKey, anchorMonday }` — the block anchor. One date per programme; `programKey` is derived from the programme's own identity (deliberately excluding `meta.version`, so a mid-block revision cannot move every date). The **only** stored state the schedule needs, because claims live in the sessions. |
| `tp_sess_v1::<date>::<day>` | One session's logged data, plus its lifecycle: `status` (`open`\|`sealed`, **absent means open**), `sealedAt`, `exportedAt`, `editedAt`, `lastSetAt`. The **date is in the key**, which is why every session already on a phone lands on its correct calendar date with no migration. None of the lifecycle fields reach an export — `buildSessionPayload()` names every exported key. |
| `tp_session_sync_v1` | Per-local-session cloud identity, last seen revision, dirty generation and—only while dirty—the complete `tp-session-3` retry snapshot. Clean mappings drop the duplicate payload. Never used for sample sessions. |
| `tp_demo_schedule_v1` | Sample-only block anchor, so opening the sample can never move a personal block's dates. |
| `tp_demo_sess_v1::<date>::<day>` | Sample-only session data. Same local shape and export contract, separate namespace. |
| `tp_settings_v1` | The **device** half of the settings: appearance (`palette`: `a`\|`b`, `mode`: `auto`\|`light`\|`dark`), `view` (`list`\|`focus`, meaning Overview\|Log) and `sv`, a one-shot settings-migration marker (see below). Defaults `a` / `auto` / `focus`. Cosmetic and deliberately **not** part of the session export. |
| `tp_account_settings_v1` | The **account** half, as `{ values, at }`: which optional fields are tracked plus `painLabel`, with one ISO timestamp per field. Defaults all-on / `Knee`. Synced by `settings-store.js` with **last write wins, per field**. `tracking` in the session export is built from `FIELD_DEFS` and `painLabel` alone, so nothing added to either scope can leak into a log file. |
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

## The derived schedule, and claims

`tp-program-2` carries no dates. A programme is `(week, day)`, and the weekday exists only as prose
inside the day label — `"Day 1 (Mon) - Clean Skill + Front Squat…"` — a convention documented in
`data-contracts.md` and deliberately **not** enforced by `validate_program.py`. Tracking is
date-first, so exactly one function turns that into calendar dates.

`scheduleFor(program)` returns `{ anchorMonday, weeks, days: [{ label, weekday }] }`. The weekday
resolves through three fallbacks, in this order — matching the documented "generator strict, app
lenient" stance:

1. A structured field on the programme, if one ever exists (`meta.startDate`, a real `weekday` per
   day). Nothing emits these today; `dayEntries()` accepts both a string and a `{label, weekday}`
   object so that adding them later is a no-op in the app rather than a migration.
2. The `(Mon)` parenthetical in the day label, which wins over a weekday word appearing anywhere
   else in it. Every pattern is `\b`-anchored on both sides, so "Monostructural" is not Monday.
3. Distribute across consecutive weekdays from Monday, skipping the ones labelled days already own.
   A partly-labelled programme therefore keeps the weekdays it declares instead of being flattened.

The anchor defaults to the Monday of the week the programme was imported, and is **persisted the
first time it resolves** — that is what makes it mean "imported" rather than re-deriving to
whatever Monday it happens to be now. `meta.startDate` wins over that default but never over an
athlete's own edit, which is already stored and matches on `programKey`. One tap on the Programme
screen moves it, and moving it moves every *suggestion*; stored sessions keep their own dates.

**The schedule is a suggestion, not a commitment.** A **claim** is any stored session carrying a
date, and claims always win: `dateStateOf(iso)` looks for stored sessions first and falls back to
`scheduleForDate(iso)`. That is the whole reason there is no "move session" operation, no cascade,
and no schedule state that can drift out of sync with reality — training Tuesday's session on
Wednesday means opening Wednesday, picking a different day, and the session you create *is* the
claim. A scheduled date that passes with nothing logged simply stays not-done: greyed and quiet,
never red, never rolled forward. Two sessions on one date are allowed and listed, just not designed
for.

**The subtlest way to break this** is `saveSession()`, which writes `week`/`day` from `STATE` on
every keystroke. `STATE.week`/`STATE.day` must therefore always be adopted from the claim
(`adoptDate()`), never re-derived from the schedule while a session is open — otherwise the next
autosave rewrites the claim to the schedule's guess and the athlete trains off the wrong week.

Dates are local calendar days throughout, built from local parts by `parseISO()`. `new Date(iso)`
parses a bare `"2026-01-01"` as midnight UTC, which lands on 31 December west of Greenwich and
would shift a whole block by a day.

## Account-scoped settings

`TPAccountSettings` (`js/settings-store.js`) is the sole `user_settings` Data API boundary, and
follows the same device-first shape as the programme and session stores: the local record is
authoritative for rendering and written synchronously, and the remote is a merge partner rather
than a source of truth. `setSetting()` writes local and calls `stage()`, which schedules the push —
a switch tap never waits on the network, and an offline call simply leaves `pending` true and is
retried on the next auth change or sync.

`mergeRecords()` resolves **last write wins, per field**, using the `at` map beside the values. A
missing stamp loses to any stamp; an equal stamp keeps the earlier side, so a refresh cannot flip a
value back and forward. The merged record is adopted locally *before* the push, so a second device
shows the athlete's real choices even if the write fails. `hasNewer()` is what decides whether there
is anything to push at all, so an already-current record costs no write.

An install that predates the split has its tracked fields in the **device** record. `loadSettings()`
moves them across with the athlete's real values and stamps them at migration time — a migration is
a write, and last-write-wins then resolves two devices migrating differently, which the athlete can
see and re-set in one tap. The account keys are stripped from the device record so a stale copy
cannot confuse a later reader.

## Session synchronization and history

`saveSession()` remains the first and only immediate workout write. Once that local write succeeds,
personal sessions synchronously stage a full `tp-session-3` snapshot in `tp_session_sync_v1`; the
store debounces and serializes Data API work later. A pending programme's stable UUID is retained,
but its session waits until the programme row exists so the owner-scoped foreign key cannot race.
Transport failures retain the dirty snapshot and retry with bounded backoff. A queue/storage failure
is surfaced without undoing the original workout save.

The canonical cloud identity is owner + programme + date + day, matching the local session key's
intentional omission of week. Inserts use a stable UUID and adopt an identical existing record after
an uncertain retry. Updates compare the last-seen `revision`; a stale whole-session write never
overwrites remote work. Instead it receives a new stable UUID and is inserted with `conflict_of`
pointing to the canonical row. The profile labels both versions and lets the athlete read, download
or copy them; promotion/merging is deliberately deferred.

On authenticated refresh, existing personal keys are backfilled only when their block, athlete,
week/day and logged exercise ids identify one known programme safely. Ambiguous records stay local
and are labelled local-only. Remote history is paged 20 rows at a time and held in memory; an offline
cold start shows only this installation's reconstructable local/queued sessions. Explicit sign-out
hides queue and history state without deleting either. `tp_demo_*` sessions never enter this path.

**The separate history browser is retired.** Every session on this device is a date on the calendar,
which is a better index than a flat list ever was, and the last two or three appear inline on the
hub. Sync state is **one line** inside Account. What the calendar cannot show is a copy that is
*not* on this device — a conflict copy, or a session logged on another install — so those, and only
those, stay reachable in Account behind a collapsed "Copies not on this device" section with their
download/copy actions. `hasLocalSession(date, day)` is the filter; a conflict copy is always listed
regardless, which is what "conflict copies should be far less invasive" means in practice.

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

- **A session key is source + `date` + `day`, not week.** Personal and sample sources have separate prefixes. Within either namespace, re-claiming the week does not switch sessions; it rewrites `week` on the one already stored, which is exactly what a correction should do. Because the date is in the key, **every session already on a phone lands on its correct calendar date with no migration** — that is the whole justification for keeping the key as it is.
- **Opening a date switches sessions, and that is the navigation model.** It is how a session gets corrected or completed after the fact, and now also how the calendar works. It used to be load-bearing in a narrower way: `amPainNextDay` could *only* be filled by re-opening yesterday's session the next morning, which is exactly why it kept arriving empty and why `tp-session-3` replaced it with the pre-session `amPainOnWaking`.
- **Exercises are filtered by `day` and `week` — but only for `tp-program-2`.** A v1 programme is a Week-1 template, so filtering it by week would empty the list; it keeps the day-only filter and the "apply your progression rule" banner. `isV2()` is the only place that decides, and `dayExercises()` is the only filter — rendering, the progress bar and the export all call it. See `docs/data-contracts.md`.
- **Ordinary work is one set at a time; circuits are format-aware.** Fixed `N rounds` defaults to a one-tap round counter. AMRAP, EMOM, for-time work and ladders default to a tailored final-result form. A quiet mode sheet switches among Quick rounds, Round details and Final result; changing after data exists requires an explicit reset. `tracking.perSetLogging` remains stamped `true` for compatibility, even though a final-result circuit can validly export `sets: []` with populated flat fields.
- **A new draft always seeds from the set before it**, load/reps/rpe/pain carried forward and the note cleared — the point being that logging N identical sets costs one tap each, and correcting one downward costs one more. The only way to get a genuinely blank draft is for the athlete to clear every field by hand; `commitSet()` refuses to commit one either way, so that can never produce a phantom set.
- **A typed set cannot be lost, and this is not the same thing as auto-logging.** `commitDraftIfDirty()` runs before an ordinary early end, and `flushDraft()` does the same when paging away, changing context/view, exporting or backgrounding. In Round details mode it commits the dirty draft as a circuit round instead. Quick-round taps and final-result fields already save directly. **Every caller that flushes must also re-render** because the flush writes through a session object read fresh from storage.
- **The reps field is whatever the exercise measures**, decided by `metricOf(ex)` from the prescription string: `Hold (s)`, `Time (min)`, `Dist (m)`, `Work (cal)`, `Reps`, or `Result` for composite prose. It sets the label, the keyboard (`inputmode`), the placeholder and the unit appended by `deriveReps()`. The old fixed `inputmode="numeric"` was a digits-only keypad on iOS, which made a 45-second hold untypeable — so the fallback for anything unrecognised is a **full keyboard**, never a numeric one. Composite prose is tested first, or `"45 sec hard / 75 sec easy"` reads as a 45-second hold. The unit lives in the *label*, not as an overlay inside the field: `"min"` plus `"8-10"` does not fit a 68px column and clipped the value.
- **Upcoming set chips are inert `<span>`s, and planned-count changes are secondary.** Tapping an upcoming number used to delete planned sets. The quiet **Adjust sets** action opens a bottom sheet whose −/+ controls write `setTarget`, floored at the current set and capped at 12. The primary set path has no steppers. A one-slot exercise renders no chip strip at all.
- **The programme's `logHint` drives two pieces of UI.** `parseHints()` splits it on semicolons into the `Capture` chip row (four at most), and `painAsked()` accents the pain field's label on any exercise whose hint, coach notes or category say a reading matters, nudging once on Finish if none was logged. It **never hides the field** — `tracking.painPerExercise` means "this device collects per-exercise pain", and an exercise-by-exercise exception would make an empty value unreadable on the coaching side.
- **The flat summary follows `sets` until it doesn't.** `applyDerivedSummary()` recomputes it on every commit/edit/delete while `summaryAuto` is true; editing a flat field directly in "Summary & notes" sets `summaryAuto` to `false` for that entry and it stops following, permanently, for that exercise. Never partially — there's one flag for the whole group, not one per field.
- **Deriving the summary must fail safe on empty or partial data**: no fabricated `"0"` RPE from nothing logged, no `"NaN"` from RPE prose that doesn't parse (fall back to the last raw string), no reps string that asserts more sets than were actually committed. See `deriveReps()`/`pickMode()`/`pickMax()` for the exact rules, and `samples/apptest.js`'s "deriving the flat summary" block for the table they're tested against.
- **The check-in lives near the top of the date view, and never in the focus logger.** It sits above the exercise list and *below* the primary action, so the data is asked for without ever standing between the athlete and a warm-up. Its own status line ("Not filled", or a summary) is how the athlete knows whether it is done; the dot on the ≡ that used to carry that is gone with the hamburger. It is still the *same* `sessionCard()`, still autosaves on every input, and still tints itself by readiness — only its host moved. `renderCheckin()` rebuilds *only* that block, because the exercise list below it holds the scroll position a full rebuild would throw away.
- **Committing a set says so, three ways.** A `LOGGED 60×4 · 60×4` recap line above the chips, a toast naming the set, and a one-off pulse on the chip that just landed (plus `navigator.vibrate` where it exists, guarded). Before this, a commit changed almost nothing on screen — the next draft is seeded from the set just logged, so the fields read the same — which is why it never felt like anything had been recorded. Committing an *empty* draft now toasts why nothing happened instead of being a silent no-op.
- **The final planned set completes and advances automatically.** Before any work the secondary exit is **Skip exercise**; after partial work it is **End after N of M**. Both require a confirmation that states what will be retained. A toast after automatic completion offers **Add set** as the recovery path. Circuit quick mode opens one compact finish sheet after its final prescribed round.
- **`renderNav()` and `paintNav()` are split on purpose.** `saveSession()` runs on every keystroke; rebuilding a pip per exercise that often would fight the scroll position of the strip. `renderNav()` rebuilds structure when the exercise list changes, `paintNav()` only repaints attributes — and scrolls the strip into view only when `STATE.focus` actually changed, and never while an input has focus, which is the fix for the reported screen-jump-while-typing bug.
- **Old session keys are never cleaned up.** They accumulate in `localStorage`. Not a practical problem at this data volume; see roadmap.

- **The rest clock cannot get buggy, by construction.** Committing a set writes `lastSetAt`; the display is always `now − lastSetAt`, recomputed by a single interval that only repaints. There is no timer state to drift, corrupt or desynchronise, so it survives a reload, a backgrounded tab and a killed PWA, and the worst case is a stale number for one repaint. Nothing in the log path reads it, so it can never interfere with logging. The interval stops itself once the node it paints has left the document.
- **The instrument rail is repainted with the editor, not with the whole card.** Both halves follow the set counter — "last time" reads the set *about to be logged*, and the clock only starts once one has been — so `logCard()`'s `redraw()` rebuilds it. It holds no inputs and is only ever redrawn after a deliberate tap, which keeps it inside the repaint-don't-rebuild rule.
- **`sessionKey()` is empty when no day is claimed**, and `saveSession()` returns early on that, so a stray autosave on a rest day cannot file a `::null` record the calendar would then have to explain.
- **The session index is a cache, and every write drops it.** `saveSession()` runs on every keystroke, so the render path must ask `sessionIndex()` and never the builder. Missing an invalidation is how "last time" and the calendar would go quietly stale mid-block.

## Service worker strategy

`CACHE` in `sw.js`. Check the file for the current value rather than trusting this line.

- **`program.json` → network-first, cache fallback.** So a re-deployed sample/programme is picked up when online, but still opens offline.
- **Same-origin app assets → cache-first**, falling back to network, falling back to `./index.html` (so a deep link offline still boots the app). The pinned Supabase SDK, auth/profile modules and bundled sample are in the pre-cached shell.
- **Cross-origin requests are never intercepted.** Supabase Auth and future Data API calls must reach the backend directly; a failed request must never be replaced with cached HTML.
- `install` pre-caches the shell list and calls `skipWaiting()`; `activate` deletes old caches and calls `clients.claim()`.

**When you change any shell file, bump `CACHE`** — increment whatever is there now — or returning users keep the old cached app.

## Export flow

`exportSession()` builds the `tp-session-3` object, serialises it, and triggers a download via a `Blob` + object URL + synthetic `<a download>` click. Both it and `copyJSON()` are wrapped in `try/catch` that toasts the error: a throw here would look like the button doing nothing, at the one moment the session has to leave the phone.

Downloads remain available because they are the portable coaching hand-off and the recovery path for
conflict copies. On iPhone the download goes through the share sheet → *Save to Files* → the Drive
folder. `copyJSON()` is the fallback path — clipboard, then paste into chat.

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
- **The set editor uses the instrument treatment**: a 2px rule under a big tabular numeral with a tiny uppercase letterspaced label over it, rather than four boxed form fields. The tap target is still the full `--h-field`, which is what a chalked thumb needs, and focus is shown by the rule going amber plus the field lighting up — a 3px ring around a borderless field reads as a box coming back. Load and whatever the exercise measures carry the largest numerals, marked with a `.big` class rather than by grid position so reordering the row cannot silently move the emphasis.
- **The narrow pain column takes `painLblShort()`**, the site alone. Once the label is uppercase and letterspaced, "Knee pain" no longer fits ~70px, and the `/10` beside it already says it is a score. Same reasoning as `Dist` over `Distance`. The `aria-label` keeps the full wording.
- **Amber is reserved for *now*** and green for *logged*: the primary action, the rest clock while you are still inside the prescribed rest, the current pip, today's ring on the calendar. Quiet actions (`.quietaction`, `.addnote`) and disclosures are muted and underlined instead — a secondary action that borrowed the accent was competing with the one tap that matters.
- **The calendar is an eight-column grid**, a `W1`–`Wn` label plus seven days, at `20px repeat(7, minmax(0,1fr))` with 2px gaps: about 37px a cell at 320 and 47px at 390. That budget is exactly why a cell holds a date number and one mark and nothing else.

## Current client boundary

No framework, bundler, npm runtime, TypeScript, runtime CDN dependency, analytics or multi-athlete
profile switching. Supabase Auth, the private `programs` library and revision-checked `session_logs`
are the remote client integrations. Programme payloads are cloud-backed, while the selected one
remains in the existing device cache. Session edits still write locally first; the sync queue and
history are additive, and in-progress training never waits for the backend.

**One installation belongs to one beta account.** The first accepted or signed-in account writes a
small owner marker. A later attempt by a different account is signed out locally and rejected without
deleting the cached programme or sessions; that athlete needs a separate browser profile or app
installation. A known owner who did not explicitly sign out can continue using cached workouts and
importing a programme while offline. An explicit sign-out removes only the local Supabase session,
returns to the profile and hides personal cache access until sign-in; it deletes no workout data.

The bundled sample is deliberate demo mode, not a fallback identity. It never replaces
`tp_program_v1`, carries a persistent sample banner, and uses `tp_demo_*` position/session keys so a
guest can explore without reading or overwriting an owner's cached training.

## Account portability and deletion

`TPAccountData.exportAccountData()` requires an authenticated online session and calls the
owner-scoped `export_own_account()` RPC. It produces `tp-account-export-1` with all live and
soft-deleted programmes, canonical and conflict sessions, the account-scoped settings row, plus this
installation's active cache, its own copy of both settings halves, the block anchor, local-only
sessions and dirty queue. Both settings scopes are in the file because a portability export that
omitted the athlete's own tracked-field choices would be incomplete, and the device copy may hold a
change not yet pushed. Supabase tokens, the owner marker, credentials and every `tp_demo_*` key are
excluded. It is an access/portability file only; restoration is deferred.

Deletion first re-authenticates with the current password (no email), then calls
`delete_own_account()`. Only after the RPC succeeds are all non-demo `tp_*` keys cleared and the
installation binding reset. A failed RPC leaves local data untouched. The database retains removed
programme tombstones for 30 days and a daily Cron job then purges them; session history survives
with a null programme reference.

Multi-athlete programme authoring still lives on the coaching side. `athlete/<slug>/` gives each
person their own profile, plans, programmes and logs, and the planner/builder skills take the athlete
as an input. Authentication does not add in-app profile switching.

**The Tracked fields section is not multi-user support.** It is **account-scoped** — which optional
inputs render, and what the pain field is called, follow the athlete to any device they sign in on,
because an athlete who tracks a tendon reading on one phone must not silently stop collecting it on
another. That is one athlete's preferences following one account, not profiles: account identity
still lives in the dedicated auth module and owner marker, nothing in the session autosave path
becomes keyed by person, and in-app profile switching remains deferred.

**Nothing renders a tracked field that is switched off.** Not the check-in column, not the logger's
0–10 row, not the calendar's mark, and not its legend entry — an athlete who does not track it sees
no mark rather than a greyed one. And **every surface uses the athlete's own label**: the check-in
field, the logger's row, the calendar legend and the Overview summary lines all go through
`painLbl()` (or `painLblShort()` where the column is ~70px). Values already logged are never
deleted by switching a field off, and `tracking` in the export still says which fields this athlete
does not collect, so an empty value stays readable.

**Conflict rule: last write wins, per field.** A tracked-fields change made offline on two devices
is not worth a conflict copy — unlike a workout, nothing is lost by resolving it, and the athlete
can see and re-set it in one tap. That is why `tp_account_settings_v1` carries a timestamp per
field rather than one per record.

`meta.athleteId` is the one place a person's name appears in the data path. The app reads it from the imported programme and writes it back out in the session export, so a log file identifies the `athlete/<slug>/logs/` folder it belongs in. It is never used to select, filter, or key anything.
