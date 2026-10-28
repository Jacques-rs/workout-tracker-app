#!/usr/bin/env python3
"""
Local-only proof of coach_sync.py against the real coach_* functions.

Credentials come from `supabase status` in memory and are never printed. Every address
is randomized under `.invalid`, and the users are deleted at the end.
"""
import copy
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
SCRIPT = os.path.join(ROOT, "athlete", "skills", "program-builder", "scripts", "coach_sync.py")
PASSWORD = "localCoach123"


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("  ok   " + message)


status = json.loads(subprocess.run(["supabase", "status", "--output", "json"], cwd=ROOT,
                                   check=True, capture_output=True, text=True).stdout)
API, PUBLIC, SECRET = status["API_URL"], status["PUBLISHABLE_KEY"], status["SECRET_KEY"]


def call(method, path, body=None, key=PUBLIC, bearer=None, prefer=None):
    headers = {"apikey": key, "Authorization": f"Bearer {bearer or key}",
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(API + path, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        raise AssertionError(f"{method} {path}: HTTP {err.code}") from None


def make_user(label):
    email = f"{label}-{uuid.uuid4().hex[:10]}@example.invalid"
    user = call("POST", "/auth/v1/admin/users", key=SECRET,
                body={"email": email, "password": PASSWORD, "email_confirm": True})
    token = call("POST", "/auth/v1/token?grant_type=password",
                 body={"email": email, "password": PASSWORD})["access_token"]
    return {"id": user["id"], "email": email, "token": token}


def coach_sync(*args, root):
    env = dict(os.environ, TP_COACH_PASSWORD=PASSWORD)
    return subprocess.run([sys.executable, SCRIPT, "--local", "--email", coach["email"],
                           "--root", root, *args],
                          cwd=ROOT, env=env, capture_output=True, text=True)


with open(os.path.join(ROOT, "samples", "program.v2.sample.json"), encoding="utf-8") as f:
    fixture = json.load(f)
DAY1 = fixture["meta"]["days"][0]
SLUG = fixture["meta"]["athleteId"]

users = []
try:
    coach, athlete, stranger = (make_user(n) for n in ("coach", "athlete", "stranger"))
    users = [coach, athlete, stranger]
    call("POST", "/rest/v1/coach_athletes", key=SECRET,
         body={"coach_id": coach["id"], "athlete_id": athlete["id"]})

    program = call("POST", "/rest/v1/programs", bearer=athlete["token"],
                   prefer="return=representation",
                   body={"title": fixture["meta"]["block"], "schema_version": "tp-program-2",
                         "program_version": fixture["meta"]["version"], "payload": fixture})[0]
    # The fixture is a revision reviewed through 2026-01-14: the first session is
    # already reviewed, the second is not.
    for date, week in (("2026-01-12", 2), ("2026-01-19", 3)):
        call("POST", "/rest/v1/session_logs", bearer=athlete["token"],
             body={"program_id": program["id"], "session_date": date, "day": DAY1,
                   "week": week, "schema_version": "tp-session-3", "program_version": 3,
                   "payload": {"schema": "tp-session-3", "date": date, "day": DAY1,
                               "week": week}})
    other = copy.deepcopy(fixture)
    other["meta"]["athleteId"] = "stranger-slug"
    call("POST", "/rest/v1/programs", bearer=stranger["token"],
         body={"title": "Stranger", "schema_version": "tp-program-2", "payload": other})

    root = tempfile.mkdtemp()
    res = coach_sync("athletes", root=root)
    check(res.returncode == 0 and athlete["email"] in res.stdout and SLUG in res.stdout,
          "athletes lists the linked athlete by their programme slug")
    check(stranger["email"] not in res.stdout and "stranger-slug" not in res.stdout,
          "and never an unlinked one")

    res = coach_sync("pull", "--athlete", SLUG, root=root)
    logs = sorted(os.listdir(os.path.join(root, SLUG, "logs")))
    check(res.returncode == 0
          and logs == ["session-2026-01-19-day-1-mon-clean-skill-front-squat-knee-c.json"],
          "pull writes only sessions after reviewedThrough, under the app's export name")

    # Started under one programme row, finished under another: two live rows, one export name.
    restarted = copy.deepcopy(fixture)
    restarted["meta"]["block"] = "SAMPLE BLOCK RESTARTED"
    other_program = call("POST", "/rest/v1/programs", bearer=athlete["token"],
                         prefer="return=representation",
                         body={"title": "Restarted", "schema_version": "tp-program-2",
                               "payload": restarted})[0]
    call("POST", "/rest/v1/session_logs", bearer=athlete["token"],
         body={"program_id": other_program["id"], "session_date": "2026-01-19", "day": DAY1,
               "week": 3, "schema_version": "tp-session-3", "program_version": 1,
               "payload": {"schema": "tp-session-3", "date": "2026-01-19", "day": DAY1,
                           "week": 3, "finished": True}})
    res = coach_sync("pull", "--athlete", SLUG, root=root)
    logs = sorted(os.listdir(os.path.join(root, SLUG, "logs")))
    canonical = os.path.join(root, SLUG, "logs", logs[-1])
    with open(canonical, encoding="utf-8") as f:
        newest = json.load(f)
    check(res.returncode == 0 and len(logs) == 2 and "-earlier-" in logs[0]
          and newest.get("finished") is True,
          "a date and day under two programme rows lands as two files, newest canonical")
    check("WARNING" in res.stdout and logs[0] in res.stdout and "2 written" in res.stdout,
          "and the pull names the earlier copy and counts both")

    # Editing the earlier row makes it the newest: it takes the export name, and its old
    # earlier copy goes rather than lingering as uncorrected evidence.
    earlier = call("GET", f"/rest/v1/session_logs?program_id=eq.{program['id']}"
                   "&session_date=eq.2026-01-19&select=id", bearer=athlete["token"])[0]
    call("PATCH", f"/rest/v1/session_logs?id=eq.{earlier['id']}", bearer=athlete["token"],
         body={"payload": {"schema": "tp-session-3", "date": "2026-01-19", "day": DAY1,
                           "week": 3, "corrected": True}})
    res = coach_sync("pull", "--athlete", SLUG, root=root)
    logs = sorted(os.listdir(os.path.join(root, SLUG, "logs")))
    with open(canonical, encoding="utf-8") as f:
        newest = json.load(f)
    check(res.returncode == 0 and len(logs) == 2 and newest.get("corrected") is True
          and earlier["id"][:8] not in "".join(logs),
          "an edit that changes which row is newest leaves two files, not three")

    res = coach_sync("pull", "--athlete", "stranger-slug", root=root)
    check(res.returncode != 0, "pull refuses a slug that belongs to an unlinked athlete")

    revised = copy.deepcopy(fixture)
    revised["meta"].update(version=4, changeNote="W3 squat held", reviewedThrough="2026-01-19")
    next(e for e in revised["exercises"] if e["week"] == 4)["load"] = "held"
    path = os.path.join(root, "program.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(revised, f)

    res = coach_sync("revise", "--athlete", SLUG, "--program", path, "--dry-run", root=root)
    check(res.returncode == 0 and "dry run" in res.stdout, "a dry run passes the guard")
    row = call("GET", f"/rest/v1/programs?id=eq.{program['id']}&select=revision",
               bearer=athlete["token"])[0]
    check(row["revision"] == 1, "and sends nothing")

    res = coach_sync("revise", "--athlete", SLUG, "--program", path, root=root)
    row = call("GET", f"/rest/v1/programs?id=eq.{program['id']}&select=revision,payload",
               bearer=athlete["token"])[0]
    check(res.returncode == 0 and row["revision"] == 2
          and row["payload"]["meta"]["changeNote"] == "W3 squat held",
          "revise lands on the athlete's existing row, with its change note")

    trained = copy.deepcopy(revised)
    trained["meta"]["version"] = 5
    next(e for e in trained["exercises"] if e["week"] == 3 and e["day"] == DAY1)["load"] = "x"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(trained, f)
    res = coach_sync("revise", "--athlete", SLUG, "--program", path, root=root)
    row = call("GET", f"/rest/v1/programs?id=eq.{program['id']}&select=revision",
               bearer=athlete["token"])[0]
    check(res.returncode != 0 and "already has a logged session" in res.stderr
          and row["revision"] == 2, "a revision of a trained day is refused before sending")

    block2 = copy.deepcopy(fixture)
    block2["meta"].update(block="SAMPLE BLOCK 2", version=1, startDate="2026-02-02")
    for key in ("changeNote", "reviewedThrough"):
        block2["meta"].pop(key, None)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(block2, f)
    res = coach_sync("publish", "--athlete", SLUG, "--program", path, root=root)
    titles = [p["title"] for p in call("GET", "/rest/v1/programs?select=title",
                                       bearer=athlete["token"])]
    check(res.returncode == 0 and "SAMPLE BLOCK 2" in titles,
          "publish adds a new block to the athlete's own library")
    res = coach_sync("publish", "--athlete", SLUG, "--program", path, root=root)
    check(res.returncode != 0 and "already in the athlete's library" in res.stderr,
          "and refuses to publish the same block twice")
    check(call("GET", "/rest/v1/programs?select=id", bearer=coach["token"]) == [],
          "none of it appears in the coach's own library")
finally:
    for user in users:
        call("DELETE", f"/auth/v1/admin/users/{user['id']}", key=SECRET)

print("coach sync flow passed")
