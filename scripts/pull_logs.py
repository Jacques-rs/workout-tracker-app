#!/usr/bin/env python3
"""
Pull your own session_logs rows out of Supabase and write each one to
athlete/jacques/logs/ in exactly the shape the app's "Export session" button
produces (schema tp-session-3) — so the review-workout-log skill, and Claude
reading the connected folder, can't tell the difference between a manual
export and this pull.

Zero third-party dependencies (stdlib only), so nothing needs to be pip
installed to run it.

Setup (once):
  1. In the repo root, create a file named .env (NOT committed — see the
      .gitignore update that ships alongside this script) containing:

        SUPABASE_URL=https://<your-project-ref>.supabase.co
        SUPABASE_ANON_KEY=<the browser-safe publishable key, same one the app uses>
        SUPABASE_EMAIL=<the email you sign into the app with>
        SUPABASE_PASSWORD=<the password you sign into the app with>

      This signs in as YOU, so Postgres row-level security only ever returns
      your own rows — nothing more privileged than what the app itself can see.
      Never put the service-role key here.

  2. chmod +x scripts/pull_logs.py   (optional, or just run with python3)

Usage:
  python3 scripts/pull_logs.py             # pull every log not already synced
  python3 scripts/pull_logs.py --since 7   # only the last 7 days
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGS_DIR = ROOT / "athlete" / "jacques" / "logs"
REQUIRED_KEYS = ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_EMAIL", "SUPABASE_PASSWORD")


def load_env():
    env = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in REQUIRED_KEYS:
        env.setdefault(k, os.environ.get(k, ""))
        if not env[k]:
            sys.exit(
                f"Missing {k}. Add it to a .env file in the repo root "
                f"(see the setup notes at the top of this script)."
            )
    return env


def sign_in(env):
    url = f"{env['SUPABASE_URL']}/auth/v1/token?grant_type=password"
    body = json.dumps(
        {"email": env["SUPABASE_EMAIL"], "password": env["SUPABASE_PASSWORD"]}
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"apikey": env["SUPABASE_ANON_KEY"], "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Sign-in failed ({e.code}): {e.read().decode()}")


def fetch_logs(env, access_token, since_date=None):
    query = "select=payload,session_date,day&deleted_at=is.null&order=session_date.asc"
    if since_date:
        query += f"&session_date=gte.{since_date.isoformat()}"
    url = f"{env['SUPABASE_URL']}/rest/v1/session_logs?{query}"
    req = urllib.request.Request(
        url,
        headers={"apikey": env["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {access_token}"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Fetch failed ({e.code}): {e.read().decode()}")


def slugify(day_text):
    s = day_text.lower()
    s = re.sub(r"[()]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def main():
    since = None
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == "--since":
        since = date.today() - timedelta(days=int(args[1]))

    env = load_env()
    token = sign_in(env)
    rows = fetch_logs(env, token, since)

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for row in rows:
        payload = row["payload"]
        fname = f"session-{row['session_date']}-{slugify(row['day'])}.json"
        path = LOGS_DIR / fname
        path.write_text(json.dumps(payload, indent=2))
        written.append(fname)

    if written:
        print(f"Wrote {len(written)} session log(s) to {LOGS_DIR}:")
        for f in written:
            print(f"  {f}")
    else:
        print("No session logs found for that range.")


if __name__ == "__main__":
    main()
