(function (root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }

  root.TPCoach = exported.createCoachStore({
    auth: root.TPAuth,
    setTimer: root.setTimeout ? root.setTimeout.bind(root) : null,
    clearTimer: root.clearTimeout ? root.clearTimeout.bind(root) : null
  });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* The coach's read-only window onto linked athletes, and the browser's only caller of the
     coach_* functions — which check the link and the athlete's health-data consent
     themselves. Nothing here is written to device storage: another person's training and
     health readings live in memory for as long as the screen needs them. */
  const LIVE_MS = 10000;
  const FULL_MS = 5 * 60 * 1000;
  const RETRY_MS = 30000;
  /* The live poll re-reads only recent dates. Two days back covers a session dated in a
     time zone ahead of the coach's, and an edit to an older session arrives with the next
     full read. */
  const LIVE_DAYS = 2;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function localISO(date) {
    const z = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}`;
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

  function normalizeClient(row) {
    if (!row || !text(row.athlete_id)) return null;
    return { id: text(row.athlete_id), email: text(row.email), linkedAt: text(row.linked_at) };
  }

  function normalizeProgram(row) {
    if (!row || !text(row.id) || !row.payload || typeof row.payload !== "object") return null;
    return {
      id: text(row.id),
      title: text(row.title),
      version: Math.max(0, Math.floor(Number(row.program_version) || 0)),
      payload: row.payload,
      revision: Math.max(1, Math.floor(Number(row.revision) || 1)),
      updatedAt: text(row.updated_at)
    };
  }

  function normalizeSession(row) {
    const payload = row && row.payload;
    if (!row || !text(row.id) || !payload || typeof payload !== "object" ||
        !/^tp-session-[123]$/.test(text(payload.schema))) return null;
    return {
      id: text(row.id),
      programId: text(row.program_id) || null,
      conflictOf: text(row.conflict_of) || null,
      date: text(row.session_date || payload.date),
      day: text(row.day || payload.day),
      week: Math.max(1, Math.floor(Number(row.week || payload.week) || 1)),
      payload,
      updatedAt: text(row.updated_at)
    };
  }

  /* One row per programme/date/day. A device that lost a sync race keeps writing to its
     conflict copy, so the most recently written row is the one the athlete is looking at. */
  function latestPerSession(rows) {
    const byKey = new Map();
    rows.forEach(row => {
      const key = `${row.programId || ""}|${row.date}|${row.day}`;
      const held = byKey.get(key);
      if (!held || String(row.updatedAt).localeCompare(String(held.updatedAt)) > 0) byKey.set(key, row);
    });
    return Array.from(byKey.values()).sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function createCoachStore(deps) {
    deps = deps || {};
    const auth = deps.auth;
    const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer || (timer => clearTimeout(timer));
    const now = deps.now || (() => new Date());
    const listeners = new Set();
    let initialized = false;
    let unsubscribeAuth = null;
    let clients = [];
    let clientsStatus = "idle";
    let clientsError = null;
    let athletes = {};
    let watching = null;
    let timer = null;
    let generation = 0;
    let loadRun = null;

    function authState() {
      return auth && auth.getState ? auth.getState() : { status: "unavailable" };
    }

    function client() {
      return auth && auth._client;
    }

    function athleteState(id) {
      const held = athletes[id];
      return held ? {
        id,
        status: held.status,
        error: held.error ? { ...held.error } : null,
        programs: held.programs.slice(),
        sessions: held.sessions.slice(),
        checkedAt: held.checkedAt
      } : { id, status: "idle", error: null, programs: [], sessions: [], checkedAt: "" };
    }

    function publicState() {
      return {
        status: clientsStatus,
        error: clientsError ? { ...clientsError } : null,
        clients: clients.map(c => ({ ...c })),
        watching
      };
    }

    function emit() {
      const snapshot = publicState();
      listeners.forEach(listener => {
        try { listener(snapshot); } catch (_) {}
      });
    }

    async function rpc(name, args) {
      const result = await client().rpc(name, args || {});
      if (result.error) throw result.error;
      return Array.isArray(result.data) ? result.data : [];
    }

    function failure(error, fallback) {
      const offline = isNetworkError(error);
      return {
        status: offline ? "offline" : "error",
        error: { message: offline ? "Offline · showing what was last read."
          : text(error && error.message) || fallback }
      };
    }

    async function performLoadClients() {
      if (authState().status !== "authenticated" || !client()) return publicState();
      clientsStatus = clients.length ? clientsStatus : "loading";
      emit();
      try {
        clients = (await rpc("coach_athletes_linked")).map(normalizeClient).filter(Boolean);
        clientsStatus = "ready";
        clientsError = null;
        const ids = new Set(clients.map(c => c.id));
        Object.keys(athletes).forEach(id => { if (!ids.has(id)) delete athletes[id]; });
        if (watching && !ids.has(watching)) unwatch();
      } catch (error) {
        const failed = failure(error, "Could not load your clients.");
        clientsStatus = failed.status;
        clientsError = failed.error;
      }
      emit();
      return publicState();
    }

    function loadClients() {
      if (loadRun) return loadRun;
      loadRun = performLoadClients().finally(() => { loadRun = null; });
      return loadRun;
    }

    function held(id) {
      if (!athletes[id]) athletes[id] = {
        status: "loading", error: null, programs: [], sessions: [], checkedAt: "", fullAt: 0
      };
      return athletes[id];
    }

    async function read(id, full) {
      const run = generation;
      const entry = held(id);
      try {
        if (full) {
          const [programRows, sessionRows] = await Promise.all([
            rpc("coach_programs", { athlete: id }),
            rpc("coach_session_logs", { athlete: id, since: null })
          ]);
          if (run !== generation || !athletes[id]) return;
          entry.programs = programRows.map(normalizeProgram).filter(Boolean);
          entry.sessions = latestPerSession(sessionRows.map(normalizeSession).filter(Boolean));
          entry.fullAt = now().getTime();
        } else {
          const since = new Date(now().getTime());
          since.setDate(since.getDate() - LIVE_DAYS);
          const sinceISO = localISO(since);
          const rows = (await rpc("coach_session_logs", { athlete: id, since: sinceISO }))
            .map(normalizeSession).filter(Boolean);
          if (run !== generation || !athletes[id]) return;
          const older = entry.sessions.filter(row => row.date <= sinceISO);
          entry.sessions = latestPerSession(older.concat(
            entry.sessions.filter(row => row.date > sinceISO), rows));
        }
        entry.status = "ready";
        entry.error = null;
        entry.checkedAt = now().toISOString();
      } catch (error) {
        if (run !== generation || !athletes[id]) return;
        const failed = failure(error, "Could not read this client's training.");
        entry.status = failed.status;
        entry.error = failed.error;
      }
      emit();
    }

    function schedule(ms) {
      if (timer) clearTimer(timer);
      const run = generation;
      timer = setTimer(() => {
        timer = null;
        if (run !== generation || !watching) return;
        tick();
      }, ms);
    }

    async function tick() {
      const id = watching;
      if (!id) return;
      if (authState().status !== "authenticated" || !client()) { schedule(RETRY_MS); return; }
      const entry = held(id);
      const full = !entry.fullAt || now().getTime() - entry.fullAt >= FULL_MS ||
        entry.status === "error";
      await read(id, full);
      if (watching !== id) return;
      schedule(athletes[id] && athletes[id].status === "offline" ? RETRY_MS : LIVE_MS);
    }

    /* Polls one athlete for as long as their screen is showing. Each call reads at once,
       so coming back to the screen is never ten seconds stale. */
    function watch(id) {
      id = text(id);
      if (!id || !clients.some(c => c.id === id)) return false;
      if (watching !== id) generation++;
      watching = id;
      if (timer) { clearTimer(timer); timer = null; }
      emit();
      tick();
      return true;
    }

    function unwatch() {
      if (!watching) return;
      watching = null;
      generation++;
      if (timer) { clearTimer(timer); timer = null; }
      emit();
    }

    function reset() {
      unwatch();
      clients = [];
      athletes = {};
      clientsError = null;
    }

    function handleAuth(next) {
      const status = next && next.status;
      if (status === "authenticated") { loadClients(); return; }
      /* An offline owner keeps what was read this session; anyone else sees nothing. */
      if (status === "offline-owner") { clientsStatus = clients.length ? "offline" : "idle"; emit(); return; }
      reset();
      clientsStatus = status === "loading" ? "loading" : "idle";
      emit();
    }

    function init() {
      if (initialized) { handleAuth(authState()); return; }
      initialized = true;
      if (auth && auth.subscribe) unsubscribeAuth = auth.subscribe(handleAuth);
      else handleAuth({ status: "unavailable" });
    }

    return {
      init,
      loadClients,
      watch,
      unwatch,
      isCoach() { return clients.length > 0; },
      athlete: id => athleteState(text(id)),
      getState: publicState,
      subscribe(listener) {
        listeners.add(listener);
        listener(publicState());
        return () => listeners.delete(listener);
      },
      destroy() {
        reset();
        if (unsubscribeAuth) unsubscribeAuth();
        unsubscribeAuth = null;
        initialized = false;
      }
    };
  }

  return { createCoachStore, normalizeSession, latestPerSession, isNetworkError,
    LIVE_MS, FULL_MS, RETRY_MS, LIVE_DAYS };
});
