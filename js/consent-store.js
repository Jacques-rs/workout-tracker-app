(function (root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  root.TPConsent = exported.createConsentStore({
    auth: root.TPAuth,
    storage: root.localStorage,
    randomUUID: root.crypto && root.crypto.randomUUID
      ? root.crypto.randomUUID.bind(root.crypto) : null
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The athlete's decisions about health-data consent: given, declined or withdrawn, each
     under a consent version. Append-only on both sides — changing your mind is a new
     decision, and the latest one by when it was made is the one in force.

     Device-first: a decision is written locally and takes effect at once, offline in the
     gym included; the remote is a queue behind it. Nothing here gates logging — the app
     only hides the health fields while consent is not in force. */
  const LOCAL_KEY = "tp_health_consent_v1";
  const COLUMNS = "id,action,consent_version,decided_at";
  const ACTIONS = ["given", "declined", "withdrawn"];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function fallbackUUID() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error("This browser cannot create a secure identifier.");
  }

  function decisionOf(value) {
    const raw = value && typeof value === "object" ? value : {};
    const action = text(raw.action);
    const version = Math.floor(Number(raw.version));
    if (!text(raw.id) || ACTIONS.indexOf(action) < 0 || !(version > 0)) return null;
    return { id: text(raw.id), action, version, decidedAt: text(raw.decidedAt), synced: !!raw.synced };
  }

  /* Normalised to UTC ISO so local and server stamps compare as strings. */
  function iso(value) {
    const time = Date.parse(text(value));
    return isNaN(time) ? "" : new Date(time).toISOString();
  }

  /* The decision in force: the latest by when it was made, with the id as a stable
     tiebreak — the same order the server uses. */
  function latest(decisions) {
    let best = null;
    (decisions || []).forEach(d => {
      if (!d) return;
      if (!best || d.decidedAt > best.decidedAt ||
          (d.decidedAt === best.decidedAt && d.id > best.id)) best = d;
    });
    return best;
  }

  function isNetworkError(error) {
    const message = text(error && error.message).toLowerCase();
    const code = text(error && error.code).toLowerCase();
    return code === "network_error" || code === "request_timeout" ||
      message.includes("failed to fetch") || message.includes("network") ||
      message.includes("load failed") || message.includes("fetch failed");
  }

  function createConsentStore(deps) {
    deps = deps || {};
    const auth = deps.auth;
    const storage = deps.storage;
    const uuid = deps.randomUUID || fallbackUUID;
    const now = deps.now || (() => new Date().toISOString());
    const listeners = new Set();
    let options = {};
    let initialized = false;
    let unsubscribe = null;
    let run = null;
    let state = { status: "idle", error: null };

    function readLocal() {
      try {
        const raw = JSON.parse(storage && storage.getItem(LOCAL_KEY) || "null");
        return (raw && Array.isArray(raw.decisions) ? raw.decisions : []).map(decisionOf).filter(Boolean);
      } catch (_) {
        return [];
      }
    }

    function writeLocal(decisions) {
      try {
        if (storage) storage.setItem(LOCAL_KEY, JSON.stringify({ decisions }));
      } catch (_) {}
    }

    function publicState() {
      return {
        status: state.status,
        error: state.error ? { ...state.error } : null,
        pending: readLocal().some(d => !d.synced)
      };
    }

    function emit(next) {
      state = { ...state, ...(next || {}) };
      const snapshot = publicState();
      listeners.forEach(listener => {
        try { listener(snapshot); } catch (_) {}
      });
    }

    function authState() {
      return auth && auth.getState ? auth.getState() : { status: "unavailable" };
    }

    function client() {
      return auth && auth._client;
    }

    function changed(before) {
      const after = latest(readLocal());
      if (JSON.stringify(before) !== JSON.stringify(after) && options.onChange) {
        try { options.onChange(after); } catch (_) {}
      }
    }

    async function performSync() {
      if (authState().status !== "authenticated" || !client()) return publicState();
      emit({ status: "loading", error: null });
      const before = latest(readLocal());
      try {
        const pulled = await client().from("health_consents").select(COLUMNS);
        if (pulled.error) throw pulled.error;
        /* The server's copy wins for a decision both sides hold: it may have clamped a
           decision dated by a phone clock running ahead. */
        const byId = {};
        readLocal().forEach(d => { byId[d.id] = d; });
        (pulled.data || []).forEach(row => {
          const d = decisionOf({ id: row.id, action: row.action, version: row.consent_version,
            decidedAt: iso(row.decided_at), synced: true });
          if (d) byId[d.id] = d;
        });
        let decisions = Object.keys(byId).map(id => byId[id]);
        writeLocal(decisions);
        const unsent = decisions.filter(d => !d.synced);
        if (unsent.length) {
          const pushed = await client().from("health_consents").upsert(unsent.map(d => ({
            id: d.id, action: d.action, consent_version: d.version, decided_at: d.decidedAt
          })), { onConflict: "id", ignoreDuplicates: true });
          if (pushed.error) throw pushed.error;
          const sent = unsent.map(d => d.id);
          decisions = readLocal().map(d => sent.indexOf(d.id) >= 0 ? { ...d, synced: true } : d);
          writeLocal(decisions);
        }
        emit({ status: "ready", error: null });
      } catch (error) {
        /* Offline is not a failure: the decision already holds on this device and is
           pushed on the next auth change or explicit sync. */
        emit({
          status: isNetworkError(error) ? "offline" : "error",
          error: { message: isNetworkError(error) ? "You appear to be offline."
            : text(error && error.message) || "Could not sync your consent." }
        });
      }
      changed(before);
      return publicState();
    }

    function sync() {
      if (run) return run;
      run = performSync().finally(() => { run = null; });
      return run;
    }

    function handleAuth(next) {
      const status = next && next.status;
      if (status === "authenticated") { sync(); return; }
      if (status === "offline-owner" || status === "unavailable") {
        emit({ status: "offline", error: next && next.error || null });
        return;
      }
      emit({ status: status === "loading" ? "loading" : "idle", error: null });
    }

    return {
      init(nextOptions) {
        options = { ...options, ...(nextOptions || {}) };
        if (initialized) { handleAuth(authState()); return; }
        initialized = true;
        if (auth && auth.subscribe) unsubscribe = auth.subscribe(handleAuth);
        handleAuth(authState());
      },
      /* The decision in force on this device, or null. Local and synchronous. */
      current() {
        const d = latest(readLocal());
        return d ? { action: d.action, version: d.version, decidedAt: d.decidedAt } : null;
      },
      /* Records a decision locally, where it takes effect at once, and queues the push.
         Synchronous by contract: a tap never waits on the network. */
      decide(action, version) {
        const d = decisionOf({ id: uuid(), action, version, decidedAt: iso(now()), synced: false });
        if (!d) throw new Error("Unknown consent decision.");
        const before = latest(readLocal());
        writeLocal(readLocal().concat([d]));
        emit({ error: null });
        changed(before);
        if (authState().status === "authenticated" && client()) {
          Promise.resolve().then(sync).catch(() => {});
        }
        return { action: d.action, version: d.version, decidedAt: d.decidedAt };
      },
      sync,
      getState: publicState,
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        try { listener(publicState()); } catch (_) {}
        return () => listeners.delete(listener);
      },
      destroy() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        initialized = false;
      }
    };
  }

  return { createConsentStore, latest, LOCAL_KEY };
});
