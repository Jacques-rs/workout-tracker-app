# Workout Tracker

An installable, offline-first PWA for reading a training programme and logging each session in the gym. The shipped client is one invited athlete account per installation. Supabase authentication is integrated without changing the device-first workout path; programme and session cloud sync remain later phases.

Sessions export as JSON, which an AI coach reviews to adjust the next week's training. The coaching side of that loop lives alongside the app in `athlete/`: the planner and builder skills plus shared research are committed, and each athlete's own folder — profile, plans, programmes, logs — is **gitignored**.

Live at <https://jacques-rs.github.io/workout-tracker-app/>.

## Quick start (local)

No build step. Serve the folder over HTTP (needed for the service worker):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The repo ships a sample `program.json` so the app works immediately. Use **Import** to load a real programme.
The sample remains available without an account. Importing a personal programme requires an invited
account; use the **Account** section in the drawer to sign in.

## Backend development

The backend definition lives in `supabase/`: config, one ordered migration, fake seed data and
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

1. Tap **≡** (or the `Week 1 · Mon` line next to it) to open the drawer. Set week, day and date.
2. Open **Account** to accept an invitation or sign in. Signing out removes this browser's session but deliberately leaves its cached programme and workouts in place.
3. Still in the drawer, fill the **session check-in** — pain on waking, readiness, sleep, bodyweight, HRV note. Do it before you start: pain on waking describes how the tissue responded to your *last* session, not this one. The dot on **≡** stays until something is filled in.
4. Close the drawer and train. Per exercise: read the prescription, expand coach notes or the progression rule if needed, log actual load / sets×reps / RPE / knee pain / notes, and tick it done. The blue "Log:" line says what's worth capturing.
5. Tap **Export session** and save the file into `athlete/<your-slug>/logs/`. (Or **Copy JSON** and paste it into chat. Both are also in the drawer.)

Two ways to see the exercises, switched with the toggle at the top right and remembered on the device:

- **All** — every exercise for the day in one scrolling list.
- **Focus** — one exercise at a time. **Prev** / **Next** are in the footer, the numbered pips in the header jump straight to any exercise, and marking one done moves you to the next.

Everything autosaves on device as you go.

## Docs

| Doc | Contents |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | Agent entrypoints; both link to the canonical architecture and backend plan. |
| `docs/data-contracts.md` | The `tp-program-2` input and `tp-session-3` output schemas, and how every earlier version is still supported. |
| `docs/architecture.md` | File layout, state model, service worker, export flow, known quirks. |
| `docs/backend-launch-plan.md` | Live, concise decision register and delivery plan for accounts, saved programmes and cloud-synced logs. |
| `docs/roadmap.md` | Known gaps and candidate features, with rationale. |
| `samples/README.md` | Development fixtures, v1 and v2 of both schemas. |
| `athlete/README.md` | Coaching-project layout: the planner/builder skills, shared research, and one gitignored folder per athlete. |

## Privacy

**This GitHub repo is public** — it has to be for GitHub Pages on the free plan.

Account email, session tokens and authentication requests are handled by Supabase. Workout programmes,
check-ins and logged exercise data still stay in the browser's `localStorage` and only leave when a
file is exported or JSON copied. The backend contains invented fixtures only; transmission of
athlete workout data does not begin until the later sync phase ships with its privacy controls.

Each `athlete/<slug>/` folder holds real health and training data in the working tree. The ignore rules are **deny-by-default**: every folder under `athlete/` is ignored except `skills/` and `sources/`, so a new athlete's folder — and anything dropped into it, including an export the phone share sheet saved one level too high — is covered without editing a file. Never commit a real programme or session log. Check with `git status` and `git check-ignore -v <path>` before committing; once health data is in public history, deleting the file does not remove it.

Because those files are gitignored, git will not protect them: a branch switch or `git clean` can delete them silently. `Fitness/training-prog-project/` is the backup — keep it.
