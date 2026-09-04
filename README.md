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

- **GitHub Pages** — *current approach.* Serves `/` from **`dev`**; pushing `dev` deploys. Requires a **public** repo on the free plan, which this one is. Confirm the branch with `gh api repos/Jacques-rs/workout-tracker-app/pages --jq .source` rather than trusting this line.
- **Cloudflare Pages** — the fallback if the repo needs to go private: private repos on the free tier, and the site can be gated with Cloudflare Access.
- **Netlify Drop** — drag the folder in, no repo needed; URL is unlisted but public.

Work happens on the `dev` branch. Several worktrees of this clone exist — run `git worktree list` to see them.

## Install on a phone

Open the deployed URL, then:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

Launch from the home-screen icon — it runs full-screen and works with no signal.

## Using it

1. Sign in from the account home, or choose **View sample programme** for the isolated demo. A known owner can also open cached training while offline.
2. Import a personal programme JSON from the **Programme** screen, or activate one from your private library. Signing out preserves local data but hides it until that owner signs in again.
3. **Home** answers "what am I doing today": today's date, what is on it, and one action. Recent sessions sit below, then rows to **Calendar**, **Programme** and **Account**.
4. **Calendar** shows the whole block, every date carrying its own state. Tap any date to open it. Training a different day than planned needs no special feature — open the date and tap **Doing a different day?** to pick the week *and* day.
5. Fill the **session check-in** at the top of the date, then train. Each date has two views, switched with the header toggle: **Overview** (every exercise, read-only, each with its status) and **Log** (one exercise and one set at a time, with the rest clock and what you lifted last time).
6. **Finish session** at the end records that you finished. It works offline.
7. **Export session** gives the coaching file, or **Copy JSON** pastes it into chat. Export is per-session and reachable from any past date.
8. **Account** holds sign-in, one line of sync state, the tracked fields that follow your account to any device, the appearance settings that stay on this phone, and account export/deletion.

Everything autosaves on the device as you go.

## Docs

Each fact has exactly one owner. If two files disagree, the owner wins.

| Doc | Owns |
|---|---|
| `CLAUDE.md` | The working rules: hard constraints, conventions, verification and deploy policy. `AGENTS.md` points at it. |
| `docs/architecture.md` | How the app actually works — file layout, routes, state model, storage keys, sync, service worker, export, styling, known quirks. |
| `docs/data-contracts.md` | The `tp-program-2` input and `tp-session-3` output schemas, and how every earlier version stays supported. |
| `docs/design-rationale.md` | *Why* the app is shaped this way. The arguments, not the mechanism. |
| `docs/backend.md` | What the account layer promises, its current boundary, and the guardrails on changing it. |
| `docs/private-beta-runbook.md` | The canary, release smoke and incident procedure. |
| `docs/roadmap.md` | Everything not built: candidates, deferred, declined. |
| `samples/README.md` | The fixtures and the dependency-free test inventory. |
| `athlete/README.md` | Coaching-project layout, and one gitignored folder per athlete. |

## Privacy

Read the signed-out, offline-cached [privacy notice](privacy.html) for collection, retention and
deletion details.

**This GitHub repo is public** — it has to be for GitHub Pages on the free plan.

Account email, session tokens, authentication requests and private programme payloads are handled by
Supabase. The selected programme is also retained in the browser's `localStorage` for offline use.
Personal check-ins and logged exercise data save on the device first, then synchronize to the
account's RLS-protected `session_logs` rows when connected. Dirty retry snapshots remain in local
storage until acknowledged; cloud-only history is not copied into a second persistent offline cache.
The isolated sample never synchronizes. Repository fixtures remain invented.

Each `athlete/<slug>/` folder holds real health and training data in the working tree, and the
ignore rules are **deny-by-default** so a new athlete's folder is covered the moment it exists.
**Never commit a real programme or session log** — once health data is in public history, deleting
the file does not remove it. The rule and the pre-commit check are in `CLAUDE.md`.

Because those files are gitignored, git will not protect them: a branch switch or `git clean` can delete them silently. `Fitness/training-prog-project/` is the backup — keep it.
