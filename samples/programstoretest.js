#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { createProgramStore, sessionMatches, ACTIVE_KEY } = require("../js/program-store.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function programme(title, version = 1) {
  return {
    meta: { block: title, athlete: "Test Athlete", weeks: 4, version, schema: "tp-program-2" },
    exercises: []
  };
}

function remoteRow(id, payload, revision = 1) {
  return {
    id,
    title: payload.meta.block,
    schema_version: payload.meta.schema,
    program_version: payload.meta.version,
    payload,
    revision,
    updated_at: `2026-08-15T00:00:0${revision}.000Z`,
    deleted_at: null
  };
}

function fakeClient(seed) {
  const rows = seed.slice();
  let offline = false;

  class Query {
    constructor() { this.operation = "select"; this.value = null; this.filters = []; }
    select() { return this; }
    insert(value) { this.operation = "insert"; this.value = value; return this; }
    update(value) { this.operation = "update"; this.value = value; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    is(key, value) { this.filters.push(row => row[key] === value); return this; }
    order() { return this; }
    matching() { return rows.filter(row => this.filters.every(filter => filter(row))); }
    execute(one) {
      if (offline) return Promise.resolve({ data: null, error: { code: "network_error", message: "Failed to fetch" } });
      if (this.operation === "insert") {
        if (rows.some(row => row.id === this.value.id))
          return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
        const row = remoteRow(this.value.id, this.value.payload);
        rows.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (this.operation === "update") {
        const hit = this.matching()[0] || null;
        if (hit) Object.assign(hit, this.value, { revision: hit.revision + 1 });
        return Promise.resolve({ data: hit ? { id: hit.id } : null, error: null });
      }
      const found = this.matching().filter(row => !row.deleted_at);
      return Promise.resolve({ data: one ? found[0] || null : found, error: null });
    }
    single() { return this.execute(true); }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  }

  return {
    rows,
    setOffline(value) { offline = value; },
    from(table) { assert.equal(table, "programs"); return new Query(); }
  };
}

function fakeAuth(client) {
  let state = { status: "guest", user: null };
  const listeners = new Set();
  return {
    _client: client,
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    setStatus(status) { state = { ...state, status }; listeners.forEach(listener => listener(state)); }
  };
}

(async function () {
  const firstId = "10000000-0000-4000-8000-000000000001";
  const importedId = "10000000-0000-4000-8000-000000000002";
  const offlineId = "10000000-0000-4000-8000-000000000003";
  const first = programme("Existing cloud block", 2);
  const client = fakeClient([remoteRow(firstId, first)]);
  const auth = fakeAuth(client);
  const storage = memoryStorage();
  let cached = null;
  const activations = [];
  let clears = 0;
  const ids = [importedId, offlineId];
  const store = createProgramStore({ auth, storage, randomUUID: () => ids.shift() });
  store.init({
    getCachedProgram: () => cached,
    onActivate(program) { cached = program; activations.push(program.meta.block); },
    onClearActive() { cached = null; clears++; }
  });

  console.log("\nprivate programme library reads");
  assert.equal(store.getState().status, "idle", "a guest never opens the private library");
  auth.setStatus("authenticated");
  await store.refresh();
  assert.deepEqual(store.getState().items.map(item => item.title), ["Existing cloud block"]);
  assert.equal(store.getState().items[0].programVersion, 2);
  assert.deepEqual(store.getActiveIdentity(), null, "no cloud identity is invented before activation");

  console.log("\nimport is local first and then backed up");
  const imported = programme("Imported block", 3);
  const importResult = await store.importProgram(imported);
  assert.deepEqual(importResult, { ok: true, pending: false, id: importedId });
  assert.equal(cached, imported, "the imported payload is active in the device cache");
  assert.equal(client.rows.find(row => row.id === importedId).payload, imported, "the contract payload is stored unchanged");
  assert.deepEqual(JSON.parse(storage.getItem(ACTIVE_KEY)), { id: importedId, revision: 1, pending: false });
  assert.equal(store.getState().items.find(item => item.id === importedId).active, true);
  assert.equal(store.getState().items.find(item => item.id === importedId).current, true);
  assert.deepEqual(store.getActiveIdentity(), { id: importedId, revision: 1, pending: false },
    "session sync can read the stable active programme identity");

  console.log("\nactivation uses a fetched payload without another network write");
  const activated = store.activate(firstId);
  assert.equal(activated.ok, true);
  assert.equal(cached, first);
  assert.deepEqual(activations, ["Imported block", "Existing cloud block"]);
  assert.equal(store.getState().activeId, firstId);

  console.log("\noffline import queues one stable remote identity");
  client.setOffline(true);
  auth.setStatus("offline-owner");
  const queued = programme("Offline block", 1);
  const queuedResult = await store.importProgram(queued);
  assert.deepEqual(queuedResult, { ok: true, pending: true, id: offlineId });
  assert.equal(cached, queued, "offline import still replaces the active device cache immediately");
  assert.equal(store.getState().pending, true);
  assert.equal(client.rows.some(row => row.id === offlineId), false);

  client.setOffline(false);
  auth.setStatus("authenticated");
  await store.refresh();
  assert.equal(client.rows.filter(row => row.id === offlineId).length, 1, "reconnect retries with the same UUID once");
  assert.equal(store.getState().pending, false);
  assert.equal(store.getState().activeId, offlineId);

  console.log("\nremove is a revision-checked soft delete");
  const removed = await store.remove(offlineId);
  assert.equal(removed.ok, true);
  assert.ok(client.rows.find(row => row.id === offlineId).deleted_at, "the remote row is tombstoned, not hard-deleted");
  assert.equal(cached, null, "removing the active programme clears only the active device payload");
  assert.equal(clears, 1);
  assert.equal(store.getState().items.some(item => item.id === offlineId), false);

  console.log("\nlocal session programme matching");
  const matchable = programme("Matching block", 1);
  matchable.exercises = [{ id: "w1d1e1", week: 1, day: "Day 1" }];
  assert.equal(sessionMatches(matchable, { block: "Matching block", athlete: "Test Athlete",
    week: 1, day: "Day 1", entries: { w1d1e1: {} } }), true,
  "a stored session matches the programme that supplied its exercise ids");
  assert.equal(sessionMatches(matchable, { block: "Matching block", athlete: "Test Athlete",
    week: 1, day: "Day 1", entries: { another: {} } }), false,
  "an exercise-id mismatch blocks unsafe history backfill");

  console.log("\nall passed\n");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
