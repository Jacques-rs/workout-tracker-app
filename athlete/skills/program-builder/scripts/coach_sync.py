#!/usr/bin/env python3
"""
coach_sync.py - the coaching side's link to the athlete's account.

Replaces the two file hops in the loop: session exports filed by hand into
logs/, and a revised program.json re-imported by hand on the phone. It signs in
as the COACH and reaches a linked athlete only through the link-checked
coach_* database functions (supabase/migrations/*_coach_link.sql); it can never
read or write an athlete it is not linked to, delete anything, or activate a
programme on a phone. The athlete still taps Activate or Update device.

  athletes                         list the athletes linked to you
  pull    --athlete <slug>         write unreviewed sessions into logs/
  publish --athlete <slug> --program <program.json> [--athlete-email <e>]
                                   add a NEW block to the athlete's library;
                                   the email is needed only for a first block
  revise  --athlete <slug> --program <program.json>
                                   publish a revision onto the existing block

`revise` refuses, before anything is sent, any revision that
  - is not exactly the next meta.version, or lacks changeNote/reviewedThrough;
  - changes the block's identity (block, athlete, weeks, days) - the app would
    treat it as a different block;
  - changes any (week, day) that already has a logged session;
  - moves an exercise to a different id, which is what a reorder or a mid-day
    insert does - logged sets are stored by id and would land on the wrong row.
Substituting an exercise in place, and editing loads, reps or notes in weeks
not yet trained, are fine.

Connection: TP_SUPABASE_URL and TP_SUPABASE_PUBLISHABLE_KEY (the browser-safe
key the app ships; never a secret or service-role key), or --local for the
`supabase start` stack. Sign-in: --email or TP_COACH_EMAIL, and the password is
prompted for and held in memory only - no token is ever written to disk.
"""
import argparse
import datetime
import getpass
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate_program import validate  # noqa: E402

ATHLETE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
IDENTITY = ("block", "athleteId", "athlete", "weeks", "days", "schema")


class Refused(Exception):
    """A check failed before anything was sent."""


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# --- Mirrors of the app, so the two sides agree on identity and filenames ----

def slug(s):
    """index.html slug()."""
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower())
    return re.sub(r"(^-|-$)", "", s)[:40]


def program_key(payload):
    """index.html programKeyOf(): same key = a revision of the same block."""
    m = payload.get("meta") or {}
    return "|".join([slug(m.get("block")), slug(m.get("athleteId") or m.get("athlete")),
                     str(int(m.get("weeks") or 0)), str(len(m.get("days") or []))])


def session_filename(payload):
    """index.html sessionFilename()."""
    return f"session-{payload.get('date')}-{slug(payload.get('day')) or 'day'}.json"


def athlete_slug(payload):
    m = payload.get("meta") or {}
    return m.get("athleteId") or slug(m.get("athlete"))


# --- The revision guard: pure, so it is tested without a network -------------

def _day_rows(payload, week, day):
    return [e for e in payload.get("exercises") or []
            if e.get("week") == week and e.get("day") == day]


def revision_problems(old, new, logged):
    """Why `new` may not replace `old`. `logged` is a set of (week, day) pairs
    that already have a session against `old`. Empty list = safe to publish."""
    problems = []
    om, nm = old.get("meta") or {}, new.get("meta") or {}
    for key in IDENTITY:
        if om.get(key) != nm.get(key):
            problems.append(f"meta.{key} changed; a revision must keep the block's identity, "
                            "or the app treats it as a new block")
    ov, nv = om.get("version") or 0, nm.get("version")
    if nv != ov + 1:
        problems.append(f"meta.version is {nv!r}; the library holds v{ov}, so a revision "
                        f"must be v{ov + 1}")
    for key in ("changeNote", "reviewedThrough"):
        if not nm.get(key):
            problems.append(f"meta.{key} is missing; every revision says what changed and "
                            "which sessions it reviewed")

    for week, day in sorted(logged, key=lambda p: (p[0], str(p[1]))):
        if _day_rows(old, week, day) != _day_rows(new, week, day):
            problems.append(f"week {week}, {day!r} already has a logged session; a revision "
                            "may only change weeks that have not been trained")

    old_at = {e.get("id"): e.get("name") for e in old.get("exercises") or []}
    for e in new.get("exercises") or []:
        moved_from = [i for i, name in old_at.items()
                      if name == e.get("name") and i != e.get("id")
                      and _same_day(old, i, e)]
        if moved_from and old_at.get(e.get("id")) != e.get("name"):
            problems.append(f"{e.get('name')!r} moved from {moved_from[0]} to {e.get('id')}; "
                            "substitute in place rather than reordering - logged sets are "
                            "stored by id")
    return problems


