# Repository agent entrypoint

Read these sources before changing the app:

1. `docs/architecture.md` — canonical current architecture, offline invariants and verification.
2. `docs/data-contracts.md` — versioned programme and session integration contracts.
3. `docs/backend-launch-plan.md` — approved account/cloud scope, sequence and security decisions.

Run `./scripts/verify.sh` for repo-level proof. This is the implementation gate. Deployed browser
testing is a separate release-smoke gate: if no controllable browser is connected, report only that
release smoke as pending; do not describe the implementation as unverified or repeat completed
implementation work.

Before triggering any email from the hosted Supabase project — including an administrator invite,
password recovery/reset email, signup confirmation, email change or resend — ask Jacques for explicit
approval and warn that the action will consume the project's shared hourly Auth-email allowance. Do
not infer approval from a general testing request. Local Supabase/Mailpit tests do not consume the
hosted allowance and may run as part of `./scripts/verify.sh`.

Never commit real athlete data or secrets, bypass device-first autosave, scatter network writes
through UI handlers, or change a JSON contract without updating its documentation and fixtures in
the same change.
