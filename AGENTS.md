# Repository agent entrypoint

Read these sources before changing the app:

1. `docs/architecture.md` — canonical current architecture, offline invariants and verification.
2. `docs/data-contracts.md` — versioned programme and session integration contracts.
3. `docs/backend-launch-plan.md` — approved account/cloud scope, sequence and security decisions.

Run `./scripts/verify.sh` for repo-level proof. Never commit real athlete data or secrets, bypass
device-first autosave, scatter network writes through UI handlers, or change a JSON contract without
updating its documentation and fixtures in the same change.