def _same_day(prog, exercise_id, other):
    for e in prog.get("exercises") or []:
        if e.get("id") == exercise_id:
            return e.get("week") == other.get("week") and e.get("day") == other.get("day")
    return False


def check_payload(payload, path):
    rep = validate(payload, path)
    rep.render()
    if rep.errors:
        raise Refused(f"{path} does not satisfy the programme contract")


# --- The account ------------------------------------------------------------

class Account:
    def __init__(self, url, key):
        self.url, self.key, self.token = url.rstrip("/"), key, None

    def _post(self, path, body):
        req = urllib.request.Request(
            self.url + path, data=json.dumps(body).encode(), method="POST",
            headers={"apikey": self.key, "Content-Type": "application/json",
                     "Authorization": f"Bearer {self.token or self.key}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read() or b"{}")
            except ValueError:
                detail = {}
            msg = detail.get("message") or detail.get("msg") or detail.get(
                "error_description") or err.reason
            raise RuntimeError(f"{path}: HTTP {err.code} - {msg}") from None

    def sign_in(self, email, password):
        res = self._post("/auth/v1/token?grant_type=password",
                         {"email": email, "password": password})
        self.token = res["access_token"]

    def rpc(self, name, **args):
        return self._post(f"/rest/v1/rpc/{name}", args)


def connect(a):
    if a.local:
        out = subprocess.run(["supabase", "status", "--output", "json"], check=True,
                             capture_output=True, text=True).stdout
        status = json.loads(out)
        url, key = status["API_URL"], status["PUBLISHABLE_KEY"]
    else:
        url = os.environ.get("TP_SUPABASE_URL")
        key = os.environ.get("TP_SUPABASE_PUBLISHABLE_KEY")
        if not url or not key:
            die("set TP_SUPABASE_URL and TP_SUPABASE_PUBLISHABLE_KEY, or pass --local")
    email = a.email or os.environ.get("TP_COACH_EMAIL") or input("Coach email: ")
    password = os.environ.get("TP_COACH_PASSWORD") if a.local else None
    account = Account(url, key)
    account.sign_in(email, password or getpass.getpass(f"Password for {email}: "))
    return account


def _linked_by_email(account, email):
    """Only for an athlete's first block, before any programme names their slug."""
    for link in account.rpc("coach_athletes_linked") or []:
        if (link.get("email") or "").lower() == email.lower():
            return link["athlete_id"]
    die(f"{email} is not linked to you")


def find_athlete(account, wanted):
    """The linked athlete whose programmes name athlete/<wanted>/. The slug comes from
    the programmes, never from an email or a display name."""
    hits = []
    for link in account.rpc("coach_athletes_linked") or []:
        programs = account.rpc("coach_programs", athlete=link["athlete_id"]) or []
        if any(athlete_slug(p["payload"]) == wanted for p in programs):
            hits.append((link["athlete_id"], programs))
    if not hits:
        die(f"no linked athlete has a programme for {wanted!r}; check the slug, or that "
            "the link exists")
    if len(hits) > 1:
        die(f"more than one linked athlete has programmes for {wanted!r}; refusing to guess")
    return hits[0]


# --- Commands ---------------------------------------------------------------

def log_names(rows):
    """One distinct file per row. A conflict copy keeps its own suffix; two live rows for one
    date and day (started under one programme version, finished under the next) would share
    the app's export name, so the newest keeps it and each earlier one is marked -earlier-.
    Relies on coach_session_logs ordering rows oldest first within a date."""
    names = []
    for i, row in enumerate(rows):
        name = session_filename(row["payload"])
        if row.get("conflict_of"):
            name = name[:-5] + f"-conflict-{row['id'][:8]}.json"
        elif any(not r.get("conflict_of") and session_filename(r["payload"]) == name
                 for r in rows[i + 1:]):
            name = name[:-5] + f"-earlier-{row['id'][:8]}.json"
        names.append(name)
    return names


def cmd_athletes(account, a):
    for link in account.rpc("coach_athletes_linked") or []:
        programs = account.rpc("coach_programs", athlete=link["athlete_id"]) or []
        slugs = sorted({athlete_slug(p["payload"]) for p in programs}) or ["(no programmes)"]
        print(f"{link['email']}  ->  {', '.join(slugs)}")


def cmd_pull(account, a):
    athlete_id, programs = find_athlete(account, a.athlete)
    since = a.since or max((p["payload"].get("meta", {}).get("reviewedThrough") or ""
                            for p in programs), default="") or None
    rows = account.rpc("coach_session_logs", athlete=athlete_id, since=since) or []
    logs = os.path.join(a.root, a.athlete, "logs")
    os.makedirs(logs, exist_ok=True)
    written = 0
    for row, name in zip(rows, log_names(rows)):
        kind = "conflict copy" if row.get("conflict_of") else "session"
        if kind == "session" and name != session_filename(row["payload"]):
            kind = "earlier copy"
            print(f"WARNING: {name} shares its date and day with "
                  f"{session_filename(row['payload'])} under another programme row - read both")
        path = os.path.join(logs, name)
        # An edit moves a row last, so a former earlier copy can become canonical: its old
        # file would otherwise stay in the window as uncorrected evidence.
        stale = os.path.join(logs, session_filename(row["payload"])[:-5]
                             + f"-earlier-{row['id'][:8]}.json")
        if stale != path and os.path.exists(stale):
            os.remove(stale)
            print(f"removed superseded earlier copy: {stale}")
        body = json.dumps(row["payload"], ensure_ascii=False, indent=2) + "\n"
        if os.path.exists(path) and open(path, encoding="utf-8").read() == body:
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        written += 1
        print(f"{kind}: {path}")
    print(f"OK: {len(rows)} session(s) after {since or 'the start'}, {written} written to {logs}")


def _read_program(path):
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    check_payload(payload, path)
    return payload


def cmd_publish(account, a):
    payload = _read_program(a.program)
    if a.athlete_email:
        athlete_id = _linked_by_email(account, a.athlete_email)
        programs = account.rpc("coach_programs", athlete=athlete_id) or []
        if any(athlete_slug(p["payload"]) not in ("", a.athlete) for p in programs):
            raise Refused(f"{a.athlete_email} already has programmes for another slug")
    else:
        athlete_id, programs = find_athlete(account, a.athlete)
    if athlete_slug(payload) != a.athlete:
        raise Refused(f"{a.program} is for {athlete_slug(payload)!r}, not {a.athlete!r}")
    if any(program_key(p["payload"]) == program_key(payload) for p in programs):
        raise Refused("this block is already in the athlete's library; use `revise`")
    if a.dry_run:
        print("OK (dry run): would publish a new block; nothing was sent")
        return
    title = payload["meta"]["block"]
    res = account.rpc("coach_publish_program", athlete=athlete_id, title=title, payload=payload)
    print(f"OK: published {title!r} to the library as {res[0]['id']}. The athlete "
          "activates it on their phone.")


def cmd_revise(account, a):
    payload = _read_program(a.program)
    athlete_id, programs = find_athlete(account, a.athlete)
    matches = [p for p in programs if program_key(p["payload"]) == program_key(payload)]
    if not matches:
        raise Refused("no block in the athlete's library matches this one; use `publish`")
    if len(matches) > 1:
        raise Refused("more than one library row matches this block; refusing to guess "
                      "which the athlete trains from")
    current = matches[0]
    logged = {(r["week"], r["day"]) for r in
              account.rpc("coach_session_logs", athlete=athlete_id) or []
              if r.get("program_id") == current["id"]}
    problems = revision_problems(current["payload"], payload, logged)
    if problems:
        raise Refused("refusing to publish:\n  - " + "\n  - ".join(problems))
    if a.dry_run:
        print(f"OK (dry run): v{payload['meta']['version']} is safe to publish; "
              "nothing was sent")
        return
    res = account.rpc("coach_revise_program", athlete=athlete_id, program=current["id"],
                      expected_revision=current["revision"], payload=payload)
    print(f"OK: v{payload['meta']['version']} published (row revision {res[0]['revision']}). "
          "The athlete sees Update device on their phone.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--local", action="store_true", help="use the local supabase stack")
    ap.add_argument("--email", help="coach account email")
    ap.add_argument("--root", default=ATHLETE_ROOT, help=argparse.SUPPRESS)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("athletes")
    p = sub.add_parser("pull")
    p.add_argument("--athlete", required=True)
    p.add_argument("--since", help="YYYY-MM-DD; default: the latest reviewedThrough")
    for name in ("publish", "revise"):
        p = sub.add_parser(name)
        p.add_argument("--athlete", required=True)
        p.add_argument("--program", required=True)
        p.add_argument("--dry-run", action="store_true")
        if name == "publish":
            p.add_argument("--athlete-email",
                           help="the athlete's first block only: pick the link by email")
    a = ap.parse_args()
    if getattr(a, "since", None):
        try:
            datetime.date.fromisoformat(a.since)
        except ValueError:
            die(f"--since must be YYYY-MM-DD, got {a.since!r}")

    try:
        account = connect(a)
        {"athletes": cmd_athletes, "pull": cmd_pull, "publish": cmd_publish,
         "revise": cmd_revise}[a.command](account, a)
    except Refused as err:
        die(str(err))
    except RuntimeError as err:
        die(str(err))


if __name__ == "__main__":
    main()
