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
  login                            sign in once (in YOUR terminal) and keep a
                                   coach session so later runs need no password
  logout                           revoke that session and delete its file

`revise` refuses, before anything is sent, any revision that
  - is not exactly the next meta.version, or lacks changeNote/reviewedThrough;
  - changes the block's identity (block, athlete, weeks, days) - the app would
    treat it as a different block;
  - changes any (week, day) that already has a logged session;
  - moves an exercise to a different id, which is what a reorder or a mid-day
    insert does - logged sets are stored by id and would land on the wrong row.
Substituting an exercise in place, and editing loads, reps or notes in weeks
not yet trained, are fine.

Connection: TP_SUPABASE_URL and TP_SUPABASE_PUBLISHABLE_KEY if set, otherwise
the HOSTED endpoint in js/auth-config.js (the browser-safe key the app already
ships; never a secret or service-role key), or --local for the `supabase start`
stack.

Sign-in, hosted only: if `login` has been run, the stored coach session is
refreshed silently (Supabase rotates the refresh token on every use, and the
new one is written back). The session file is SESSION_FILE at the repo root,
gitignored, mode 600, and is read and written ONLY by this script - an agent
running the script never opens it. `logout` revokes it server-side. Without a
session: --email or TP_COACH_EMAIL, and the password is prompted for and held
in memory only.
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
REPO_ROOT = os.path.dirname(ATHLETE_ROOT)
SESSION_FILE = os.path.join(REPO_ROOT, ".coach-session.json")
SELF = "self"  # athlete id meaning "the signed-in account's own rows"
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

    def _post(self, path, body, method="POST", headers=None):
        req = urllib.request.Request(
            self.url + path, data=None if body is None else json.dumps(body).encode(),
            method=method,
            headers={"apikey": self.key, "Content-Type": "application/json",
                     "Authorization": f"Bearer {self.token or self.key}", **(headers or {})})
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

    def refresh(self, refresh_token):
        res = self._post("/auth/v1/token?grant_type=refresh_token",
                         {"refresh_token": refresh_token})
        self.token = res["access_token"]
        return res

    def sign_out(self):
        self._post("/auth/v1/logout?scope=local", {})

    def rpc(self, name, **args):
        if args.get("athlete") == SELF:
            return self._own(name, args)
        return self._post(f"/rest/v1/rpc/{name}", args)

    # The coach link refuses a self-link (coach_athletes_not_self), so a coach who also
    # trains from this account reaches their OWN rows through the owner tables and RLS,
    # with the same row shapes and the same revision guard as the coach_* functions.
    def _own(self, name, args):
        rep = {"Prefer": "return=representation"}
        if name == "coach_programs":
            return self._post("/rest/v1/programs?select=id,title,schema_version,"
                              "program_version,payload,revision,updated_at"
                              "&deleted_at=is.null&order=updated_at.desc,id.asc",
                              None, "GET")
        if name == "coach_session_logs":
            since = args.get("since")
            return self._post("/rest/v1/session_logs?select=id,program_id,conflict_of,"
                              "session_date,day,week,schema_version,program_version,"
                              "payload,revision,updated_at&deleted_at=is.null"
                              + (f"&session_date=gt.{since}" if since else "")
                              + "&order=session_date.asc,updated_at.asc,id.asc", None, "GET")
        if name == "coach_publish_program":
            payload = args["payload"]
            return self._post("/rest/v1/programs?select=id,revision", {
                "title": args["title"], "schema_version": payload["meta"]["schema"],
                "program_version": int(payload["meta"].get("version") or 0),
                "payload": payload}, "POST", rep)
        if name == "coach_revise_program":
            payload = args["payload"]
            res = self._post(f"/rest/v1/programs?id=eq.{args['program']}"
                             f"&revision=eq.{args['expected_revision']}&deleted_at=is.null"
                             "&select=id,revision", {
                                 "schema_version": payload["meta"]["schema"],
                                 "program_version": int(payload["meta"].get("version") or 0),
                                 "payload": payload}, "PATCH", rep)
            if not res:
                raise RuntimeError("programme changed or was removed since it was read")
            return res
        raise RuntimeError(f"{name} has no own-account equivalent")


def hosted_endpoint():
    """URL and publishable key: env vars first, else HOSTED in js/auth-config.js."""
    url = os.environ.get("TP_SUPABASE_URL")
    key = os.environ.get("TP_SUPABASE_PUBLISHABLE_KEY")
    if url and key:
        return url, key
    cfg = os.path.join(REPO_ROOT, "js", "auth-config.js")
    try:
        src = open(cfg, encoding="utf-8").read()
    except OSError:
        die(f"no TP_SUPABASE_URL/TP_SUPABASE_PUBLISHABLE_KEY and cannot read {cfg}")
    m = re.search(r'HOSTED\s*=\s*Object\.freeze\(\{\s*url:\s*"([^"]+)",\s*'
                  r'publishableKey:\s*"([^"]+)"', src)
    if not m:
        die(f"could not find the HOSTED endpoint in {cfg}")
    return m.group(1), m.group(2)


