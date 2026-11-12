#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createCoachStore, latestPerSession, normalizeSession, LIVE_MS, RETRY_MS, LIVE_DAYS } =
  require("../js/coach-store.js");

const ATHLETE = "00000000-0000-4000-8000-000000000002";

function payload(date, done, day = "Day 1 - Test") {
  return {
    schema: "tp-session-3", block: "Test block", athlete: "Test Athlete", athleteId: "test",
    programVersion: 1, week: 1, day, date, exportedAt: `${date}T10:00:00.000Z`,
    tracking: { perSetLogging: true }, session: { readiness: "Green" },
    entries: [{ exercise: "Squat", done, load: "80", reps: "5", rpe: "7", painDuring: "",
      notes: "", prescribed: { sets: "3", reps: "5", load: "", rpe: "" },
      sets: [{ set: 1, load: "80", reps: "5", rpe: "7", painDuring: "", note: "" }] }]
  };
}

function row(id, date, updatedAt, extra = {}) {
  return { id, program_id: "p1", conflict_of: null, session_date: date, day: "Day 1 - Test",
    week: 1, schema_version: "tp-session-3", program_version: 1,
    payload: payload(date, false), revision: 1, updated_at: updatedAt, ...extra };
}

function harness() {
  const calls = [];
  const timers = [];
  let offline = false;
  let authListener = null;
  let authStatus = "authenticated";
  const db = {
    links: [{ athlete_id: ATHLETE, email: "athlete@example.test", linked_at: "2026-10-01T00:00:00Z" }],
    programs: [{ id: "p1", title: "Block", program_version: 1, revision: 1,
      payload: { meta: { schema: "tp-program-2", athlete: "Test Athlete", weeks: 4 }, exercises: [] },
      updated_at: "2026-11-01T00:00:00Z" }],
    sessions: [row("s-old", "2026-11-02", "2026-11-02T10:00:00Z"),
               row("s-today", "2026-11-12", "2026-11-12T09:00:00Z")]
  };
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      if (offline) return Promise.resolve({ data: null, error: { message: "Failed to fetch" } });
      if (name === "coach_athletes_linked") return Promise.resolve({ data: db.links, error: null });
      if (name === "coach_programs") return Promise.resolve({ data: db.programs, error: null });
      if (name === "coach_session_logs") {
        const rows = db.sessions.filter(r => !args.since || r.session_date > args.since);
        return Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
    }
  };
  const auth = {
    _client: client,
    getState: () => ({ status: authStatus }),
    subscribe(listener) { authListener = listener; listener({ status: authStatus }); return () => {}; }
  };
  const clock = { now: new Date(2026, 10, 12, 10, 0, 0) };
  const store = createCoachStore({
    auth,
    now: () => new Date(clock.now.getTime()),
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: t => { if (t) t.live = false; }
  });
  return {
    store, db, calls, timers, clock,
    setOffline(v) { offline = v; },
    signOut() { authStatus = "guest"; authListener({ status: "guest" }); },
    pending: () => timers.filter(t => t.live),
    async fire() {
      const live = timers.filter(t => t.live);
      assert.equal(live.length, 1, "exactly one poll is scheduled");
      live[0].live = false;
      live[0].fn();
      await settle();
    }
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}

