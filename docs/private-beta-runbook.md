# Private-beta runbook

This runbook intentionally uses no athlete payloads in availability monitoring.

## Before a canary

1. Jacques upgrades the hosted project to Supabase Pro and confirms daily managed backups with seven-day retention in the Supabase dashboard.
2. Review that the database migration is applied and the hourly **Public availability check** workflow is green.
3. Run `./scripts/verify.sh`, deploy the static shell from the approved `dev` source, then perform a non-email browser smoke if a controllable deployed browser is available.
4. Ask Jacques for explicit approval immediately before every hosted invitation or recovery email. Explain that it consumes one of the shared hourly Auth-email allowance; send at most two per hour.

## Canary and release smoke

Use invented data only. Confirm invitation setup, programme import, session sync/history, offline retry, export, recovery, and deletion. Inspect the export for tokens, owner markers and demo data. After deletion, confirm cloud rows and the current device’s personal keys are gone while demo keys remain.

## Daily review and incidents

- Review Supabase Logs and Cron job runs for failures and operational errors; never paste personal payloads into tickets.
- On an outage, tell testers to continue device-first logging, pause invitations, preserve local data, and retry after recovery. Check the availability workflow before declaring recovery.
- On suspected compromise, pause invitations and deployment, rotate affected Supabase credentials in the dashboard, revoke sessions as appropriate, inspect access logs, assess affected accounts, and notify affected testers with administrator guidance.
- To roll back the static client, redeploy the last known-good `dev` revision. Do not roll back a destructive migration; use a reviewed forward migration and restore only through the managed-backup process if necessary.

Public onboarding is out of scope until a dedicated contact route and formal privacy review are complete.
