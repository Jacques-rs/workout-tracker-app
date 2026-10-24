# Repository agent entrypoint

`CLAUDE.md` holds the working rules for this repo — read it first. It is not Claude-specific;
this file exists only so a non-Claude agent finds the same instructions.

Canonical references: `docs/architecture.md` (how the app works), `docs/data-contracts.md` (the
JSON schemas), `docs/backend.md` (the account layer's boundary and guardrails).

`./scripts/verify.sh` is the implementation gate.

Never commit real athlete data or secrets, bypass device-first autosave, scatter network writes
through UI handlers, or change a JSON contract without updating its documentation and fixtures in
the same commit.
