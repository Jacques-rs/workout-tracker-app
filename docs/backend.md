# Backend — boundary and standing guardrails

What the account layer promises, and the rules any change to it must keep. Table shapes,
constraints, indexes and policies live in `supabase/migrations/`; the JSON payload formats live in
`docs/data-contracts.md`; the client mechanism lives in `docs/architecture.md`.

## What it promises

An athlete lands on an account/profile home, signs in, keeps multiple programmes, and reviews
previous logs grouped with their programmes. A deliberate **View sample programme** action keeps
the no-account demo available without making it the default.

**The gym experience is offline-first.** Logging saves on the device immediately and never waits
for the network. Cloud sync adds identity, history, backup and access across installs; it is never
a prerequisite for completing a workout.

Sync promises **reliable backup and ordinary multi-device access, not live concurrent editing.**
If the same workout is edited on two devices before either sees the other's changes, the app
preserves a recoverable conflict copy rather than silently merging individual sets.

## The current boundary

Invite-only private beta on Supabase, using administrator invitations; public and anonymous
sign-up are disabled. Sign-in is email and password with verification and recovery. Programmes are
private and user-owned, imported through the existing JSON flow, with one active at a time.
One installation belongs to one account: a first successful sign-in binds it, and a different
account is rejected without deleting local data.

Three user-data tables, each holding a contract payload as JSONB alongside a small set of
relational metadata columns:

| Table | Holds |
|---|---|
| `programs` | A `tp-program-*` payload plus owner, title, version, revision and soft-delete timestamps |
| `session_logs` | A `tp-session-*` snapshot plus owner, programme/conflict references, session metadata, revision and soft-delete timestamps |
| `user_settings` | One row per owner: which optional fields are tracked and what the pain field is called, plus a per-field timestamp map. Preferences only — no workout payload, no health readings, nothing that reaches a log file |

Add a table only when a demonstrated requirement cannot be expressed cleanly here, and do not
prematurely normalize every exercise and set. Analytics can use Postgres JSON queries or derived
views first.

The operational procedure for a canary and for incidents is `docs/private-beta-runbook.md`.
Features outside this boundary are listed under **Deferred on purpose** in `docs/roadmap.md`.

## Guardrails

- **Hosted Auth-email sends require explicit approval.** See `CLAUDE.md` § Verifying changes —
  it owns this rule. Check the live project's rate-limit/SMTP configuration rather than assuming
  a documented default.
- **Device persistence stays in the immediate autosave path.** Remote sync is asynchronous and
  retryable, and the data flow is one-directional: UI → local store → sync queue → remote store.
  Rendering and input handlers must never make a direct network write.
- **Row-level security on every user-data table**, tested with two users so that cross-user reads
  and writes fail. Keep the Data API's automatic exposure of new tables disabled and grant each
  role its table privileges explicitly in migrations.
- **Migrations are the only way to change the schema.** Commit migrations, sanitized seed data and
  security tests together; never rely on an unrecorded dashboard change.
- **Only a browser-safe publishable key ships in the PWA.** Never a database credential, a
  service-role key or any other secret — the repository is public.
- **Stable UUIDs for programmes and logs.** A display name is never identity.
- **Contract compatibility.** Any change to `tp-program-*` or `tp-session-*` updates
  `docs/data-contracts.md` and its fixtures and tests in the same commit.
- **Real health and training data stays out of git, logs, fixtures and error payloads.**
- **Keep auth, remote storage and sync in small modules** under `js/`, not in the inline script,
  and never combine a frontend rewrite with a backend change.
- **The app stays framework-free** unless a demonstrated limitation justifies changing that.
