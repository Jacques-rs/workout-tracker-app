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
sign-up are disabled. Sign-in is email and password with verification and recovery, or Google for an
invited email: Supabase links that Google identity to the existing user, and a Google account whose
email was never invited is refused as a sign-up. Programmes are private and user-owned, imported
through the existing JSON flow or published into the library by a linked coach, with one active at
a time.
One installation belongs to one account: a first successful sign-in binds it, and a different
account is rejected without deleting local data.

Three user-data tables, each holding a contract payload as JSONB alongside a small set of
relational metadata columns:

| Table | Holds |
|---|---|
| `programs` | A `tp-program-*` payload plus owner, title, version, revision and soft-delete timestamps |
| `session_logs` | A `tp-session-*` snapshot plus owner, programme/conflict references, session metadata, revision and soft-delete timestamps |
| `user_settings` | One row per owner: which optional fields are tracked and what the pain field is called, plus a per-field timestamp map. Preferences only — no workout payload, no health readings, nothing that reaches a log file |

One append-only record, `health_consents`: each health-data consent decision (`given`,
`declined` or `withdrawn`) with the consent version and when it was made. See **Health-data
consent** below.

One link table, `coach_athletes`: an administrator-created coach → athlete pair, revocable by
either side. A coach reaches a linked athlete's programmes and logs **only** through the
link-checked `coach_*` functions; the three tables' policies stay owner-only, because the app
lists them through RLS alone and a coach policy would put an athlete's rows in the coach's own
library.

## Health-data consent

Pain per exercise, pain on waking, sleep, bodyweight and HRV / notes are health data, recorded on
an account only with the athlete's explicit consent. Readiness and training are not, and are always
logged. What it promises:

- **Asked once, in the app.** The first open after sign-in asks; Not now is a decision too. The
  athlete gives or withdraws consent at any time in Account → Health data. A signed-out install
  keeps everything on the phone and is never asked.
- **Without consent, logging is unchanged except that the health fields are hidden.** The check is
  local and never waits on the network; see `docs/architecture.md`.
- **Every decision is kept.** Rows are insert-only for the athlete — changing your mind is a new
  row — and the latest by `decided_at` is in force. The server sets `recorded_at` and clamps a
  future `decided_at` to it. Rows are in `export_own_account()` and go with the account.
- **Withdrawal stops further use, and does not erase.** Without consent in force,
  `coach_session_logs` blanks every health reading and marks it untracked in *every* log, earlier
  ones included; readiness and training still reach the coach. Logs keep their stored readings, and
  erasure is Delete account.
- **New terms ask again.** `private.health_consent_version()` and `CONSENT_VERSION` in
  `index.html` are bumped together, in a migration, only when the health-data terms change; a
  decision under an older version is not in force. Edit `privacy.html`'s consent paragraph in the
  same change.

Add a table only when a demonstrated requirement cannot be expressed cleanly here, and do not
prematurely normalize every exercise and set. Analytics can use Postgres JSON queries or derived
views first.

The operational procedure for a canary and for incidents is `docs/private-beta-runbook.md`.
Features outside this boundary are listed under **Deferred on purpose** in `docs/roadmap.md`.

## Guardrails

- **Hosted Auth-email sends require explicit approval.** See `CLAUDE.md` § Verifying changes —
  it owns this rule. Check the live project's rate-limit/SMTP configuration rather than assuming
  a documented default.
- **A coach reads health data only through the consent check.** Any new `coach_*` function that
  returns a session payload passes it through `private.strip_health()` unless
  `private.health_consent_given()` holds, with a two-user test.
- **Coach writes stop at the library.** A `coach_*` function may add a programme row or revise
  one from the revision the coach read; it never deletes, activates, or writes `session_logs`.
  Widening coach access means a new function with its own link check and two-user test, never
  a policy on the owner tables.
- **The security advisor's "signed-in users can execute SECURITY DEFINER" warnings on the
  `coach_*` functions and `delete_own_account` are by design.** Each checks the link or a fresh
  password itself; a new one on any other function is a real finding.
- **Google is the only OAuth provider, and the client keeps `flowType: "implicit"`.** PKCE would
  reject the administrator's invite links, which carry no code verifier. The Google OAuth client
  and its secret live in Google Cloud and the hosted dashboard, never in the repo; its one redirect
  URI is the project's `/auth/v1/callback`. Google is an extra way in, not a replacement: accepting
  an invite still sets a password, because account deletion re-authenticates with one and it is
  the fallback whenever Google is unavailable. `supabase/config.toml` leaves Google off locally, so the
  local stack and CI need no Google credentials.
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
