# Workout Tracker

An installable, offline-first PWA for reading a training programme and logging each session in the gym. Single user, no accounts, no backend.

Sessions export as JSON, which an AI coach reviews to adjust the next week's training. The coaching side of that loop — the athlete profile, past logs and research the coach reads — lives alongside the app in `athlete/`, which is **not committed**.

Live at <https://jacques-rs.github.io/workout-tracker-app/>.

## Quick start (local)

No build step. Serve the folder over HTTP (needed for the service worker):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The repo ships a sample `program.json` so the app works immediately. Use **Import** to load a real programme.

## Deploy

Any static host with HTTPS — required for install and offline support. Build command: none. Output directory: `/`.

- **GitHub Pages** — *current approach.* Serves `/` from `main`; pushing to `main` deploys. Requires a **public** repo on the free plan, which this one is.
- **Cloudflare Pages** — the fallback if the repo needs to go private: private repos on the free tier, and the site can be gated with Cloudflare Access.
- **Netlify Drop** — drag the folder in, no repo needed; URL is unlisted but public.

Work happens on the `dev` branch (checked out as a second worktree, `workout-tracker-app-dev/`); merge into `main` to release.

## Install on a phone

Open the deployed URL, then:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

Launch from the home-screen icon — it runs full-screen and works with no signal.

## Using it

1. Select week, day and date at the top.
2. Fill the session check-in (bodyweight, sleep, readiness, HRV note).
3. Per exercise: read the prescription, expand coach notes or the progression rule if needed, tick it done, and log actual load / sets×reps / RPE / knee pain / notes. The blue "Log:" line says what's worth capturing.
4. Tap **Export session** and save the file into `athlete/logs/`. (Or **Copy JSON** and paste it into chat.)
5. Next morning, re-open the session by setting the date back, add next-morning knee pain, and re-export.

Everything autosaves on device as you go.

## Docs

| Doc | Contents |
|---|---|
| `CLAUDE.md` | Primary context: purpose, constraints, conventions, repo layout. Read first. |
| `docs/data-contracts.md` | The `tp-program-1` input and `tp-session-1` output schemas. |
| `docs/architecture.md` | File layout, state model, service worker, export flow, known quirks. |
| `docs/roadmap.md` | Known gaps and candidate features, with rationale. |
| `samples/` | Fixtures for development and testing. |
| `athlete/` | Coaching project data — profile and session logs (gitignored), plus `sources/` research. |

## Privacy

**This GitHub repo is public** — it has to be for GitHub Pages on the free plan.

Logged data stays in the browser's `localStorage` on the device and only leaves when a file is exported or JSON copied. Nothing is transmitted anywhere.

The `athlete/` folder holds real health and training data in the working tree and is gitignored. Do not commit anything under it, and never commit a real programme or session log. Check with `git status` and `git check-ignore -v <path>` before committing — once health data is in public history, deleting the file does not remove it.

Because those files are gitignored, git will not protect them: a branch switch or `git clean` can delete them silently. `Fitness/training-prog-project/` is the backup — keep it.
