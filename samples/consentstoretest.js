/*
 * consentstoretest.js — the health-data consent store.
 *
 *   node samples/consentstoretest.js
 *
 * Consent decides whether the health fields are shown, so it has to hold offline in the
 * gym and never be lost. This checks the parts that are easy to get quietly wrong:
 *
 *   - a decision takes effect locally and synchronously, with no network
 *   - the latest decision by when it was made is the one in force, not the last to sync
 *   - decisions are appended and pushed once, and a retry after a dropped push is safe
 *   - the server's copy of a decision wins, since it may have clamped a fast phone clock
 *   - a signed-out or offline state never reaches the network
 *
 * The prompt, the gated fields and the Account panel are covered by apptest.js; the
 * table and the coach-side stripping by supabase/tests/database/health_consent.test.sql.
 */
"use strict";
const path = require("path");
const store = require(path.join(__dirname, "..", "js", "consent-store.js"));

let failures = 0;
function ok(message) { console.log("  ok   " + message); }
function fail(message) { console.error("  FAIL " + message); failures++; }
function assert(condition, message) { condition ? ok(message) : fail(message); }
function is(actual, expected, message) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  a === b ? ok(message) : fail(`${message}\n         expected ${b}\n         got      ${a}`);
}

console.log("\nthe decision in force");
{
  const d = (id, action, decidedAt) => ({ id, action, version: 1, decidedAt });
  is(store.latest([d("a", "given", "2026-10-01T00:00:00.000Z"),
    d("b", "withdrawn", "2026-10-03T00:00:00.000Z"),
    d("c", "given", "2026-10-02T00:00:00.000Z")]).id, "b",
  "the latest by when it was made wins, whatever order it arrived in");
  is(store.latest([d("a", "given", "2026-10-01T00:00:00.000Z"),
    d("b", "declined", "2026-10-01T00:00:00.000Z")]).id, "b",
  "an equal time breaks on the id, as the server does");
  is(store.latest([]), null, "no decision is null, not a refusal");
}

