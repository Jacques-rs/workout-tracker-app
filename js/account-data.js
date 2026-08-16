(function (root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) { module.exports = exported; return; }
  root.TPAccountData = exported.createAccountData({
    auth: root.TPAuth, storage: root.localStorage, document: root.document, location: root.location,
    now: () => new Date().toISOString()
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA = "tp-account-export-1";
  const PERSONAL_PREFIX = "tp_";
  const DEMO_PREFIX = "tp_demo_";

  function text(value) { return String(value == null ? "" : value).trim(); }
  function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function offlineError() { return new Error("Account export and deletion need an authenticated online session."); }

  function personalDeviceState(storage) {
    const sessions = [], queue = [];
    if (!storage) return { activeProgram: null, position: null, settings: null, sessions, syncQueue: queue };
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key || key.startsWith(DEMO_PREFIX)) continue;
      if (key === "tp_program_v1" || key === "tp_pos_v1" || key === "tp_settings_v1") continue;
      if (key.startsWith("tp_sess_v1::") || key === "tp_session_sync_v1") {
        try {
          const value = JSON.parse(storage.getItem(key) || "null");
          if (key.startsWith("tp_sess_v1::")) sessions.push({ key, value });
          else queue.push({ key, value });
        } catch (_) {}
      }
    }
    const read = key => { try { return JSON.parse(storage.getItem(key) || "null"); } catch (_) { return null; } };
    return { activeProgram: read("tp_program_v1"), position: read("tp_pos_v1"), settings: read("tp_settings_v1"),
      sessions, syncQueue: queue };
  }

  function clearPersonalDeviceState(storage) {
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && key.startsWith(PERSONAL_PREFIX) && !key.startsWith(DEMO_PREFIX)) keys.push(key);
    }
    keys.forEach(key => storage.removeItem(key));
  }

  function download(document, data) {
    const body = JSON.stringify(data, null, 2);
    if (!document || !document.createElement || typeof Blob === "undefined" || typeof URL === "undefined") return body;
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${SCHEMA}.json`;
    if (link.click) link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return body;
  }

  function createAccountData(deps) {
    const auth = deps.auth, storage = deps.storage;
    function ready() {
      const state = auth && auth.getState && auth.getState();
      return !!(state && state.status === "authenticated" && state.online !== false && auth.getSession && auth.getSession());
    }
    async function exportAccountData() {
      if (!ready()) throw offlineError();
      const client = auth._client;
      if (!client || !client.rpc) throw new Error("Account services are unavailable.");
      const result = await client.rpc("export_own_account");
      if (result.error) throw new Error(text(result.error.message) || "Could not export account data.");
      const cloud = result.data || {};
      const output = { schema: SCHEMA, exportedAt: deps.now(), account: copy(cloud.account || {}),
        programmes: copy(cloud.programmes || []), sessions: copy(cloud.sessions || []),
        device: personalDeviceState(storage) };
      download(deps.document, output);
      return output;
    }
    async function deleteAccount(password) {
      if (!ready()) throw offlineError();
      if (!text(password)) throw new Error("Enter your current password to delete the account.");
      const reauth = await auth.reauthenticate(password);
      if (!reauth || !reauth.ok) throw new Error(reauth && reauth.error && reauth.error.message || "Password confirmation failed.");
      const result = await auth._client.rpc("delete_own_account");
      if (result.error) throw new Error(text(result.error.message) || "Could not delete the account.");
      clearPersonalDeviceState(storage);
      if (auth.forgetInstallation) await auth.forgetInstallation();
      return { ok: true };
    }
    return { exportAccountData, deleteAccount, personalDeviceState, clearPersonalDeviceState, ready, SCHEMA };
  }
  return { createAccountData, personalDeviceState, clearPersonalDeviceState, SCHEMA };
});
