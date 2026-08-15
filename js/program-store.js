(function (root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  root.TPPrograms = exported.createProgramStore({
    auth: root.TPAuth,
    storage: root.localStorage,
    randomUUID: root.crypto && root.crypto.randomUUID
      ? root.crypto.randomUUID.bind(root.crypto) : null
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIVE_KEY = "tp_active_program_v1";
  const COLUMNS = "id,title,schema_version,program_version,payload,revision,updated_at";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function validProgram(program) {
    return !!(program && typeof program === "object" && program.meta &&
      Array.isArray(program.exercises));
  }

  function safeActive(storage) {
    try {
      const value = JSON.parse(storage && storage.getItem(ACTIVE_KEY) || "null");
      if (!value || typeof value !== "object") return null;
      if (!text(value.id)) return null;
      return {
        id: text(value.id),
        revision: Math.max(0, Number(value.revision) || 0),
        pending: !!value.pending
      };
    } catch (_) {
      return null;
    }
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
    return text(error && error.message) || fallback || "Programme request failed.";
  }

  function fallbackUUID() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error("This browser cannot create a secure programme identifier.");
  }

  function normalizeRow(row) {
    if (!row || !text(row.id) || !validProgram(row.payload)) return null;
    const version = Number(row.program_version);
    const revision = Number(row.revision);
    const meta = row.payload.meta || {};
    return {
      id: text(row.id),
      title: text(row.title) || text(meta.block) || "Untitled programme",
      schemaVersion: text(row.schema_version || meta.schema),
      programVersion: Number.isFinite(version) && version > 0 ? Math.floor(version) : 0,
      revision: Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 1,
      updatedAt: text(row.updated_at),
      athlete: text(meta.athlete),
      weeks: Math.max(1, Number(meta.weeks) || 1),
      payload: row.payload
    };
  }

  function createProgramStore(deps) {
    deps = deps || {};
    const auth = deps.auth;
    const storage = deps.storage;
    const listeners = new Set();
    const uuid = deps.randomUUID || fallbackUUID;
    let options = {};
    let active = safeActive(storage);
    let rows = [];
    let unsubscribe = null;
    let initialized = false;
    let run = null;
    let state = { status: "idle", error: null };

    function publicState() {
      return {
        status: state.status,
        error: state.error ? { ...state.error } : null,
        activeId: active && active.id || "",
        pending: !!(active && active.pending),
        items: rows.map(row => ({
          id: row.id,
          title: row.title,
          schemaVersion: row.schemaVersion,
          programVersion: row.programVersion,
          revision: row.revision,
          updatedAt: row.updatedAt,
          athlete: row.athlete,
          weeks: row.weeks,
          active: !!(active && active.id === row.id),
          current: !!(active && active.id === row.id && !active.pending && active.revision === row.revision)
        }))
      };
    }

    function emit(next) {
      state = { ...state, ...(next || {}) };
      const snapshot = publicState();
      listeners.forEach(listener => {
        try { listener(snapshot); } catch (_) {}
      });
    }

    function writeActive(next) {
      active = next;
      try {
        if (storage) {
          if (next) storage.setItem(ACTIVE_KEY, JSON.stringify(next));
          else storage.removeItem(ACTIVE_KEY);
        }
      } catch (_) {}
    }

    function authState() {
      return auth && auth.getState ? auth.getState() : { status: "unavailable" };
    }

    function client() {
      return auth && auth._client;
    }

    function recordFor(id, program) {
      const meta = program.meta || {};
      const rawVersion = Number(meta.version);
      return {
        id,
        title: text(meta.block) || "Untitled programme",
        schema_version: text(meta.schema),
        program_version: Number.isFinite(rawVersion) && rawVersion > 0 ? Math.floor(rawVersion) : 0,
        payload: program
      };
    }

    async function findRemote(id) {
      const result = await client().from("programs").select(COLUMNS)
        .eq("id", id).is("deleted_at", null).maybeSingle();
      if (result.error) throw result.error;
      return normalizeRow(result.data);
    }

    async function insertRemote(id, program) {
      const result = await client().from("programs").insert(recordFor(id, program))
        .select(COLUMNS).single();
      if (result.error) {
        if (String(result.error.code || "") === "23505") {
          const existing = await findRemote(id);
          if (existing) return existing;
        }
        throw result.error;
      }
      const row = normalizeRow(result.data);
      if (!row) throw new Error("The programme service returned an invalid record.");
      return row;
    }

    function addRow(row) {
      rows = [row, ...rows.filter(item => item.id !== row.id)];
      rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    async function savePending(program) {
      if (!active || !active.id || !active.pending) return null;
      if (authState().status !== "authenticated" || !client()) return null;
      try {
        const row = await insertRemote(active.id, program);
        writeActive({ id: row.id, revision: row.revision, pending: false });
        addRow(row);
        emit({ status: "ready", error: null });
        return row;
      } catch (error) {
        if (!isNetworkError(error)) writeActive(null);
        emit({ status: isNetworkError(error) ? "offline" : "error",
          error: { message: messageFor(error, "Cloud backup failed.") } });
        return null;
      }
    }

    async function performRefresh() {
      if (authState().status !== "authenticated" || !client()) return publicState();
      emit({ status: "loading", error: null });
      const cached = options.getCachedProgram && options.getCachedProgram();
      if (active && active.pending) {
        if (validProgram(cached)) await savePending(cached);
        else writeActive(null);
      }
      try {
        const result = await client().from("programs").select(COLUMNS)
          .is("deleted_at", null).order("updated_at", { ascending: false });
        if (result.error) throw result.error;
        rows = (Array.isArray(result.data) ? result.data : []).map(normalizeRow).filter(Boolean);
        emit({ status: "ready", error: null });
      } catch (error) {
        emit({ status: isNetworkError(error) ? "offline" : "error",
          error: { message: messageFor(error, "Could not load the programme library.") } });
      }
      return publicState();
    }

    function refresh() {
      if (run) return run;
      run = performRefresh().finally(() => { run = null; });
      return run;
    }

    function handleAuth(next) {
      const status = next && next.status;
      if (status === "authenticated") { refresh(); return; }
      if (status === "offline-owner" || status === "unavailable") {
        emit({ status: "offline", error: next && next.error || null });
        return;
      }
      rows = [];
      emit({ status: status === "loading" ? "loading" : "idle", error: null });
    }

    function beginLocal(program, shouldActivate) {
      if (!validProgram(program)) throw new Error("Not a valid program.json (need meta + exercises).");
      const id = uuid();
      if (shouldActivate && options.onActivate) options.onActivate(program);
      writeActive({ id, revision: 0, pending: true });
      emit({ error: null });
      return id;
    }

    async function importProgram(program) {
      const id = beginLocal(program, true);
      if (authState().status !== "authenticated" || !client()) {
        emit({ status: "offline", error: null });
        return { ok: true, pending: true, id };
      }
      const row = await savePending(program);
      return row
        ? { ok: true, pending: false, id: row.id }
        : { ok: false, pending: !!(active && active.pending), id,
            error: publicState().error };
    }

    async function backUpCached() {
      const cached = options.getCachedProgram && options.getCachedProgram();
      const id = beginLocal(cached, false);
      if (authState().status !== "authenticated" || !client()) {
        emit({ status: "offline", error: null });
        return { ok: true, pending: true, id };
      }
      const row = await savePending(cached);
      return row ? { ok: true, pending: false, id: row.id }
        : { ok: false, pending: !!(active && active.pending), id, error: publicState().error };
    }

    function activate(id) {
      const row = rows.find(item => item.id === id);
      if (!row) return { ok: false, error: { message: "That programme is not available on this device." } };
      if (options.onActivate) options.onActivate(row.payload);
      writeActive({ id: row.id, revision: row.revision, pending: false });
      emit({ error: null });
      return { ok: true };
    }

    async function remove(id) {
      const row = rows.find(item => item.id === id);
      if (!row) return { ok: false, error: { message: "That programme is no longer in the library." } };
      if (authState().status !== "authenticated" || !client())
        return { ok: false, error: { message: "Reconnect before removing a cloud programme." } };
      try {
        const result = await client().from("programs")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row.id).eq("revision", row.revision)
          .select("id").maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) {
          await refresh();
          return { ok: false, error: { message: "This programme changed on another device. Review the library and try again." } };
        }
        rows = rows.filter(item => item.id !== row.id);
        if (active && active.id === row.id) {
          writeActive(null);
          if (options.onClearActive) options.onClearActive();
        }
        emit({ status: "ready", error: null });
        return { ok: true };
      } catch (error) {
        emit({ status: isNetworkError(error) ? "offline" : "error",
          error: { message: messageFor(error, "Could not remove the programme.") } });
        return { ok: false, error: publicState().error };
      }
    }

    function init(nextOptions) {
      options = { ...options, ...(nextOptions || {}) };
      if (initialized) { handleAuth(authState()); return; }
      initialized = true;
      if (auth && auth.subscribe) unsubscribe = auth.subscribe(handleAuth);
      else handleAuth({ status: "unavailable" });
    }

    return {
      init,
      refresh,
      importProgram,
      backUpCached,
      activate,
      remove,
      getState: publicState,
      subscribe(listener) {
        listeners.add(listener);
        listener(publicState());
        return () => listeners.delete(listener);
      },
      destroy() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        initialized = false;
      }
    };
  }

  return { createProgramStore, safeActive, normalizeRow, validProgram, isNetworkError, ACTIVE_KEY };
});
