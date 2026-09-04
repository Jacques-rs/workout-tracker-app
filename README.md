# Workout Tracker

An installable, offline-first PWA for reading a training programme and logging each session in the gym. The app opens on an account/profile home for one invited athlete per installation, while a deliberate sample path remains available without an account. Supabase authentication, the private programme library and retryable workout history are integrated without changing the device-first workout path.

Sessions export as JSON, which an AI coach reviews to adjust the next week's training. The coaching side of that loop lives alongside the app in `athlete/`: the planner and builder skills plus shared research are committed, and each athlete's own folder — profile, plans, programmes, logs — is **gitignored**.

Live at <https://jacques-rs.github.io/workout-tracker-app/>.

## Quick start (local)

No build step. Serve the folder over HTTP (needed for the service worker):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The repo ships a sample `program.json`. Use **View sample programme** from the account home to enter
the clearly labelled demo; its local activity is stored separately from personal sessions. Importing
a personal programme requires an invited account, saves it on the device first and backs it up to the
private cloud library when connected.

## Backend development

The backend definition lives in `supabase/`: config, ordered migrations, fake seed data and
pgTAP security tests. Install Docker Desktop and Supabase CLI `2.114.0`, then run the complete
frontend-and-backend suite with:

```bash
./scripts/verify.sh
```

The hosted project is migration-managed. Never apply dashboard schema edits or push seed data to it.
`verify.sh` rebuilds the local Supabase database from migrations and removes any existing local-only
Supabase data. It does not contact or modify the hosted project.

Private-beta accounts are created with Supabase administrator invitations, not from the public app.
The invitation link opens the app, verifies the email address and asks the athlete to choose a
password. Password recovery returns to the same app URL. Administrator credentials and service-role
keys must never be entered into the app or committed; the static client contains only Supabase's
browser-safe publishable key.

## Deploy

Any static host with HTTPS — required for install and offline support. Build command: none. Output directory: `/`.

- **GitHub Pages** — *current approach.* Serves `/` from **`dev`**; pushing `dev` deploys. Requires a **public** repo on the free plan, which this one is. Confirm the branch with `gh api repos/Jacques-rs/workout-tracker-app/pages --jq .source` rather than trusting this line — it has gone stale once already.
- **Cloudflare Pages** — the fallback if the repo needs to go private: private repos on the free tier, and the site can be gated with Cloudflare Access.
- **Netlify Drop** — drag the folder in, no repo needed; URL is unlisted but public.

Work happens on the `dev` branch (checked out as a second worktree, `workout-tracker-app-dev/`); merge into `main` to release.

## Install on a phone

Open the deployed URL, then:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

Launch from the home-screen icon — it runs full-screen and works with no signal.

## Using it

1. Sign in from the account home, or choose **View sample programme** for the isolated demo. A known owner can also open cached training while offline.
2. Import a personal programme JSON from the **Programme** screen, or activate one from your private library. Signing out preserves local data but hides it until that owner signs in again.
3. **Home** answers "what am I doing today" first: today's date, what is on it, and one action — **Start session**, **Resume**, **Review**, or nothing at all on a rest day (with a quiet line pointing at the next session). The last few sessions sit below it, then rows to **Calendar**, **Programme** and **Account**.
4. Every date carries a state, and **Calendar** shows the whole block that way: finished, logged-but-not-finished, started, or scheduled-and-not-done. Tap any date to open it.
5. Training a different day from the one the plan suggests needs no special feature — open the date and tap **Doing a different day?** to pick the week *and* day. The session you create is what that date holds; nothing is moved.
6. Fill the **session check-in** — pain on waking, readiness, sleep, bodyweight, HRV note. It sits above the exercise list and never blocks Start: pain on waking describes how the tissue responded to your *last* session, not this one.
7. Train and log each set. The logger shows the rest clock counting up with your prescribed rest marked, and what you lifted for this exercise last time. Everything autosaves locally first, then queues a private cloud snapshot when an account programme is active.
8. **Finish session** at the end of the list records that you finished, rather than leaving it to be guessed from what is logged. It works offline. Editing a sealed session never un-seals it — it just marks the exported file stale.
9. Tap **Export session** to keep the portable coaching file flow, or **Copy JSON** and paste it into chat. Export is per-session and reachable from any past date.
10. **Account** holds your sign-in, one line of sync state, the tracked fields that follow your account to any device, and the appearance settings that stay on this phone. While signed in online, **Export account data** gives the complete cloud-plus-current-device access file, and **Delete account…** permanently removes the cloud account and this installation's personal data after password confirmation.

Two ways to see a date's exercises, switched with the toggle at the top and remembered on the device:

- **Overview** — every exercise for the day, read-only, each with its status.
- **Log** — one exercise at a time. **Prev** / **Next** are in the action bar, the numbered pips in the header jump straight to any exercise, and finishing one moves you to the next.

Everything autosaves on device as you go.

## Docs

| Doc | Contents |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Agent entrypoints; both link to the canonical architecture and backend plan. |
| `docs/data-contracts.md` | The `tp-program-2` input and `tp-session-3` output schemas, and how every earlier version is still supported. |
| `docs/architecture.md` | File layout, state model, service worker, export flow, known quirks. |
| `docs/backend-launch-plan.md` | Live, concise decision register and delivery plan for accounts, saved programmes and cloud-synced logs. |
| `docs/roadmap.md` | Known gaps and candidate features, with rationale. |
| `docs/date-first-revamp.md` | The design record for the date-first revamp — the home hub, calendar-driven sessions, sealing, focus logger. Implemented; still authoritative for *why*. |
| `samples/README.md` | Development fixtures, v1 and v2 of both schemas. |
| `athlete/README.md` | Coaching-project layout: the planner/builder skills, shared research, and one gitignored folder per athlete. |

## Privacy

Read the signed-out, offline-cached [privacy notice](privacy.html) for collection, retention and
deletion details. The private-beta operations checklist is in [docs/private-beta-runbook.md](docs/private-beta-runbook.md).

**This GitHub repo is public** — it has to be for GitHub Pages on the free plan.

Account email, session tokens, authentication requests and private programme payloads are handled by
Supabase. The selected programme is also retained in the browser's `localStorage` for offline use.
Personal check-ins and logged exercise data save on the device first, then synchronize to the
account's RLS-protected `session_logs` rows when connected. Dirty retry snapshots remain in local
storage until acknowledged; cloud-only history is not copied into a second persistent offline cache.
The isolated sample never synchronizes. Repository fixtures remain invented.

Each `athlete/<slug>/` folder holds real health and training data in the working tree. The ignore rules are **deny-by-default**: every folder under `athlete/` is ignored except `skills/` and `sources/`, so a new athlete's folder — and anything dropped into it, including an export the phone share sheet saved one level too high — is covered without editing a file. Never commit a real programme or session log. Check with `git status` and `git check-ignore -v <path>` before committing; once health data is in public history, deleting the file does not remove it.

Because those files are gitignored, git will not protect them: a branch switch or `git clean` can delete them silently. `Fitness/training-prog-project/` is the backup — keep it.
