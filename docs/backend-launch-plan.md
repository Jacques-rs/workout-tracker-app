# Backend launch plan

**Status:** Step 6 launch hardening implemented locally; hosted migration, Pro backups, canary and
Auth-email smokes pending
**Last updated:** 2026-08-16
**Owner:** Jacques makes the product calls below; implementation choices default to established
engineering conventions.

This is the live, concise plan for adding accounts and cloud-saved programmes and workout logs.
Update existing sections in place rather than appending history. Keep it short enough to read in
one sitting; the detailed programme and session formats remain in `docs/data-contracts.md`.

## Product outcome

An athlete lands on a clear account/profile home, can sign in, keep multiple programmes, and review
previous workout logs grouped with their programmes. A deliberate **View sample programme** action
keeps the no-account demo available without making it the default experience. The gym experience
remains offline-first: logging saves on the device immediately and never waits for the network.
Cloud synchronization adds identity, history, backup and access across installs; it does not become
a prerequisite for completing a workout.

## Owner decision register

Only the high-level calls that materially change the product or architecture belong here.

### 1. Backend and database platform — decided

**Decision: Supabase.** One managed platform provides authentication, Postgres,
row-level access control and a browser-facing data API. SQL, migrations and JSONB fit the existing
versioned JSON contracts and keep the system inspectable.

| Option | Main advantage | Main tradeoff |
|---|---|---|
| **Supabase — recommended** | Postgres/SQL, integrated auth and row-level security; schema can be reproduced from repo migrations | We must build a small explicit offline sync layer |
| Firebase | Mature web SDK with automatic offline persistence and synchronization | Proprietary document model and security rules; last-write-wins behavior is less explicit |
| Custom API + managed Postgres | Maximum control and portability | We would own authentication integration, API code, deployment, monitoring and more security surface |
| PocketBase/Appwrite/self-hosted backend | More infrastructure control and potential portability | We become responsible for hosting, upgrades, backups and availability too early |

**Status:** decided 2026-08-15. Revisit only if implementation reveals a material blocker.

### 2. Initial sign-in experience — decided

**Decision: email and password, with email verification and password reset.** It is familiar,
works cleanly in a client-only PWA and avoids making the first release depend on Google or Apple
provider configuration.

Alternatives are passwordless email codes/links (less password friction, more email-delivery and
redirect-flow complexity) or social sign-in (fast for users, but adds provider setup and another
external dependency). Additional methods can be added later without changing stored app data.

**Status:** decided 2026-08-15.

### 3. Account requirement — decided

**Decision: the app opens on an account/profile page, with an explicit sample-programme path.** A
signed-out visitor sees invitation sign-in and recovery first, plus a **View sample programme** action
that enters a clearly labelled demo without an account. A signed-in athlete sees her profile,
programmes and recent workout history before entering the active programme. Importing personal
programmes and all cloud features require the account. A previously signed-in athlete must still be
able to reach cached programmes and workouts when the gym has no signal.

The workout screen remains focused on training rather than doubling as account navigation. The
profile is the home for programme management and history; the sample remains a deliberate preview,
not an implicit anonymous account.

**Status:** decided 2026-08-15.

### 4. First-release synchronization promise — decided

**Decision: reliable backup and normal multi-device access, without promising live concurrent
editing.** Device writes save locally first and synchronize when online. If the same workout is edited
on two devices before either sees the other's changes, the app preserves a recoverable conflict
rather than silently merging individual sets.

True real-time, collaborative or field-level merging is possible later, but it adds substantial
complexity for a scenario that is unlikely during initial use.

**Status:** decided 2026-08-15.

### 5. Programme ownership for the first release — decided

**Decision: private, user-owned programmes imported through the existing JSON flow.** Users can
store multiple programmes and choose the active one. Programme creation, a public library, coach
assignment and programme sharing stay out of the first release.

Those collaboration features change permissions and product scope; they should be added only after
the private single-user model is dependable.

**Status:** decided 2026-08-15.

### 6. Launch audience — decided

**Decision: invite-only/private beta using Supabase administrator invitations.** Public and anonymous
sign-up remain disabled. Invited users set a password, and the beta validates account recovery,
offline synchronization, installation and cross-user isolation before public self-service onboarding.

**Status:** decided 2026-08-15.

## Technical direction already delegated

These are engineering defaults, not product decisions Jacques needs to arbitrate unless a concrete
tradeoff is escalated:

- Keep the frontend PWA and the backend definition in this repository.
- Keep device persistence in the immediate autosave path; remote sync is asynchronous and retryable.
- Store programme and session contract payloads as JSONB with a small set of relational metadata
  columns. Do not prematurely normalize every exercise and set.
- Give programmes and logs stable UUIDs; do not use display names as identity.
- Apply row-level security to every user-data table and test with two users that cross-user reads and
  writes fail.
- Enable the Supabase Data API and explicit RLS, but disable automatic exposure of new tables. Grant
  each Data API role only the required table privileges explicitly in migrations.
- Commit database migrations, sanitized seed data and security tests. Do not rely on unrecorded
  dashboard changes.
- Use only a browser-safe publishable key in the PWA. Never ship database credentials, service-role
  keys or other secrets to the client or public repository.
- Preserve `tp-program-*` and `tp-session-*` compatibility. Any contract change must update
  `docs/data-contracts.md` and its fixtures/tests in the same change.
- Keep real health and training data out of git, logs, fixtures and error-report payloads.
- Provide account data export and deletion before public launch.

## Proposed data shape

