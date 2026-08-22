#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createSessionStore, QUEUE_KEY } = require("../js/session-store.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function payload(note, date = "2026-08-16") {
  return {
    schema: "tp-session-3", block: "Test block", athlete: "Test Athlete",
    athleteId: "test-athlete", programVersion: 1, week: 1,
    day: "Day 1 - Test", date, exportedAt: `${date}T10:00:00.000Z`,
    tracking: { perSetLogging: true }, session: { overall: note },
    entries: [{ exercise: "Squat", done: true, load: "80", reps: "5", rpe: "7",
      painDuring: "", notes: note, prescribed: { sets: "1", reps: "5", load: "", rpe: "" }, sets: [] }]
  };
}

function serverRow(record, revision = 1) {
  return {
    ...record,
    conflict_of: record.conflict_of || null,
    revision,
    created_at: record.created_at || "2026-08-16T10:00:00.000Z",
    updated_at: `2026-08-16T10:00:0${Math.min(9, revision)}.000Z`,
    deleted_at: record.deleted_at || null
  };
}

function fakeClient(seed = []) {
  const rows = seed.map(row => ({ ...row }));
  let offline = false;
  let holdUpdate = false;
  let releaseUpdate = null;
  class Query {
    constructor() { this.operation = "select"; this.value = null; this.filters = []; this.bounds = null; }
    select() { return this; }
    insert(value) { this.operation = "insert"; this.value = value; return this; }
    update(value) { this.operation = "update"; this.value = value; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    is(key, value) { this.filters.push(row => row[key] === value); return this; }
    order() { return this; }
    range(from, to) { this.bounds = [from, to]; return this; }
    matching() { return rows.filter(row => this.filters.every(filter => filter(row))); }
    execute(one) {
      if (offline) return Promise.resolve({ data: null, error: { code: "network_error", message: "Failed to fetch" } });
      if (this.operation === "insert") {
        if (rows.some(row => row.id === this.value.id))
          return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate id" } });
        const canonical = !this.value.conflict_of && rows.some(row => !row.deleted_at && !row.conflict_of &&
          row.program_id === this.value.program_id && row.session_date === this.value.session_date && row.day === this.value.day);
        if (canonical) return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate canonical" } });
        const row = serverRow(this.value);
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (this.operation === "update") {
        const hit = this.matching()[0] || null;
        const finish = () => {
          if (hit) Object.assign(hit, this.value, serverRow({ ...hit, ...this.value }, hit.revision + 1));
          return { data: hit, error: null };
        };
        if (holdUpdate) {
          holdUpdate = false;
          return new Promise(resolve => { releaseUpdate = () => { releaseUpdate = null; resolve(finish()); }; });
        }
        return Promise.resolve(finish());
      }
      let found = this.matching().slice().sort((a, b) =>
        String(b.session_date).localeCompare(String(a.session_date)) ||
        String(b.updated_at).localeCompare(String(a.updated_at)));
      if (this.bounds) found = found.slice(this.bounds[0], this.bounds[1] + 1);
      return Promise.resolve({ data: one ? found[0] || null : found, error: null });
    }
    single() { return this.execute(true); }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  }
  return {
    rows,
    setOffline(value) { offline = value; },
    holdNextUpdate() { holdUpdate = true; },
    releaseUpdate() { if (releaseUpdate) releaseUpdate(); },
    from(table) { assert.equal(table, "session_logs"); return new Query(); }
  };
}

function fakeAuth(client, initial = "offline-owner") {
  let state = { status: initial, user: initial === "authenticated" ? { id: "user-one" } : null };
  const listeners = new Set();
  return {
    _client: client,
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    setStatus(status) {
      state = { status, user: status === "authenticated" ? { id: "user-one" } : null };
      listeners.forEach(listener => listener(state));
    }
  };
}

function fakePrograms(programId) {
  let ready = false;
  const listeners = new Set();
  const program = { meta: { block: "Test block", athlete: "Test Athlete", schema: "tp-program-2" }, exercises: [] };
  return {
    getActiveIdentity: () => ({ id: programId, revision: ready ? 1 : 0, pending: !ready }),
    isRemoteAvailable: id => ready && id === programId,
    resolveSessionProgram: session => session.block === "Test block"
      ? { id: programId, pending: !ready, payload: program } : null,
    subscribe(listener) { listeners.add(listener); listener({ status: ready ? "ready" : "offline" }); return () => listeners.delete(listener); },
    setReady(value) { ready = value; listeners.forEach(listener => listener({ status: ready ? "ready" : "offline" })); }
  };
}

(async function () {
  const programId = "10000000-0000-4000-8000-000000000001";
  const ids = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
    "20000000-0000-4000-8000-000000000004"
  ];
  const client = fakeClient();
  const auth = fakeAuth(client);
  const programs = fakePrograms(programId);
  const storage = memoryStorage();
  const timers = [];
  const local = [{ key: "tp_sess_v1::2026-08-16::Day 1 - Test",
    session: { block: "Test block", athlete: "Test Athlete", week: 1,
      day: "Day 1 - Test", date: "2026-08-16", session: {}, entries: {} } }];
  const store = createSessionStore({ auth, programs, storage,
    randomUUID: () => ids.shift(), setTimer(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer() {} });
  store.init({ readLocalSessions: () => local,
    buildPayload: session => payload(session.session.overall || "backfilled", session.date) });

  console.log("\nlocal-first queue and programme ordering");
  const key = local[0].key;
  assert.equal(store.stage(key, programId, payload("offline edit")), true);
  assert.equal(client.rows.length, 0, "staging performs no immediate network write");
  let saved = JSON.parse(storage.getItem(QUEUE_KEY));
  assert.equal(saved.items[key].dirty, true);
  assert.equal(saved.items[key].id, "20000000-0000-4000-8000-000000000001", "the queued UUID is durable");
  auth.setStatus("authenticated");
  await store.refresh();
  assert.equal(client.rows.length, 0, "a session waits for its pending programme foreign key");
  programs.setReady(true);
  await store.refresh();
  assert.equal(client.rows.length, 1, "reconnect uploads the queued snapshot");
  saved = JSON.parse(storage.getItem(QUEUE_KEY));
  assert.equal(saved.items[key].dirty, false);
  assert.equal(saved.items[key].revision, 1);
  assert.equal(saved.items[key].payload, null, "a clean mapping drops its duplicate queue payload");

  console.log("\nrevision update and recoverable conflict");
  store.stage(key, programId, payload("second edit"));
  await store.refresh();
  assert.equal(client.rows[0].revision, 2, "a current revision updates in place");
  client.rows[0].payload = payload("other device edit");
  client.rows[0].revision = 3;
  store.stage(key, programId, payload("stale local edit"));
  await store.refresh();
  assert.equal(client.rows.length, 2, "a stale local revision is preserved as another row");
  const conflict = client.rows.find(row => row.conflict_of === client.rows[0].id);
  assert.ok(conflict, "the preserved row points at the canonical session");
  assert.equal(conflict.payload.session.overall, "stale local edit");
  assert.equal(store.getState().conflicts, 1, "history reports the conflict copy honestly");

  console.log("\nnewer local generation survives an in-flight upload");
  client.holdNextUpdate();
  store.stage(key, programId, payload("first in-flight edit"));
  const inFlight = store.refresh();
  await new Promise(resolve => setImmediate(resolve));
  store.stage(key, programId, payload("newer in-flight edit"));
  client.releaseUpdate();
  await inFlight;
  saved = JSON.parse(storage.getItem(QUEUE_KEY));
  assert.equal(saved.items[key].dirty, true, "an older acknowledgement cannot clear a newer snapshot");
  await store.refresh();
  saved = JSON.parse(storage.getItem(QUEUE_KEY));
  assert.equal(saved.items[key].dirty, false);
  assert.equal(client.rows.find(row => row.id === saved.items[key].id).payload.session.overall,
    "newer in-flight edit", "the follow-up revision carries the newest local generation");

  console.log("\nuncertain insert acknowledgement cannot discard a newer edit");
  const uncertainId = "25000000-0000-4000-8000-000000000001";
  const uncertainClient = fakeClient([serverRow({ id: uncertainId, program_id: programId,
    session_date: "2026-08-17", day: "Day 1 - Test", week: 1,
    schema_version: "tp-session-3", program_version: 1, payload: payload("request reached server", "2026-08-17") })]);
  const uncertainAuth = fakeAuth(uncertainClient, "authenticated");
  const uncertainPrograms = fakePrograms(programId); uncertainPrograms.setReady(true);
  const uncertain = createSessionStore({ auth: uncertainAuth, programs: uncertainPrograms,
    storage: memoryStorage(), randomUUID: () => uncertainId,
    setTimer(fn, ms) { return { fn, ms }; }, clearTimer() {} });
  uncertain.init({ readLocalSessions: () => [], buildPayload: () => null });
  await uncertain.refresh();
  uncertain.stage("uncertain-key", programId, payload("edited after timeout", "2026-08-17"));
  await uncertain.refresh();
  assert.equal(uncertainClient.rows.length, 1, "the stable UUID is adopted rather than duplicated");
  assert.equal(uncertainClient.rows[0].revision, 2);
  assert.equal(uncertainClient.rows[0].payload.session.overall, "edited after timeout",
    "the newer local payload is revision-updated after the uncertain insert");

  console.log("\nnatural-key collision and idempotent adoption");
  const secondStorage = memoryStorage();
  const secondAuth = fakeAuth(client, "authenticated");
  const secondPrograms = fakePrograms(programId); secondPrograms.setReady(true);
  const second = createSessionStore({ auth: secondAuth, programs: secondPrograms, storage: secondStorage,
    randomUUID: () => "20000000-0000-4000-8000-000000000004",
    setTimer(fn, ms) { return { fn, ms }; }, clearTimer() {} });
  second.init({ readLocalSessions: () => [], buildPayload: () => null });
  await second.refresh();
  const otherKey = "tp_sess_v1::2026-08-16::Day 1 - Test";
  second.stage(otherKey, programId, payload("another device"));
  await second.refresh();
  assert.equal(client.rows.filter(row => row.conflict_of === client.rows[0].id).length, 2,
    "a second device cannot create a second canonical row");
  const before = client.rows.length;
  await second.refresh();
  assert.equal(client.rows.length, before, "retries adopt the stable inserted conflict id");

  console.log("\nbackfill and offline history boundary");
  const items = store.getState().items;
  assert.ok(items.some(item => item.date === "2026-08-16"), "an eligible local session appears in history");
  auth.setStatus("offline-owner");
  assert.ok(store.getState().items.every(item => !item.id.startsWith("remote-only")),
    "offline history is rebuilt from this installation only");
  assert.ok(store.getPayload(conflict.id), "readable detail remains available for the local conflict");

  console.log("\nprogramme identity changes cannot overwrite an older cloud session");
  const isolatedStorage = memoryStorage();
  const isolatedAuth = fakeAuth(fakeClient());
  const isolatedPrograms = fakePrograms(programId);
  const isolatedIds = ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"];
  const isolated = createSessionStore({ auth: isolatedAuth, programs: isolatedPrograms,
    storage: isolatedStorage, randomUUID: () => isolatedIds.shift(),
    setTimer(fn, ms) { return { fn, ms }; }, clearTimer() {} });
  isolated.stage("same-local-key", programId, payload("first programme"));
  isolated.stage("same-local-key", "10000000-0000-4000-8000-000000000099", payload("replacement programme"));
  const remapped = JSON.parse(isolatedStorage.getItem(QUEUE_KEY)).items["same-local-key"];
  assert.equal(remapped.id, "30000000-0000-4000-8000-000000000002");
  assert.equal(remapped.revision, 0, "a replacement programme receives a new session identity");
  assert.equal(remapped.conflictOf, null, "the new programme cannot inherit an old conflict chain");

  console.log("\nall passed\n");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