function harness(options) {
  options = options || {};
  const cells = new Map();
  const storage = {
    getItem: key => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => cells.set(key, String(value)),
    removeItem: key => cells.delete(key)
  };
  let rows = (options.rows || []).slice();
  const calls = { pull: 0, push: 0 };
  let nextError = null;
  const listeners = new Set();
  let authValue = options.auth || { status: "authenticated", user: { id: "user-1" } };
  let ids = 0, clock = options.now || "2026-10-28T07:00:00.000Z";
  const auth = {
    getState: () => authValue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    _client: {
      from(table) {
        if (table !== "health_consents") throw new Error("unexpected table " + table);
        return {
          async select() {
            calls.pull++;
            if (nextError) { const error = nextError; nextError = null; throw error; }
            return { data: rows.slice(), error: null };
          },
          async upsert(batch, opts) {
            calls.push++;
            if (!opts || opts.onConflict !== "id" || !opts.ignoreDuplicates)
              throw new Error("a retry must be idempotent");
            if (nextError) { const error = nextError; nextError = null; throw error; }
            batch.forEach(row => {
              if (rows.some(r => r.id === row.id)) return;
              rows.push({ ...row, decided_at: options.clamp ? options.clamp(row.decided_at) : row.decided_at });
            });
            return { data: null, error: null };
          }
        };
      }
    }
  };
  const changes = [];
  const created = store.createConsentStore({ auth, storage,
    randomUUID: () => "id-" + (++ids), now: () => clock });
  return {
    consent: created, calls, cells, changes,
    rows: () => rows,
    tick(next) { clock = next; },
    failNext(error) { nextError = error; },
    setAuth(next) { authValue = next; listeners.forEach(fn => fn(next)); },
    init() { created.init({ onChange: d => changes.push(d) }); return created; }
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
  console.log("\na decision holds offline, at once");
  {
    const h = harness({ auth: { status: "offline-owner", user: null } });
    h.init();
    const d = h.consent.decide("given", 1);
    is(d.action, "given", "decide() returns the decision");
    is(h.consent.current(), { action: "given", version: 1, decidedAt: "2026-10-28T07:00:00.000Z" },
      "and it is in force on this device straight away");
    is(h.changes.length, 1, "the app is told the decision changed");
    assert(h.consent.getState().pending, "it is queued for the account");
    is(h.calls, { pull: 0, push: 0 }, "and nothing touched the network");
    let threw = false;
    try { h.consent.decide("maybe", 1); } catch (_) { threw = true; }
    assert(threw, "only given, declined or withdrawn are decisions");
  }

  console.log("\nsigning in pushes the queue once and adopts the account's decisions");
  {
    const h = harness({ auth: { status: "guest", user: null },
      rows: [{ id: "remote-1", action: "given", consent_version: 1,
        decided_at: "2026-10-01T06:00:00+00:00" }] });
    h.init();
    h.tick("2026-10-20T06:00:00.000Z");
    h.consent.decide("withdrawn", 1);
    h.setAuth({ status: "authenticated", user: { id: "user-1" } });
    await settle();
    is(h.rows().length, 2, "the queued decision reaches the account");
    is(h.consent.current().action, "withdrawn", "the later local decision stays in force");
    assert(!h.consent.getState().pending, "nothing is left outstanding");
    is(h.consent.getState().status, "ready", "and the store is ready");
    const pushes = h.calls.push;
    await h.consent.sync();
    is(h.calls.push, pushes, "a settled queue costs no further write");
  }

  console.log("\na second device adopts what was decided on the first");
  {
    const h = harness({ rows: [{ id: "remote-1", action: "given", consent_version: 1,
      decided_at: "2026-10-01T06:00:00Z" }] });
    is(h.consent.current(), null, "before the first sync this device knows nothing");
    h.init();
    await settle();
    is(h.consent.current().action, "given", "after it, the account's decision is in force");
    is(h.changes.length, 1, "and the app is told so it can show the health fields");
  }

  console.log("\nthe server's copy wins for a decision both sides hold");
  {
    const h = harness({ now: "2099-01-01T00:00:00.000Z",
      clamp: () => "2026-10-28T07:00:00+00:00" });
    h.init();
    await settle();
    h.consent.decide("given", 1);
    await settle();
    await h.consent.sync();
    is(h.consent.current().decidedAt, "2026-10-28T07:00:00.000Z",
      "a decision dated by a phone clock running ahead takes the server's clamped time");
  }

  console.log("\na dropped push is retried and stored once");
  {
    const h = harness();
    h.init();
    await settle();
    h.failNext(Object.assign(new Error("Failed to fetch"), { code: "network_error" }));
    h.consent.decide("given", 1);
    await settle();
    is(h.consent.getState().status, "offline", "a dropped connection reads as offline");
    assert(h.consent.getState().pending, "the decision is still queued");
    is(h.consent.current().action, "given", "and still in force here");
    await h.consent.sync();
    await h.consent.sync();
    is(h.rows().length, 1, "the retry stores it exactly once");
    assert(!h.consent.getState().pending, "and clears the queue");
  }

  console.log("\nhand-edited storage is never trusted");
  {
    const h = harness({ auth: { status: "guest", user: null } });
    h.cells.set(store.LOCAL_KEY, JSON.stringify({ decisions: [
      { id: "x", action: "given", version: 0, decidedAt: "2026-10-01T00:00:00.000Z" },
      { id: "", action: "given", version: 1, decidedAt: "2026-10-01T00:00:00.000Z" },
      { id: "y", action: "sure", version: 1, decidedAt: "2026-10-01T00:00:00.000Z" }] }));
    is(h.consent.current(), null, "a malformed decision is ignored, never read as consent");
    h.cells.set(store.LOCAL_KEY, "{not json");
    is(h.consent.current(), null, "and a corrupt record reads as no decision");
  }

  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
})();