(async () => {
  await test("a linked account is a coach; the client list comes from the link-checked RPC", async () => {
    const h = harness();
    h.store.init();
    await settle();
    assert.equal(h.store.isCoach(), true);
    assert.deepEqual(h.store.getState().clients.map(c => c.id), [ATHLETE]);
    assert.equal(h.calls[0].name, "coach_athletes_linked");
  });

  await test("no link means no coach, and nothing is polled", async () => {
    const h = harness();
    h.db.links = [];
    h.store.init();
    await settle();
    assert.equal(h.store.isCoach(), false);
    assert.equal(h.store.watch(ATHLETE), false, "an unlinked athlete cannot be watched");
    assert.equal(h.pending().length, 0);
  });

  await test("watching reads everything once, then polls only recent dates", async () => {
    const h = harness();
    h.store.init();
    await settle();
    h.calls.length = 0;
    assert.equal(h.store.watch(ATHLETE), true);
    await settle();
    assert.deepEqual(h.calls.map(c => c.name).sort(), ["coach_programs", "coach_session_logs"]);
    assert.equal(h.calls.find(c => c.name === "coach_session_logs").args.since, null);
    const first = h.store.athlete(ATHLETE);
    assert.equal(first.status, "ready");
    assert.deepEqual(first.sessions.map(s => s.id), ["s-today", "s-old"], "newest first");
    assert.equal(h.pending()[0].ms, LIVE_MS);

    h.calls.length = 0;
    h.db.sessions[1] = row("s-today", "2026-11-12", "2026-11-12T09:05:00Z",
      { payload: payload("2026-11-12", true) });
    await h.fire();
    assert.deepEqual(h.calls.map(c => c.name), ["coach_session_logs"], "a live poll is one call");
    assert.equal(h.calls[0].args.since, `2026-11-${12 - LIVE_DAYS}`);
    const next = h.store.athlete(ATHLETE);
    assert.equal(next.sessions.find(s => s.id === "s-today").payload.entries[0].done, true,
      "the athlete's latest set reaches the coach");
    assert.ok(next.sessions.some(s => s.id === "s-old"), "older sessions survive a live poll");
  });

  await test("unwatching stops the poll; a stale timer never fires a read", async () => {
    const h = harness();
    h.store.init();
    await settle();
    h.store.watch(ATHLETE);
    await settle();
    const stale = h.pending()[0];
    h.store.unwatch();
    assert.equal(h.pending().length, 0);
    h.calls.length = 0;
    stale.fn();
    await settle();
    assert.equal(h.calls.length, 0);
  });

  await test("offline keeps what was read and backs off; reconnecting resumes", async () => {
    const h = harness();
    h.store.init();
    await settle();
    h.store.watch(ATHLETE);
    await settle();
    h.setOffline(true);
    await h.fire();
    const off = h.store.athlete(ATHLETE);
    assert.equal(off.status, "offline");
    assert.equal(off.sessions.length, 2, "nothing read is thrown away");
    assert.equal(h.pending()[0].ms, RETRY_MS);
    h.setOffline(false);
    await h.fire();
    assert.equal(h.store.athlete(ATHLETE).status, "ready");
    assert.equal(h.pending()[0].ms, LIVE_MS);
  });

  await test("signing out forgets every client and stops polling", async () => {
    const h = harness();
    h.store.init();
    await settle();
    h.store.watch(ATHLETE);
    await settle();
    h.signOut();
    assert.equal(h.store.isCoach(), false);
    assert.equal(h.store.getState().watching, null);
    assert.equal(h.store.athlete(ATHLETE).sessions.length, 0);
    assert.equal(h.pending().length, 0);
  });

  await test("a conflict copy written later is the one shown, once", async () => {
    const rows = [
      row("canon", "2026-11-12", "2026-11-12T09:00:00Z"),
      row("copy", "2026-11-12", "2026-11-12T09:30:00Z", { conflict_of: "canon" }),
      row("bad", "2026-11-12", "2026-11-12T09:40:00Z", { payload: { schema: "nope" } })
    ].map(normalizeSession).filter(Boolean);
    assert.deepEqual(latestPerSession(rows).map(r => r.id), ["copy"]);
  });

  await test("nothing about a client is written to device storage", async () => {
    const source = require("node:fs").readFileSync(require.resolve("../js/coach-store.js"), "utf8");
    assert.ok(!/localStorage|setItem|indexedDB/.test(source));
  });

  console.log("all passed");
})().catch(error => { console.error(error); process.exit(1); });
