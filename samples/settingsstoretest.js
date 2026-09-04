/*
 * settingsstoretest.js — the account-scoped settings store.
 *
 *   node samples/settingsstoretest.js
 *
 * Which optional fields the athlete tracks, and what they call them, follow the ACCOUNT
 * rather than the device. This checks the parts that are easy to get quietly wrong:
 *
 *   - last write wins PER FIELD, both directions, with a missing stamp losing
 *   - the local record is authoritative for rendering and written synchronously
 *   - a merge from another device is adopted rather than ignored
 *   - offline is not a failure: the change is kept and the push is retried
 *   - a signed-out or guest state never reaches the network
 *
 * Rendering and the device/account split inside the app are covered by apptest.js.
 */
"use strict";
const path = require("path");
const store = require(path.join(__dirname, "..", "js", "settings-store.js"));

let failures = 0;
function ok(message) { console.log("  ok   " + message); }
function fail(message) { console.error("  FAIL " + message); failures++; }
function assert(condition, message) { condition ? ok(message) : fail(message); }
function is(actual, expected, message) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  a === b ? ok(message) : fail(`${message}\n         expected ${b}\n         got      ${a}`);
}

/* ---------- merge arithmetic, on its own ---------- */
console.log("\nlast write wins, per field");
{
  const mine = { values: { painOnWaking: true, painLabel: "Knee" },
    at: { painOnWaking: "2026-09-01T06:00:00.000Z", painLabel: "2026-09-03T06:00:00.000Z" } };
  const theirs = { values: { painOnWaking: false, painLabel: "Achilles", sleep: false },
    at: { painOnWaking: "2026-09-02T06:00:00.000Z", painLabel: "2026-09-02T06:00:00.000Z",
      sleep: "2026-09-02T06:00:00.000Z" } };
  const merged = store.mergeRecords(mine, theirs);
  is(merged.values.painOnWaking, false, "the newer remote value wins that field");
  is(merged.values.painLabel, "Knee", "and the newer local value wins its own");
  is(merged.values.sleep, false, "a field only the other side has is adopted");
  is(merged.at.painOnWaking, "2026-09-02T06:00:00.000Z", "the winning stamp comes with it");
  /* Field-by-field, not record-by-record: this is the whole point of the rule. A
     tracked-fields change made offline on two devices is not worth a conflict copy. */
  is(Object.keys(merged.values).sort(), ["painLabel", "painOnWaking", "sleep"],
    "every field from both sides survives the merge");

  const unstamped = { values: { readiness: false }, at: {} };
  const stamped = { values: { readiness: true }, at: { readiness: "2020-01-01T00:00:00.000Z" } };
  is(store.mergeRecords(unstamped, stamped).values.readiness, true,
    "a stamped value beats an unstamped one, however old it is");
  is(store.mergeRecords(stamped, unstamped).values.readiness, true,
    "…in either argument order");

  /* An equal stamp keeps the first side, so a refresh cannot flip a value back and
     forward on every sync. */
  const tie = t => ({ values: { sleep: t }, at: { sleep: "2026-09-01T06:00:00.000Z" } });
  is(store.mergeRecords(tie(true), tie(false)).values.sleep, true,
    "an equal stamp keeps the device's own value rather than flipping each refresh");

  is(store.mergeRecords(null, null), { values: {}, at: {} }, "nothing merges to nothing");
  is(store.mergeRecords(mine, null).values, mine.values, "and a missing side is simply absent");
  /* Storage is hand-editable and survives builds; it must never be trusted. */
  is(store.recordOf("not an object"), { values: {}, at: {} }, "a corrupt record reads as empty");
  is(store.recordOf({ values: [], at: 7 }), { values: {}, at: {} },
    "…as does one whose halves are the wrong type");

  assert(store.hasNewer(mine, theirs), "a locally newer field is something to push");
  assert(!store.hasNewer(theirs, store.mergeRecords(mine, theirs)),
    "and a fully merged record has nothing left to push back");
  assert(store.hasNewer({ values: { x: 1 }, at: {} }, { values: {}, at: {} }),
    "a field the remote has never seen is also something to push");
}

/* ---------- the store, against a stubbed client ---------- */
function harness(options) {
  options = options || {};
  const cells = new Map();
  const storage = {
    getItem: key => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => cells.set(key, String(value)),
    removeItem: key => cells.delete(key)
  };
  let remote = options.remote === undefined ? null : options.remote;
  const calls = { pull: 0, push: 0 };
  let nextError = options.error || null;
  const listeners = new Set();
  let authValue = options.auth || { status: "authenticated",
    user: { id: "user-1", email: "one@example.invalid", verified: true } };
  const auth = {
    getState: () => authValue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    _client: {
      from(table) {
        if (table !== "user_settings") throw new Error("unexpected table " + table);
        return {
          select() {
            return {
              maybeSingle: async () => {
                calls.pull++;
                if (nextError) { const error = nextError; nextError = null; throw error; }
                return { data: remote, error: null };
              }
            };
          },
          upsert(row) {
            return {
              select() {
                return {
                  maybeSingle: async () => {
                    calls.push++;
                    if (nextError) { const error = nextError; nextError = null; throw error; }
                    if (row.owner_id !== "user-1") throw new Error("wrong owner");
                    remote = { settings: row.settings, field_updated_at: row.field_updated_at,
                      revision: 1, updated_at: "now" };
                    return { data: remote, error: null };
                  }
                };
              }
            };
          }
        };
      }
    }
  };
  const merged = [];
  const created = store.createSettingsStore({ auth, storage });
  return {
    settings: created, calls, storage, merged, cells,
    remoteRow: () => remote,
    setRemote(value) { remote = value; },
    failNext(error) { nextError = error; },
    setAuth(next) { authValue = next; listeners.forEach(fn => fn(next)); },
    init() { created.init({ onMerged: record => merged.push(record) }); return created; }
  };
}

