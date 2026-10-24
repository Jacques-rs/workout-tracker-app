#!/usr/bin/env bash
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SUPABASE_VERSION="2.114.0"

cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1 && [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
  export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi

for command_name in docker node python3 supabase; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ "$(supabase --version)" != "$SUPABASE_VERSION" ]]; then
  echo "Supabase CLI $SUPABASE_VERSION is required; found $(supabase --version)." >&2
  exit 1
fi

echo "==> Starting local Supabase Auth and database"
# Verification already rebuilds the local database below. Starting from a clean minimal
# stack makes Auth/Mailpit available even when a previous `supabase db start` left only
# Postgres running. Suppress `supabase start` stdout because it includes generated local
# secret/service-role values that never belong in CI logs.
supabase stop --no-backup >/dev/null 2>&1 || true
supabase start \
  --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  >/dev/null

echo "==> Rebuilding database from migrations and seed"
supabase db reset --local

echo "==> Running database security tests"
supabase test db

echo "==> Linting database schemas"
supabase --agent no db lint --local --schema public,private --level warning --fail-on error

echo "==> Running local authentication integration tests"
node supabase/tests/auth/auth_flow.test.js

echo "==> Checking browser JavaScript"
python3 scripts/check_inline_js.py

echo "==> Checking JSON fixtures"
python3 -c "import glob,json; [json.load(open(path, encoding='utf-8')) for path in ['program.json','manifest.webmanifest'] + glob.glob('samples/*.json')]"

echo "==> Checking programme-builder Python"
python3 -m py_compile athlete/skills/program-builder/scripts/*.py

echo "==> Validating programme fixtures"
python3 athlete/skills/program-builder/scripts/validate_program.py \
  program.json samples/program.sample.json samples/program.v2.sample.json

echo "==> Running app logic smoke tests"
node samples/apptest.js

echo "==> Running authentication state tests"
node samples/authtest.js

echo "==> Running account/profile UI tests"
node samples/profiletest.js

echo "==> Running account portability tests"
node samples/accountdatatest.js

echo "==> Running programme library tests"
node samples/programstoretest.js

echo "==> Running session synchronization tests"
node samples/sessionstoretest.js

echo "==> Running account-scoped settings tests"
node samples/settingsstoretest.js

echo "==> Running service-worker boundary tests"
node samples/swtest.js

echo "==> Running programme-validator tests"
python3 samples/validatortest.py

echo "All repository verification passed."
