(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory;
    return;
  }

  root.TPAuth = factory.createAuthClient({
    createClient: root.supabase && root.supabase.createClient,
    config: root.TPAuthConfig,
    storage: root.localStorage,
    location: root.location,
    history: root.history,
    navigator: root.navigator,
    addWindowListener: root.addEventListener ? root.addEventListener.bind(root) : null
  });
})(typeof globalThis !== "undefined" ? globalThis : this, (function () {
  "use strict";

  const FLOW_TYPES = new Set(["invite", "recovery", "signup"]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function authReturn(locationLike) {
    const search = new URLSearchParams(String(locationLike && locationLike.search || "").replace(/^\?/, ""));
    const hash = new URLSearchParams(String(locationLike && locationLike.hash || "").replace(/^#/, ""));
    const get = key => hash.get(key) || search.get(key) || "";
    const rawType = get("type");
    const flow = FLOW_TYPES.has(rawType) ? rawType : null;
    const errorCode = get("error_code") || get("error") || "";
    const errorDescription = get("error_description") || "";
    const hasCredentials = hash.has("access_token") || hash.has("refresh_token") || search.has("code");
    return { flow, errorCode, errorDescription, hasCredentials,
      shouldClean: !!(flow || errorCode || errorDescription || hasCredentials) };
  }

  function safeOwner(storage, key) {
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      if (!value || typeof value !== "object" || !text(value.userId)) return null;
      return {
        userId: text(value.userId),
        email: text(value.email),
        signedOut: !!value.signedOut,
        pendingFlow: value.pendingFlow === "invite" || value.pendingFlow === "recovery"
          ? value.pendingFlow : null
      };
    } catch (_) {
      return null;
    }
  }

  function isNetworkError(error) {
    const code = text(error && error.code).toLowerCase();
    const message = text(error && error.message).toLowerCase();
    return code === "network_error" || code === "request_timeout" ||
      message.includes("failed to fetch") || message.includes("network") ||
      message.includes("load failed") || message.includes("fetch failed");
  }

  function friendlyError(error, fallback) {
    const code = text(error && error.code) || "auth_error";
    const messages = {
      invalid_credentials: "Email or password is incorrect.",
      email_not_confirmed: "Open your invitation email first, or ask the administrator for a new invitation.",
      weak_password: "Use at least 8 characters, including a letter and a number.",
      same_password: "Choose a password you have not used for this account.",
      over_request_rate_limit: "Too many attempts. Wait a little and try again.",
      request_timeout: "The request timed out. Check your connection and try again.",
      account_conflict: "This installation is already bound to a different beta account.",
      auth_unavailable: "Account services are unavailable. Cached workouts still work."
    };
    if (isNetworkError(error)) return { code: "network_error", message: "You appear to be offline. Try again when connected." };
    return { code, message: messages[code] || fallback || "Account request failed. Try again." };
  }

  function createAuthClient(deps) {
    const config = deps.config || {};
    const storage = deps.storage;
    const captured = authReturn(deps.location);
    const listeners = new Set();
    let owner = storage && config.ownerKey ? safeOwner(storage, config.ownerKey) : null;
    let currentSession = null;
    let conflict = null;
    let networkAvailable = !deps.navigator || deps.navigator.onLine !== false;
    let initialized = false;
    let client = null;
    let state = {
      status: "loading", user: null, owner, flow: captured.flow,
      error: captured.errorCode ? {
        code: captured.errorCode,
        message: captured.errorDescription || "This account link is invalid or has expired."
      } : null,
      online: networkAvailable
    };

    function publicState() {
      return {
        ...state,
        user: state.user ? { ...state.user } : null,
        owner: state.owner ? { ...state.owner } : null,
        error: state.error ? { ...state.error } : null
      };
    }

    function emit(next) {
      state = { ...state, ...next, owner };
      const snapshot = publicState();
      listeners.forEach(listener => {
        try { listener(snapshot); } catch (_) {}
      });
    }

    function saveOwner(next) {
      owner = next;
      if (!storage || !config.ownerKey) return;
      try { storage.setItem(config.ownerKey, JSON.stringify(next)); } catch (_) {}
    }

    function cleanReturnUrl() {
      if (!captured.shouldClean || !deps.history || !config.redirectUrl) return;
      try { deps.history.replaceState(null, "", config.redirectUrl); } catch (_) {}
      captured.shouldClean = false;
    }

    function userView(session) {
      const user = session && session.user;
      if (!user) return null;
      return {
        id: text(user.id),
        email: text(user.email),
        verified: !!(user.email_confirmed_at || user.confirmed_at)
      };
    }

    function deriveStatus() {
      if (conflict) return "conflict";
      if (owner && owner.pendingFlow) return "setup-required";
      if (!networkAvailable && owner && !owner.signedOut) return "offline-owner";
      if (currentSession && currentSession.user) return "authenticated";
      return initialized ? "guest" : "loading";
    }

    async function rejectConflict(candidate) {
      conflict = { id: candidate.id, email: candidate.email };
      currentSession = null;
      emit({ status: "conflict", user: null, flow: null,
        error: friendlyError({ code: "account_conflict" }) });
      try { await client.auth.signOut({ scope: "local" }); } catch (_) {}
      return false;
    }

    async function acceptSession(session, flow) {
      const candidate = userView(session);
      if (!candidate || !candidate.id) return false;
      if (owner && owner.userId !== candidate.id) return rejectConflict(candidate);

      const pending = flow === "invite" || flow === "recovery"
        ? flow : owner && owner.pendingFlow || null;
      saveOwner({ userId: candidate.id, email: candidate.email,
        signedOut: false, pendingFlow: pending });
      conflict = null;
      currentSession = session;
      emit({ status: pending ? "setup-required" : deriveStatus(), user: candidate,
        flow: pending, error: null, online: networkAvailable });
      cleanReturnUrl();
      return true;
    }

    function clearSession() {
      currentSession = null;
      emit({ status: deriveStatus(), user: null, flow: null,
        error: state.status === "conflict" ? state.error : null, online: networkAvailable });
    }

    function handleAuthEvent(event, session) {
      Promise.resolve().then(async () => {
        initialized = true;
        if (event === "PASSWORD_RECOVERY") {
          await acceptSession(session, "recovery");
          return;
        }
        if (session && session.user) {
          const flow = captured.flow === "invite" ? "invite" : null;
          await acceptSession(session, flow);
          return;
        }
        if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") clearSession();
      });
    }

    if (typeof deps.createClient === "function" && config.url && config.publishableKey) {
      client = deps.createClient(config.url, config.publishableKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          flowType: "implicit",
          storageKey: config.storageKey
        }
      });
      client.auth.onAuthStateChange(handleAuthEvent);
    } else {
      initialized = true;
      state = { ...state, status: "unavailable",
        error: friendlyError({ code: "auth_unavailable" }) };
    }

    async function init() {
      if (!client) {
        emit(state);
        return publicState();
      }
      try {
        const result = client.auth.initialize ? await client.auth.initialize() : null;
        if (result && result.error) {
          initialized = true;
          if (isNetworkError(result.error) && owner && !owner.signedOut) {
            networkAvailable = false;
            emit({ status: "offline-owner", user: null, online: false,
              error: friendlyError(result.error) });
          } else {
            emit({ status: deriveStatus(), error: friendlyError(result.error) });
          }
        }
      } catch (error) {
        initialized = true;
        if (isNetworkError(error) && owner && !owner.signedOut) {
          networkAvailable = false;
          emit({ status: "offline-owner", online: false, error: friendlyError(error) });
        } else emit({ status: deriveStatus(), error: friendlyError(error) });
      }
      if (captured.errorCode) {
        initialized = true;
        emit({ status: deriveStatus(), error: {
          code: captured.errorCode,
          message: captured.errorDescription || "This account link is invalid or has expired."
        }});
        cleanReturnUrl();
      }
      return publicState();
    }

    async function signIn(email, password) {
      if (!client) return { ok: false, error: friendlyError({ code: "auth_unavailable" }) };
      if (!networkAvailable) return { ok: false, error: friendlyError({ code: "network_error" }) };
      try {
        const result = await client.auth.signInWithPassword({ email: text(email), password: String(password || "") });
        if (result.error) return { ok: false, error: friendlyError(result.error) };
        const accepted = await acceptSession(result.data && result.data.session, null);
        return accepted ? { ok: true } : { ok: false, error: friendlyError({ code: "account_conflict" }) };
      } catch (error) {
        if (isNetworkError(error)) networkAvailable = false;
        return { ok: false, error: friendlyError(error) };
      }
    }

    async function requestRecovery(email) {
      if (!client) return { ok: false, error: friendlyError({ code: "auth_unavailable" }) };
      if (!networkAvailable) return { ok: false, error: friendlyError({ code: "network_error" }) };
      try {
        const result = await client.auth.resetPasswordForEmail(text(email), { redirectTo: config.redirectUrl });
        if (result.error) return { ok: false, error: friendlyError(result.error) };
        return { ok: true };
      } catch (error) {
        if (isNetworkError(error)) networkAvailable = false;
        return { ok: false, error: friendlyError(error) };
      }
    }

    async function updatePassword(password) {
      if (!client) return { ok: false, error: friendlyError({ code: "auth_unavailable" }) };
      try {
        const result = await client.auth.updateUser({ password: String(password || "") });
        if (result.error) return { ok: false, error: friendlyError(result.error) };
        if (owner) saveOwner({ ...owner, signedOut: false, pendingFlow: null });
        const sessionResult = client.auth.getSession ? await client.auth.getSession() : null;
        if (sessionResult && sessionResult.data && sessionResult.data.session)
          currentSession = sessionResult.data.session;
        emit({ status: deriveStatus(), flow: null, error: null, online: networkAvailable,
          user: currentSession ? userView(currentSession) : state.user });
        cleanReturnUrl();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: friendlyError(error) };
      }
    }

    async function signOutLocal() {
      if (owner) saveOwner({ ...owner, signedOut: true, pendingFlow: null });
      conflict = null;
      currentSession = null;
      emit({ status: "guest", user: null, flow: null, error: null });
      if (!client) return { ok: true };
      try {
        const result = await client.auth.signOut({ scope: "local" });
        if (result && result.error) return { ok: false, error: friendlyError(result.error) };
      } catch (_) {
        // The local owner marker and workout cache are already safe; a network failure must
        // not undo the user's explicit sign-out state.
      }
      return { ok: true };
    }

    async function reconnect() {
      networkAvailable = true;
      emit({ online: true, status: deriveStatus(), error: null });
      if (!client || !owner || owner.signedOut || !client.auth.refreshSession) return;
      try {
        const result = await client.auth.refreshSession();
        if (result.error) {
          if (isNetworkError(result.error)) {
            networkAvailable = false;
            emit({ status: "offline-owner", online: false, error: friendlyError(result.error) });
          }
          return;
        }
        if (result.data && result.data.session) await acceptSession(result.data.session, null);
      } catch (error) {
        networkAvailable = false;
        if (owner && !owner.signedOut)
          emit({ status: "offline-owner", online: false, error: friendlyError(error) });
      }
    }

    if (deps.addWindowListener) {
      deps.addWindowListener("offline", () => {
        networkAvailable = false;
        emit({ online: false, status: deriveStatus(), error: null });
      });
      deps.addWindowListener("online", reconnect);
    }

    return {
      init,
      getState: publicState,
      getSession: () => currentSession,
      subscribe(listener) {
        listeners.add(listener);
        listener(publicState());
        return () => listeners.delete(listener);
      },
      signIn,
      requestRecovery,
      updatePassword,
      signOutLocal,
      canImport() {
        return state.status === "authenticated" ||
          (state.status === "offline-owner" && owner && !owner.signedOut);
      },
      isKnownOwner: () => !!owner,
      reconnect,
      _client: client
    };
  }

  return { createAuthClient, authReturn, safeOwner, friendlyError, isNetworkError };
})());
