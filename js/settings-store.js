(function (root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  root.TPAccountSettings = exported.createSettingsStore({
    auth: root.TPAuth,
    storage: root.localStorage
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Account-scoped preferences: which optional fields the athlete tracks and what they
     call them. They follow the account to any device signed in on, because an athlete
     who tracks a tendon reading on one phone must not silently stop collecting it on
     another. Appearance and anything about where the athlete is standing stay on the
     device and never reach this module.

     Device-first, like everything else here: the local record is authoritative for
     rendering, written synchronously, and the remote is a merge partner rather than a
     source of truth. Nothing in a render or input handler makes a network call — the UI
     writes local and calls stage(), which schedules the push. */
  const LOCAL_KEY = "tp_account_settings_v1";
  const COLUMNS = "settings,field_updated_at,revision,updated_at";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function objectOf(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  /* A record is {values, at}: the preferences, and one ISO stamp per field beside them. */
  function recordOf(value) {
    const raw = objectOf(value);
    return { values: objectOf(raw.values), at: objectOf(raw.at) };
  }

  function isNetworkError(error) {
    const message = text(error && error.message).toLowerCase();
    const code = text(error && error.code).toLowerCase();
    return code === "network_error" || code === "request_timeout" ||
      message.includes("failed to fetch") || message.includes("network") ||
      message.includes("load failed") || message.includes("fetch failed");
  }

  function messageFor(error, fallback) {
    if (isNetworkError(error)) return "You appear to be offline.";
    return text(error && error.message) || fallback || "Settings request failed.";
  }

  /* LAST WRITE WINS, PER FIELD. A tracked-fields change made offline on two devices is
     not worth a conflict copy — unlike a workout, nothing is lost by resolving it, and
     the athlete can see and re-set it in one tap. Sides are considered in order, and the
     comparison is strictly greater, so an equal (or missing) stamp keeps the earlier
     side's value rather than flipping on every refresh. */
  function mergeRecords(/* ...records */) {
    const sides = Array.prototype.slice.call(arguments).filter(Boolean).map(recordOf);
    const out = { values: {}, at: {} };
    const keys = [];
    sides.forEach(side => Object.keys(side.values).forEach(key => {
      if (keys.indexOf(key) < 0) keys.push(key);
    }));
    keys.forEach(key => {
      let winner = null, stamp = "";
      sides.forEach(side => {
        if (!Object.prototype.hasOwnProperty.call(side.values, key)) return;
        const candidate = text(side.at[key]);
        if (winner === null || candidate > stamp) { winner = side; stamp = candidate; }
      });
      if (winner === null) return;
      out.values[key] = winner.values[key];
      if (stamp) out.at[key] = stamp;
    });
    return out;
  }

  /* Does `mine` hold a field the other side does not have, or a newer one? That is what
     decides whether there is anything to push. */
  function hasNewer(mine, theirs) {
    const a = recordOf(mine), b = recordOf(theirs);
    return Object.keys(a.values).some(key => {
      if (!Object.prototype.hasOwnProperty.call(b.values, key)) return true;
      return text(a.at[key]) > text(b.at[key]);
    });
  }

  function sameRecord(a, b) {
    return JSON.stringify(recordOf(a)) === JSON.stringify(recordOf(b));
  }

  function createSettingsStore(deps) {
    deps = deps || {};
    const auth = deps.auth;
    const storage = deps.storage;
    const listeners = new Set();
    let options = {};
    let initialized = false;
    let unsubscribe = null;
    let run = null;
    let pending = false;
    let state = { status: "idle", error: null };

    function readLocal() {
      try {
        return recordOf(JSON.parse(storage && storage.getItem(LOCAL_KEY) || "null"));
      } catch (_) {
        return recordOf(null);
      }
    }

    function writeLocal(record) {
      try {
        if (storage) storage.setItem(LOCAL_KEY, JSON.stringify(recordOf(record)));
      } catch (_) {}
    }

    function publicState() {
      return {
        status: state.status,
        error: state.error ? { ...state.error } : null,
        pending: pending
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

    function ownerId() {
      const current = authState();
      return text(current.user && current.user.id);
    }

    async function pull() {
      const result = await client().from("user_settings").select(COLUMNS).maybeSingle();
      if (result.error) throw result.error;
      const row = result.data;
      if (!row) return null;
      return { values: objectOf(row.settings), at: objectOf(row.field_updated_at) };
    }

    /* Insert-or-update by primary key. The owner id is sent explicitly because the
       conflict target needs it; RLS still refuses any other value. */
    async function push(record) {
      const owner = ownerId();
      if (!owner) throw new Error("Sign in to save your tracked fields.");
      const result = await client().from("user_settings").upsert({
        owner_id: owner,
        settings: recordOf(record).values,
        field_updated_at: recordOf(record).at
      }, { onConflict: "owner_id" }).select(COLUMNS).maybeSingle();
      if (result.error) throw result.error;
      return result.data
        ? { values: objectOf(result.data.settings), at: objectOf(result.data.field_updated_at) }
        : recordOf(record);
    }

    async function performSync() {
      if (authState().status !== "authenticated" || !client()) return publicState();
      emit({ status: "loading", error: null });
      const mine = readLocal();
      try {
        const theirs = await pull();
        const merged = mergeRecords(mine, theirs);
        /* Adopt first, so a second device shows the athlete's real choices even if the
           push below fails. */
        if (!sameRecord(merged, mine)) {
          writeLocal(merged);
          if (options.onMerged) options.onMerged(merged);
        }
        if (hasNewer(merged, theirs)) await push(merged);
        pending = false;
        emit({ status: "ready", error: null });
      } catch (error) {
        /* Offline is not a failure: the local record is authoritative for rendering and
           the push is retried on the next auth change or explicit sync. */
        pending = true;
        emit({
          status: isNetworkError(error) ? "offline" : "error",
          error: { message: messageFor(error, "Could not sync your tracked fields.") }
        });
      }
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
      /* The read model the app renders from. Local, synchronous, always available. */
      read: readLocal,
      /* The UI has already written the athlete's change into the local record; this
         schedules the remote half. Synchronous by contract — a keystroke never waits on
         the network, and an offline call simply leaves `pending` true. */
      stage(record) {
        if (record) writeLocal(record);
        pending = true;
        emit({ error: null });
        if (authState().status === "authenticated" && client()) {
          Promise.resolve().then(sync).catch(() => {});
        }
        return publicState();
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

  return { createSettingsStore, mergeRecords, hasNewer, recordOf };
});
