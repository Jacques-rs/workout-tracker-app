(function (root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  root.TPSessions = exported.createSessionStore({
    auth: root.TPAuth,
    programs: root.TPPrograms,
    storage: root.localStorage,
    randomUUID: root.crypto && root.crypto.randomUUID
      ? root.crypto.randomUUID.bind(root.crypto) : null,
    setTimer: root.setTimeout ? root.setTimeout.bind(root) : null,
    clearTimer: root.clearTimeout ? root.clearTimeout.bind(root) : null
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const QUEUE_KEY = "tp_session_sync_v1";
  const PAGE_SIZE = 20;
  const COLUMNS = "id,program_id,conflict_of,session_date,day,week,schema_version," +
    "program_version,payload,revision,created_at,updated_at,deleted_at";
  const RETRY_DELAYS = [2000, 10000, 30000, 60000];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function validPayload(payload) {
    return !!(payload && typeof payload === "object" &&
      /^tp-session-[123]$/.test(text(payload.schema)) && text(payload.date) && text(payload.day));
  }

  function fallbackUUID() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    throw new Error("This browser cannot create a secure session identifier.");
  }

  function isNetworkError(error) {
    const message = text(error && error.message).toLowerCase();
    const code = text(error && error.code).toLowerCase();
    const status = Number(error && (error.status || error.statusCode));
    return code === "network_error" || code === "request_timeout" || status >= 500 ||
      message.includes("failed to fetch") || message.includes("network") ||
      message.includes("load failed") || message.includes("fetch failed") ||
      message.includes("timeout");
  }

  function safeQueue(storage) {
    try {
      const parsed = JSON.parse(storage && storage.getItem(QUEUE_KEY) || "null");
      const source = parsed && parsed.version === 1 && parsed.items &&
        typeof parsed.items === "object" ? parsed.items : {};
      const items = {};
      Object.entries(source).forEach(([key, item]) => {
        if (!item || !text(item.id) || !text(item.programId)) return;
        items[key] = {
          id: text(item.id),
          programId: text(item.programId),
          programReady: !!item.programReady,
          conflictOf: text(item.conflictOf) || null,
          revision: Math.max(0, Math.floor(Number(item.revision) || 0)),
          generation: Math.max(1, Math.floor(Number(item.generation) || 1)),
          dirty: !!item.dirty,
          payload: validPayload(item.payload) ? item.payload : null,
          updatedAt: text(item.updatedAt),
          lastError: item.lastError && typeof item.lastError === "object"
            ? { message: text(item.lastError.message), permanent: !!item.lastError.permanent } : null
        };
        if (items[key].dirty && !items[key].payload) delete items[key];
      });
      return items;
    } catch (_) {
      return {};
    }
  }

  function normalizeRow(row) {
    if (!row || !text(row.id) || !validPayload(row.payload)) return null;
    return {
      id: text(row.id),
      programId: text(row.program_id) || null,
      conflictOf: text(row.conflict_of) || null,
      date: text(row.session_date || row.payload.date),
      day: text(row.day || row.payload.day),
      week: Math.max(1, Math.floor(Number(row.week || row.payload.week) || 1)),
      schemaVersion: text(row.schema_version || row.payload.schema),
      programVersion: Math.max(0, Math.floor(Number(row.program_version || row.payload.programVersion) || 0)),
      payload: row.payload,
      revision: Math.max(1, Math.floor(Number(row.revision) || 1)),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      deletedAt: text(row.deleted_at) || null
    };
  }

  function comparablePayload(payload) {
    const value = clone(payload) || {};
    delete value.exportedAt;
    return JSON.stringify(value);
  }

  function samePayload(a, b) {
    return validPayload(a) && validPayload(b) && comparablePayload(a) === comparablePayload(b);
  }

  function summaryFor(id, payload, meta) {
    meta = meta || {};
    const entries = Array.isArray(payload && payload.entries) ? payload.entries : [];
    const done = entries.filter(entry => entry && entry.done).length;
    return {
      id,
      programId: text(meta.programId) || null,
      conflictOf: text(meta.conflictOf) || null,
      block: text(payload && payload.block) || "Unlinked programme",
      athlete: text(payload && payload.athlete),
      date: text(payload && payload.date),
      day: text(payload && payload.day),
      week: Math.max(1, Math.floor(Number(payload && payload.week) || 1)),
      completedExercises: done,
      totalExercises: entries.length,
      complete: !!entries.length && done === entries.length,
      syncState: meta.syncState || "synced",
      updatedAt: text(meta.updatedAt || payload && payload.exportedAt),
      detailAvailable: validPayload(payload)
    };
  }

  function createSessionStore(deps) {
    deps = deps || {};
    const auth = deps.auth;
    const programs = deps.programs;
    const storage = deps.storage;
    const uuid = deps.randomUUID || fallbackUUID;
    const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer || (timer => clearTimeout(timer));
    const listeners = new Set();
    let options = {};
    let queue = safeQueue(storage);
    let remoteRows = [];
    let localRows = new Map();
    let initialized = false;
    let unsubscribeAuth = null;
    let unsubscribePrograms = null;
    let drainRun = null;
    let refreshRun = null;
    let drainTimer = null;
    let retryTimer = null;
    let retryIndex = 0;
    let pageCount = 0;
    let hasMore = false;
    let state = { status: "idle", error: null, syncing: false, lastSyncedAt: "" };

    function authState() {
      return auth && auth.getState ? auth.getState() : { status: "unavailable" };
    }

    function client() {
      return auth && auth._client;
    }

    function persistQueue() {
      try {
        if (storage) storage.setItem(QUEUE_KEY, JSON.stringify({ version: 1, items: queue }));
        return true;
      } catch (_) {
        state = { ...state, status: "error", error: {
          message: "Workout saved on this device, but the cloud queue could not be updated. Free device storage and retry."
        }};
        return false;
      }
    }

    function payloadFor(id) {
      const remote = remoteRows.find(row => row.id === id);
      if (remote) return remote.payload;
      for (const [key, local] of localRows) {
        const item = queue[key];
        if (item && item.id === id) return item.payload || local.payload || null;
        if (local.id === id) return local.payload || null;
      }
      return null;
    }

    function historyItems() {
      const items = new Map();
      remoteRows.filter(row => !row.deletedAt).forEach(row => {
        items.set(row.id, summaryFor(row.id, row.payload, {
          programId: row.programId,
          conflictOf: row.conflictOf,
          syncState: row.conflictOf ? "conflict" : "synced",
          updatedAt: row.updatedAt
        }));
      });
      localRows.forEach((local, key) => {
        const item = queue[key];
        const payload = item && item.payload || local.payload;
        const id = item && item.id || local.id;
        const syncState = !local.programId ? "local-only"
          : item && item.conflictOf ? "conflict"
            : item && item.dirty ? "queued" : "synced";
        const summary = payload
          ? summaryFor(id, payload, {
              programId: local.programId || item && item.programId,
              conflictOf: item && item.conflictOf,
              syncState,
              updatedAt: item && item.updatedAt
            })
          : {
              id, programId: null, conflictOf: null,
              block: text(local.session && local.session.block) || "Unlinked programme",
              athlete: text(local.session && local.session.athlete),
              date: text(local.session && local.session.date),
              day: text(local.session && local.session.day),
              week: Math.max(1, Math.floor(Number(local.session && local.session.week) || 1)),
              completedExercises: 0, totalExercises: 0, complete: false,
              syncState: "local-only", updatedAt: "", detailAvailable: false
            };
        items.set(id, summary);
      });
      return Array.from(items.values()).sort((a, b) => {
        const date = String(b.date).localeCompare(String(a.date));
        return date || String(b.updatedAt).localeCompare(String(a.updatedAt));
      });
    }

    function publicState() {
      const items = historyItems();
      const pending = Object.values(queue).filter(item => item.dirty).length;
      return {
        status: state.status,
        error: state.error ? { ...state.error } : null,
        syncing: state.syncing,
        pending,
        conflicts: items.filter(item => item.syncState === "conflict").length,
        localOnly: items.filter(item => item.syncState === "local-only").length,
        lastSyncedAt: state.lastSyncedAt,
        hasMore,
        items: items.map(item => ({ ...item }))
      };
    }

    function emit(next) {
      state = { ...state, ...(next || {}) };
      const snapshot = publicState();
      listeners.forEach(listener => {
        try { listener(snapshot); } catch (_) {}
      });
    }

    function scanLocal(shouldQueue) {
      const found = new Map();
      let sessions = [];
      try {
        sessions = options.readLocalSessions ? options.readLocalSessions() : [];
      } catch (_) {}
      (Array.isArray(sessions) ? sessions : []).forEach(record => {
        if (!record || !text(record.key) || !record.session || typeof record.session !== "object") return;
        const resolved = programs && programs.resolveSessionProgram
          ? programs.resolveSessionProgram(record.session) : null;
        let payload = null;
        if (resolved && options.buildPayload) {
          try { payload = options.buildPayload(record.session, resolved.payload); } catch (_) {}
        }
        const key = text(record.key);
        const existing = queue[key];
        found.set(key, {
          id: existing && existing.id || `local:${key}`,
          session: record.session,
          programId: resolved && resolved.id || null,
          payload: validPayload(payload) ? payload : null
        });
        if (shouldQueue && resolved && validPayload(payload) && !existing) {
          stage(key, resolved.id, payload, false);
          const queued = queue[key];
          const staged = found.get(key);
          if (queued && staged) {
            staged.id = queued.id;
            staged.programId = queued.programId;
          }
        }
      });
      localRows = found;
      emit();
    }

    function stage(localKey, programId, payload, schedule = true) {
      localKey = text(localKey);
      programId = text(programId);
      if (!localKey || !programId || !validPayload(payload)) return false;
      const previous = queue[localKey];
      const sameProgram = !!(previous && previous.programId === programId);
      const programReady = !!(programs && programs.isRemoteAvailable &&
        programs.isRemoteAvailable(programId));
      queue[localKey] = {
        id: sameProgram ? previous.id : uuid(),
        programId,
        programReady: programReady || !!(sameProgram && previous.programReady),
        conflictOf: sameProgram ? previous.conflictOf : null,
        revision: sameProgram ? previous.revision : 0,
        generation: (previous && previous.generation || 0) + 1,
        dirty: true,
        payload: clone(payload),
        updatedAt: new Date().toISOString(),
        lastError: null
      };
      const local = localRows.get(localKey) || {};
      localRows.set(localKey, { ...local, id: queue[localKey].id, programId, payload: clone(payload) });
      const saved = persistQueue();
      emit({ error: saved ? null : state.error });
      if (schedule && saved) scheduleDrain(750);
      return saved;
    }

    function recordFor(item) {
      const payload = item.payload;
      return {
        id: item.id,
        program_id: item.programId,
        ...(item.conflictOf ? { conflict_of: item.conflictOf } : {}),
        session_date: payload.date,
        day: payload.day,
        week: Math.max(1, Math.floor(Number(payload.week) || 1)),
        schema_version: payload.schema,
        program_version: Math.max(0, Math.floor(Number(payload.programVersion) || 0)),
        payload
      };
    }

    async function findById(id) {
      const result = await client().from("session_logs").select(COLUMNS)
        .eq("id", id).maybeSingle();
      if (result.error) throw result.error;
      return normalizeRow(result.data);
    }

    async function findCanonical(item) {
      const payload = item.payload;
      const result = await client().from("session_logs").select(COLUMNS)
        .eq("program_id", item.programId).eq("session_date", payload.date)
        .eq("day", payload.day).is("conflict_of", null).is("deleted_at", null)
        .maybeSingle();
      if (result.error) throw result.error;
      return normalizeRow(result.data);
    }

    function forkConflict(localKey, canonicalId) {
      const current = queue[localKey];
      if (!current) return;
      current.id = uuid();
      current.conflictOf = text(canonicalId) || current.conflictOf || null;
      current.revision = 0;
      current.dirty = true;
      current.lastError = null;
      persistQueue();
    }

    async function insertItem(localKey, item) {
      const byId = await findById(item.id);
      if (byId) {
        if (samePayload(byId.payload, item.payload)) return byId;
        const current = queue[localKey];
        if (current) {
          current.revision = byId.revision;
          current.conflictOf = byId.conflictOf;
          persistQueue();
        }
        return null;
      }
      if (!item.conflictOf) {
        const canonical = await findCanonical(item);
        if (canonical) {
          if (samePayload(canonical.payload, item.payload)) return canonical;
          forkConflict(localKey, canonical.conflictOf || canonical.id);
          return null;
        }
      }
      const record = recordFor(item);
      const result = await client().from("session_logs").insert(record).select(COLUMNS).single();
      if (result.error) {
        if (text(result.error.code) === "23505") {
          const canonical = await findCanonical(item);
          if (canonical && samePayload(canonical.payload, item.payload)) return canonical;
          if (canonical) { forkConflict(localKey, canonical.id); return null; }
          const retry = await findById(item.id);
          if (retry) return retry;
        }
        throw result.error;
      }
      const row = normalizeRow(result.data);
      if (!row) throw new Error("The session service returned an invalid record.");
      return row;
    }

    async function updateItem(localKey, item) {
      const record = recordFor(item);
      delete record.id;
      const result = await client().from("session_logs").update(record)
        .eq("id", item.id).eq("revision", item.revision).is("deleted_at", null)
        .select(COLUMNS).maybeSingle();
      if (result.error) throw result.error;
      const row = normalizeRow(result.data);
      if (row) return row;
      const remote = await findById(item.id);
      if (!remote) {
        const current = queue[localKey];
        if (current) current.revision = 0;
        persistQueue();
        return null;
      }
      if (samePayload(remote.payload, item.payload)) return remote;
      forkConflict(localKey, remote.conflictOf || remote.id);
      return null;
    }

    function scheduleRetry() {
      if (retryTimer || authState().status !== "authenticated") return;
      const delay = RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)];
      retryIndex++;
      retryTimer = setTimer(() => {
        retryTimer = null;
        drain();
      }, delay);
    }

    async function performDrain() {
      if (authState().status !== "authenticated" || !client()) return publicState();
      emit({ syncing: true, error: null });
      const keys = Object.keys(queue);
      for (const localKey of keys) {
        const live = queue[localKey];
        if (!live || !live.dirty || !validPayload(live.payload)) continue;
        if (live.lastError && live.lastError.permanent) continue;
        if (!live.programReady && programs && programs.isRemoteAvailable &&
            programs.isRemoteAvailable(live.programId)) live.programReady = true;
        if (!live.revision && !live.programReady && programs && programs.isRemoteAvailable &&
            !programs.isRemoteAvailable(live.programId)) continue;
        const generation = live.generation;
        const snapshot = clone(live);
        try {
          let row = snapshot.revision > 0
            ? await updateItem(localKey, snapshot) : await insertItem(localKey, snapshot);
          const changedIdentity = queue[localKey] &&
            (queue[localKey].id !== snapshot.id || queue[localKey].revision !== snapshot.revision ||
             queue[localKey].conflictOf !== snapshot.conflictOf);
          if (!row && changedIdentity) {
            const retry = clone(queue[localKey]);
            row = retry.revision > 0
              ? await updateItem(localKey, retry) : await insertItem(localKey, retry);
          }
          if (!row) continue;
          const current = queue[localKey];
          if (!current) continue;
          current.id = row.id;
          current.programId = row.programId || current.programId;
          current.programReady = true;
          current.conflictOf = row.conflictOf;
          current.revision = row.revision;
          current.lastError = null;
          if (current.generation === generation) {
            current.dirty = false;
            current.payload = null;
          }
          remoteRows = [row, ...remoteRows.filter(item => item.id !== row.id)];
          persistQueue();
          retryIndex = 0;
          state.lastSyncedAt = new Date().toISOString();
        } catch (error) {
          const current = queue[localKey];
          const transient = isNetworkError(error);
          if (current) current.lastError = {
            message: transient ? "Connection interrupted; the workout remains queued."
              : text(error && error.message) || "This workout could not be synchronized.",
            permanent: !transient
          };
          persistQueue();
          emit({ status: transient ? "offline" : "error", error: current && current.lastError });
          if (transient) scheduleRetry();
          break;
        }
      }
      emit({ syncing: false,
        status: authState().status === "authenticated" && state.status !== "error" ? "ready" : state.status });
      return publicState();
    }

    function drain() {
      if (drainRun) return drainRun;
      drainRun = performDrain().finally(() => {
        drainRun = null;
        const runnable = Object.values(queue).some(item => item.dirty && !item.lastError &&
          (item.revision > 0 || item.programReady || !programs || !programs.isRemoteAvailable ||
           programs.isRemoteAvailable(item.programId)));
        if (runnable && authState().status === "authenticated") scheduleDrain(0);
      });
      return drainRun;
    }

    function scheduleDrain(delay) {
      if (drainTimer) clearTimer(drainTimer);
      drainTimer = setTimer(() => { drainTimer = null; drain(); }, delay == null ? 0 : delay);
    }

    async function fetchPage(reset) {
      if (authState().status !== "authenticated" || !client()) return publicState();
      const start = reset ? 0 : pageCount;
      emit({ status: reset ? "loading" : state.status, error: null });
      const result = await client().from("session_logs").select(COLUMNS)
        .is("deleted_at", null).order("session_date", { ascending: false })
        .order("updated_at", { ascending: false }).range(start, start + PAGE_SIZE - 1);
      if (result.error) throw result.error;
      const rows = (Array.isArray(result.data) ? result.data : []).map(normalizeRow).filter(Boolean);
      remoteRows = reset ? rows : [...remoteRows, ...rows.filter(row => !remoteRows.some(old => old.id === row.id))];
      pageCount = start + rows.length;
      hasMore = rows.length === PAGE_SIZE;
      emit({ status: "ready", error: null });
      return publicState();
    }

    async function performRefresh() {
      scanLocal(true);
      await drain();
      try {
        return await fetchPage(true);
      } catch (error) {
        const offline = isNetworkError(error);
        if (offline) remoteRows = [];
        emit({ status: offline ? "offline" : "error", syncing: false,
          error: { message: offline ? "Offline · cloud history will return when connected."
            : text(error && error.message) || "Could not load workout history." } });
        if (offline) scheduleRetry();
        return publicState();
      }
    }

    function refresh() {
      if (refreshRun) return refreshRun;
      refreshRun = performRefresh().finally(() => { refreshRun = null; });
      return refreshRun;
    }

    async function loadMore() {
      if (!hasMore) return publicState();
      try { return await fetchPage(false); }
      catch (error) {
        emit({ status: isNetworkError(error) ? "offline" : "error",
          error: { message: text(error && error.message) || "Could not load older workouts." } });
        return publicState();
      }
    }

    function retry() {
      Object.values(queue).forEach(item => { if (item.lastError) item.lastError = null; });
      persistQueue();
      retryIndex = 0;
      if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
      return refresh();
    }

    function handleAuth(next) {
      const status = next && next.status;
      if (status === "authenticated") { refresh(); return; }
      if (status === "offline-owner" || status === "unavailable") {
        remoteRows = [];
        scanLocal(false);
        emit({ status: "offline", syncing: false, error: next && next.error || null });
        return;
      }
      remoteRows = [];
      localRows = new Map();
      emit({ status: status === "loading" ? "loading" : "idle", syncing: false, error: null });
    }

    function handlePrograms(next) {
      if (!initialized) return;
      if (next && (next.status === "ready" || next.status === "offline")) {
        scanLocal(next.status === "ready");
        if (next.status === "ready") scheduleDrain(0);
      }
    }

    function init(nextOptions) {
      options = { ...options, ...(nextOptions || {}) };
      if (initialized) { handleAuth(authState()); return; }
      initialized = true;
      if (auth && auth.subscribe) unsubscribeAuth = auth.subscribe(handleAuth);
      else handleAuth({ status: "unavailable" });
      if (programs && programs.subscribe) unsubscribePrograms = programs.subscribe(handlePrograms);
    }

    return {
      init,
      stage,
      refresh,
      retry,
      loadMore,
      getPayload(id) { return clone(payloadFor(text(id))); },
      getState: publicState,
      subscribe(listener) {
        listeners.add(listener);
        listener(publicState());
        return () => listeners.delete(listener);
      },
      destroy() {
        if (unsubscribeAuth) unsubscribeAuth();
        if (unsubscribePrograms) unsubscribePrograms();
        if (drainTimer) clearTimer(drainTimer);
        if (retryTimer) clearTimer(retryTimer);
        unsubscribeAuth = null;
        unsubscribePrograms = null;
        initialized = false;
      }
    };
  }

  return { createSessionStore, safeQueue, normalizeRow, samePayload, summaryFor,
    validPayload, isNetworkError, QUEUE_KEY, PAGE_SIZE };
});