def _save_session(url, email, res):
    data = {"url": url, "email": email, "refresh_token": res["refresh_token"]}
    tmp = SESSION_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, SESSION_FILE)


def _load_session(url):
    try:
        data = json.load(open(SESSION_FILE))
    except (OSError, ValueError):
        return None
    return data if data.get("url") == url and data.get("refresh_token") else None


def connect(a):
    if a.local:
        out = subprocess.run(["supabase", "status", "--output", "json"], check=True,
                             capture_output=True, text=True).stdout
        status = json.loads(out)
        url, key = status["API_URL"], status["PUBLISHABLE_KEY"]
    else:
        url, key = hosted_endpoint()
        session = _load_session(url)
        if session:
            account = Account(url, key)
            try:
                _save_session(url, session.get("email"), account.refresh(session["refresh_token"]))
            except RuntimeError as err:
                die(f"stored coach session no longer works ({err}). Run "
                    "`python3 athlete/skills/program-builder/scripts/coach_sync.py login` "
                    "in your own terminal, then retry.")
            return account
        if not sys.stdin.isatty():
            die("no coach session and no terminal to ask for a password. Run "
                "`python3 athlete/skills/program-builder/scripts/coach_sync.py login` "
                "in your own terminal once, then retry.")
    email = a.email or os.environ.get("TP_COACH_EMAIL") or input("Coach email: ")
    password = os.environ.get("TP_COACH_PASSWORD") if a.local else None
    account = Account(url, key)
    account.sign_in(email, password or getpass.getpass(f"Password for {email}: "))
    return account


def cmd_login(a):
    if a.local:
        die("login stores a hosted session; --local signs in per run")
    url, key = hosted_endpoint()
    email = a.email or os.environ.get("TP_COACH_EMAIL") or input("Coach email: ")
    account = Account(url, key)
    res = account._post("/auth/v1/token?grant_type=password",
                        {"email": email, "password": getpass.getpass(f"Password for {email}: ")})
    _save_session(url, email, res)
    print(f"OK: coach session stored for {email}; `logout` revokes it")


def cmd_logout(a):
    url, key = hosted_endpoint()
    session = _load_session(url)
    if session:
        account = Account(url, key)
        try:
            account.refresh(session["refresh_token"])
            account.sign_out()
        except RuntimeError as err:
            print(f"note: server-side revoke failed ({err}); deleting the file anyway")
    try:
        os.remove(SESSION_FILE)
        print("OK: coach session removed")
    except FileNotFoundError:
        print("OK: no stored coach session")


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
    own = account.rpc("coach_programs", athlete=SELF) or []
    if any(athlete_slug(p["payload"]) == wanted for p in own):
        hits.append((SELF, own))
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
    own = account.rpc("coach_programs", athlete=SELF) or []
    if own:
        print(f"(your own account)  ->  "
              f"{', '.join(sorted({athlete_slug(p['payload']) for p in own}))}")
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
    all_logs = account.rpc("coach_session_logs", athlete=athlete_id) or []
    if len(matches) > 1:
        # A manual re-import adds a second row for the same block. The one the athlete
        # trains from is the row holding the most recent session; anything else is a guess.
        latest = {m["id"]: max((r["session_date"] for r in all_logs
                                if r.get("program_id") == m["id"]), default="")
                  for m in matches}
        ranked = sorted(matches, key=lambda m: latest[m["id"]], reverse=True)
        if not latest[ranked[0]["id"]] or latest[ranked[0]["id"]] == latest[ranked[1]["id"]]:
            raise Refused("more than one library row matches this block and the logs do not "
                          "say which the athlete trains from; refusing to guess")
        print(f"note: {len(matches)} library rows match this block; revising "
              f"{ranked[0]['id']} (latest session {latest[ranked[0]['id']]})")
        matches = ranked[:1]
    current = matches[0]
    logged = {(r["week"], r["day"]) for r in all_logs
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
    sub.add_parser("login")
    sub.add_parser("logout")
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
        if a.command in ("login", "logout"):
            return {"login": cmd_login, "logout": cmd_logout}[a.command](a)
        account = connect(a)
        {"athletes": cmd_athletes, "pull": cmd_pull, "publish": cmd_publish,
         "revise": cmd_revise}[a.command](account, a)
    except Refused as err:
        die(str(err))
    except RuntimeError as err:
        die(str(err))


if __name__ == "__main__":
    main()