Three user-data tables. Exact columns, constraints, indexes and policies are implementation details
captured in migrations.

| Table | Purpose | Canonical content |
|---|---|---|
| `programs` | A user's saved programme library | `tp-program-*` JSON payload plus owner, title, version, revision and soft-delete timestamps |
| `session_logs` | Saved and synchronized workout sessions | `tp-session-*` snapshot plus owner, programme/conflict references, session metadata, revision and soft-delete timestamps |
| `user_settings` | The athlete's account-scoped preferences | One row per owner: which optional fields are tracked and what the pain field is called, plus a per-field timestamp map. Merged last-write-wins **per field**; a preferences record is bounded by a check constraint |

Add further tables only when a demonstrated requirement cannot be expressed cleanly here. Analytics
can use Postgres JSON queries or derived views before the storage model is normalized.

**`user_settings` needs an owner decision-register entry.** It was added by the date-first revamp
(`docs/date-first-revamp.md`, Phase 4), which decided that which optional fields the athlete tracks
and what they call them belong to the account rather than the device — an athlete who tracks a
tendon reading on one phone must not silently stop collecting it on another. That is a scope change
against "start with two tables", so it is recorded here rather than left implicit. It stores
preferences only: no workout payload, no health readings, and nothing that reaches a log file.

## Delivery sequence

1. **Foundation — complete:** confirmed the blocking decisions; added the Supabase project layout,
   migration, sanitized seed data, row-level-security tests and CI; and deployed the reviewed
   migration and auth configuration to the hosted beta project.
2. **Authentication — implemented locally; hosted Auth-email smoke pending:** invite acceptance,
   verified email/password setup, sign-in, recovery, device-local sign-out and offline-safe auth
   state are integrated without changing workout persistence. A first successful account binds the
   installation; a different account is rejected without deleting local data. Personal programme
   import requires that account, while the bundled sample and cached workouts remain usable. Local
   automated verification covers
   invitation, recovery, sign-in, local sign-out and offline-owner behavior. Hosted invitation and
   recovery delivery/callback smoke has **not** been completed because each send consumes the shared
   Supabase Auth-email allowance. Public sign-up remains deferred.
3. **Account entry and profile — complete:** sign-in/profile is the
   cold-start surface; the sample is an explicit, labelled action with isolated local storage; and a
   known owner can reach cached training offline. Explicit sign-out preserves but hides personal data.
   Hosted account/profile entry, sample isolation, cached offline access and sign-out hiding passed
   the beta smoke.
4. **Programme library — complete:** list, import, activate and
   soft-remove user-owned programmes from the profile. Imports write the active device cache first;
   an offline attempt keeps one stable UUID and retries after authenticated reconnect. Existing
   device-only programmes require an explicit backup action rather than uploading silently. The
   active programme remains in the existing local key for offline training, and no session payload
   is sent in this phase. Hosted list/import/activate/remove and reconnect behavior passed the beta smoke.
5. **Session synchronization and history — implemented locally, hosted smoke pending:** local autosave
   remains first; personal changes stage complete `tp-session-3` retry snapshots under stable UUIDs,
   then revision-check remote writes. Stale device writes become labelled whole-session conflict copies
   instead of overwriting. Eligible existing logs backfill automatically; unmatched logs remain local.
   The profile groups readable/exportable history by programme, pages cloud rows, and reports queued,
   conflict and local-only states. Offline cold starts show this installation's logs only.
6. **Launch hardening — implemented locally; hosted release gates pending:** account export and
password-confirmed deletion, 30-day programme tombstone purge, privacy notice, payload-free hourly
availability check and beta runbook are committed. Before the canary, apply the reviewed migration,
upgrade to Pro and confirm seven-day managed backups, deploy the shell, and run hosted smoke with
invented data. Hosted invitations and recovery remain approval-gated because each email consumes
the project allowance.

## Guardrails for AI-assisted maintenance

- **Hosted Auth-email budget requires approval.** Supabase's built-in email provider is currently
  documented as allowing two project-wide Auth emails per hour across email-triggering endpoints,
  and Supabase may change that value. Before an agent triggers a hosted administrator invite,
  password recovery/reset email, signup confirmation, email change or resend, it must ask Jacques
  for explicit approval and warn that the action consumes that hourly allowance. General permission
  to test authentication is not sufficient. Check the live project rate-limit/SMTP configuration
  when available rather than assuming the documented default. Local Supabase/Mailpit email tests do
  not consume the hosted allowance and remain safe to run through `./scripts/verify.sh`.

- Keep one canonical architecture description and link to it from both `CLAUDE.md` and `AGENTS.md`;
  do not maintain divergent instructions for Claude and Codex.
- Split auth, remote storage and synchronization into small modules instead of adding them directly
  to the existing large inline script. Refactor incrementally; do not combine a frontend rewrite
  with the backend launch.
- Keep the app framework-free unless a demonstrated limitation justifies changing that decision.
- Prefer explicit data-flow boundaries: UI -> local store -> sync queue -> remote store. Rendering and
  input handlers must not make direct network writes.
- Extend one repo-level verification command as capabilities are added so an agent can prove the
  frontend contracts, migrations and access policies together.
- Record only active decisions and durable rationale here. Remove superseded alternatives instead of
  growing an append-only decision history.

## Explicitly deferred

Coach roles, shared programmes, team accounts, public programme discovery, subscriptions, live
collaboration, detailed analytics and AI calls from the production app are outside the first backend
release. Any of them should first be added to the owner decision register because they materially
change permissions, privacy or product scope.