(async () => {
  console.log("\nthe local record is authoritative and written synchronously");
  {
    const h = harness({ auth: { status: "guest", user: null } });
    h.init();
    const record = { values: { painOnWaking: false },
      at: { painOnWaking: "2026-09-01T06:00:00.000Z" } };
    const state = h.settings.stage(record);
    /* Synchronous by contract: a switch tap never waits on the network. */
    is(h.settings.read(), record, "stage() writes the local record straight away");
    assert(state.pending, "and reports the change as not yet synced");
    is(h.calls, { pull: 0, push: 0 }, "a guest never reaches the network at all");
  }

  console.log("\nsigning in merges both directions");
  {
    const h = harness({ remote: {
      settings: { painOnWaking: false, sleep: false },
      field_updated_at: { painOnWaking: "2026-09-05T06:00:00.000Z",
        sleep: "2026-09-05T06:00:00.000Z" },
      revision: 3, updated_at: "then" } });
    h.storage.setItem("tp_account_settings_v1", JSON.stringify({
      values: { painOnWaking: true, painLabel: "Achilles" },
      at: { painOnWaking: "2026-09-01T06:00:00.000Z", painLabel: "2026-09-06T06:00:00.000Z" } }));
    h.init();
    await h.settings.sync();
    const local = h.settings.read();
    is(local.values.painOnWaking, false, "the account's newer value reaches this device");
    is(local.values.painLabel, "Achilles", "this device's newer label reaches the account");
    is(local.values.sleep, false, "and a field only the account had is adopted");
    is(h.merged.length, 1, "the app is told once that the record changed");
    is(h.merged[0].values.painLabel, "Achilles", "with the merged values");
    is(h.remoteRow().settings.painLabel, "Achilles",
      "and the merge is pushed back, so a third device sees it too");
    is(h.settings.getState().status, "ready", "…leaving the store ready");
    assert(!h.settings.getState().pending, "with nothing outstanding");
  }

  console.log("\na remote record that is already current is not pushed back");
  {
    const h = harness({ remote: {
      settings: { sleep: false }, field_updated_at: { sleep: "2026-09-05T06:00:00.000Z" },
      revision: 1, updated_at: "then" } });
    h.storage.setItem("tp_account_settings_v1", JSON.stringify({
      values: { sleep: false }, at: { sleep: "2026-09-05T06:00:00.000Z" } }));
    h.init();
    await h.settings.sync();
    is(h.calls.push, 0, "an unchanged record costs no write");
    is(h.merged.length, 0, "and the app is not told about a change that did not happen");
  }

  console.log("\noffline is not a failure");
  {
    const h = harness({ remote: null });
    h.init();
    /* Let the sign-in sync settle first, so the injected failure lands on the push this
       block is actually about rather than on that one. */
    await h.settings.sync();
    h.failNext(Object.assign(new Error("Failed to fetch"), { code: "network_error" }));
    h.settings.stage({ values: { readiness: false },
      at: { readiness: "2026-09-01T06:00:00.000Z" } });
    /* stage() schedules the push itself — a switch tap does not wait for it, and neither
       does this test. Let that run settle before asking how it went. */
    await new Promise(resolve => setTimeout(resolve, 0));
    const state = h.settings.getState();
    is(state.status, "offline", "a dropped connection reads as offline, not as an error");
    is(state.error.message, "You appear to be offline.", "and says so plainly");
    assert(state.pending, "the change is still outstanding");
    is(h.settings.read().values.readiness, false,
      "but it is kept locally, so the athlete's choice is not lost");
    /* Retried on the next sync, without the athlete doing anything. */
    await h.settings.sync();
    is(h.settings.getState().status, "ready", "the next sync clears it");
    is(h.remoteRow().settings.readiness, false, "and the change reaches the account");
  }

  console.log("\nlosing the account never loses the local record");
  {
    const h = harness({ remote: null });
    h.init();
    h.settings.stage({ values: { bodyweight: false },
      at: { bodyweight: "2026-09-01T06:00:00.000Z" } });
    await h.settings.sync();
    h.setAuth({ status: "guest", user: null });
    is(h.settings.getState().status, "idle", "signing out leaves the store idle");
    is(h.settings.read().values.bodyweight, false,
      "and this device keeps rendering the athlete's own choices");
    const before = h.calls.pull;
    await h.settings.sync();
    is(h.calls.pull, before, "a signed-out sync makes no request");
  }

  console.log("\nan offline owner is offline, not broken");
  {
    const h = harness({ auth: { status: "offline-owner", user: null } });
    h.init();
    is(h.settings.getState().status, "offline",
      "a known owner with no network reads as offline");
    is(h.calls.pull, 0, "and nothing is attempted");
  }

  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
})();
