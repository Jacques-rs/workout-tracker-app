#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const account = require("../js/account-data.js");

const values = new Map(Object.entries({
  tp_program_v1: JSON.stringify({ meta: { schema: "tp-program-2" } }),
  tp_pos_v1: JSON.stringify({ week: 2 }), tp_settings_v1: JSON.stringify({ view: "focus" }),
  "tp_sess_v1::2026-08-16::Day 1": JSON.stringify({ private: "local-only" }),
  tp_session_sync_v1: JSON.stringify({ queued: true }), tp_supabase_auth_v1: "secret-token",
  tp_auth_owner_v1: JSON.stringify({ userId: "owner-marker" }),
  "tp_demo_sess_v1::2026-08-16::Day 1": JSON.stringify({ demo: true })
}));
const storage = { get length() { return values.size; }, key(i) { return [...values.keys()][i] || null; },
  getItem(k) { return values.has(k) ? values.get(k) : null; }, setItem(k, v) { values.set(k, String(v)); }, removeItem(k) { values.delete(k); } };
let rpcResult = { data: { account: { id: "user-one", email: "one@example.invalid" }, programmes: [{ id: "live" }, { id: "deleted", deletedAt: "2026-01-01" }], sessions: [{ id: "canonical" }, { id: "conflict", conflictOf: "canonical" }] } };
let reauth = { ok: true }, forgotten = 0;
const auth = { getState: () => ({ status: "authenticated", online: true }), getSession: () => ({ user: { id: "user-one" } }),
  reauthenticate: async () => reauth, forgetInstallation: async () => { forgotten++; },
  _client: { rpc: async name => { assert.ok(["export_own_account", "delete_own_account"].includes(name)); return rpcResult; } } };
const api = account.createAccountData({ auth, storage, now: () => "2026-08-16T00:00:00.000Z" });

(async () => {
  const output = await api.exportAccountData();
  assert.equal(output.schema, "tp-account-export-1");
  assert.equal(output.programmes.length, 2, "live and tombstoned programmes are portable");
  assert.equal(output.sessions.length, 2, "canonical and conflict sessions are portable");
  assert.equal(output.device.sessions.length, 1, "local-only sessions are included");
  assert.equal(output.device.syncQueue.length, 1, "dirty sync queue is included");
  assert.equal(JSON.stringify(output).includes("secret-token"), false, "tokens are excluded");
  assert.equal(JSON.stringify(output).includes("owner-marker"), false, "owner marker is excluded");
  assert.equal(JSON.stringify(output).includes('"demo"'), false, "demo namespace is excluded");

  rpcResult = { error: { message: "server rejected deletion" } };
  await assert.rejects(() => api.deleteAccount("password"));
  assert.ok(values.has("tp_program_v1"), "failed deletion keeps local data");
  rpcResult = { data: null };
  await api.deleteAccount("password");
  assert.equal(forgotten, 1, "successful deletion resets the auth installation");
  assert.equal([...values.keys()].some(key => key.startsWith("tp_") && !key.startsWith("tp_demo_")), false,
    "successful deletion clears all personal keys");
  assert.ok(values.has("tp_demo_sess_v1::2026-08-16::Day 1"), "successful deletion preserves demo data");
  console.log("Account export and deletion boundary tests passed.");
})().catch(error => { console.error(error); process.exit(1); });
