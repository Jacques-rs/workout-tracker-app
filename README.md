# Workout Tracker

An installable, offline-first PWA for reading a training programme and logging each session in the gym. Single user, no accounts, no backend.

Sessions export as JSON, which an AI coach reviews to adjust the next week's training.

## Quick start (local)

No build step. Serve the folder over HTTP (needed for the service worker):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The repo ships a sample `program.json` so the app works immediately. Use **Import** to load a real programme.

## Deploy

Any static host with HTTPS — required for install and offline support. Build command: none. Output directory: `/`.

- **Cloudflare Pages** — works from a private repo on the free tier; the live site can be gated with Cloudflare Access. *Current approach.*
- **GitHub Pages** — free plan requires a **public** repo.
- **Netlify Drop** — drag the folder in, no repo needed; URL is unlisted but public.

## Install on a phone

Open the deployed URL, then:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

Launch from the home-screen icon — it runs full-screen and works with no signal.

## Using it

1. Select week, day and date at the top.
2. Fill the session check-in (bodyweight, sleep, readiness, HRV note).
3. Per exercise: read the prescription, expand coach notes or the progression rule if needed, tick it done, and log actual load / sets×reps / RPE / knee pain / notes. The blue "Log:" line says what's worth capturing.
4. Tap **Export session** and save the file into the coaching project's `logs/` folder. (Or **Copy JSON** and paste it into chat.)
5. Next morning, re-open the session by setting the date back, add next-morning knee pain, and re-export.

Everything autosaves on device as you go.

## Docs

| Doc | Contents |
|---|---|
| `CLAUDE.md` | Primary context: purpose, constraints, conventions. Read first. |
| `docs/data-contracts.md` | The `tp-program-1` input and `tp-session-1` output schemas. |
| `docs/architecture.md` | File layout, state model, service worker, export flow, known quirks. |
| `docs/athlete-context.md` | Why specific fields exist — read before removing any. |
| `docs/roadmap.md` | Known gaps and candidate features, with rationale. |
| `samples/` | Fixtures for development and testing. |

## Privacy

Logged data stays in the browser's `localStorage` on the device and only leaves when a file is exported or JSON copied. Nothing is transmitted anywhere. **Do not commit real programmes or session logs to this repo.**
