(function (root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }
  root.TPProfileUI = exported.createProfileUI(root.document, root.TPAuth, root.TPAuthUI, root.TPPrograms);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function node(document, tag, props, children) {
    const element = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === "className") element.className = value;
      else if (key === "textContent") element.textContent = value;
      else if (key === "attrs") Object.entries(value).forEach(([name, attr]) => element.setAttribute(name, attr));
      else element[key] = value;
    });
    (Array.isArray(children) ? children : [children]).forEach(child => {
      if (child != null) element.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function programSummary(program) {
    if (!program || typeof program !== "object" || !program.meta || !Array.isArray(program.exercises)) return null;
    const meta = program.meta;
    const version = Number(meta.version);
    return {
      title: text(meta.block) || "Untitled programme",
      athlete: text(meta.athlete),
      weeks: Math.max(1, Number(meta.weeks) || 1),
      version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 0
    };
  }

  function createProfileUI(document, auth, authUI, programs) {
    let options = {};
    let initialized = false;
    let unsubscribe = null;
    const $ = selector => document && document.querySelector(selector);

    function button(label, className, onClick) {
      const item = node(document, "button", { className: className || "ghost", textContent: label });
      item.onclick = onClick;
      return item;
    }

    function card(title, copy, children, className) {
      const body = node(document, "section", { className: "profile-card" + (className ? " " + className : "") });
      body.append(node(document, "h2", { className: "profile-card-title", textContent: title }));
      if (copy) body.append(node(document, "p", { className: "profile-copy", textContent: copy }));
      (Array.isArray(children) ? children : [children]).forEach(child => { if (child) body.append(child); });
      return body;
    }

    function actionRow(children) {
      return node(document, "div", { className: "profile-actions" }, children);
    }

    function run(action) {
      return async () => {
        try { await action(); }
        catch (error) {
          if (options.onNotice) options.onNotice(error && error.message || "Programme action failed.");
        }
      };
    }

    function openAuth(mode) {
      if (authUI && authUI.open) authUI.open(mode);
    }

    function sampleAction() {
      return button("View sample programme", "ghost profile-wide", () => {
        if (options.onOpenSample) options.onOpenSample();
      });
    }

    function accountLoading(host) {
      host.append(card("Account", "Checking your account…", null, "profile-loading"));
      host.append(card("Programmes", "Your personal programme stays hidden until the account check finishes.", null, "profile-loading"));
      host.append(card("Recent workouts", "Workout history will appear here after account access is confirmed.", null, "profile-loading"));
    }

    function signedOut(host, state) {
      const signedOutOwner = state.owner && state.owner.signedOut;
      const copy = signedOutOwner
        ? `Signed out · ${state.owner.email || "known account"}. Personal data is still on this device and will reappear after sign-in.`
        : "Private beta accounts are created by administrator invitation.";
      host.append(card("Your account", copy, actionRow([
        button("Sign in", "primary", () => openAuth("sign-in")),
        button("Forgot password?", "quietaction", () => openAuth("recovery"))
      ])));
      host.append(card("Explore the tracker",
        "The sample is a separate demo. Anything logged there stays on this device and never mixes with a personal programme.",
        sampleAction()));
    }

    function blockedAccount(host, state) {
      if (state.status === "setup-required") {
        host.append(card("Finish account setup",
          `${state.owner && state.owner.email || "Your invited account"} still needs a password.`,
          button("Finish account setup", "primary profile-wide", () => openAuth("password"))));
        return;
      }
      if (state.status === "conflict") {
        host.append(card("Account mismatch",
          "This installation belongs to another beta account. Personal data is preserved but hidden. Use a separate browser profile for this account.", null, "profile-error"));
        host.append(card("Explore the tracker", "The isolated sample remains available without account access.", sampleAction()));
        return;
      }
      host.append(card("Account services unavailable",
        state.error && state.error.message || "Sign-in is unavailable right now. Try again when account services recover.",
        actionRow([
          button("Try sign-in", "primary", () => openAuth("sign-in")),
          button("View sample", "ghost", () => { if (options.onOpenSample) options.onOpenSample(); })
        ]), "profile-error"));
    }

    function ownerProfile(host, state) {
      const offline = state.status === "offline-owner";
      const unavailable = state.status === "unavailable";
      const email = state.user && state.user.email || state.owner && state.owner.email || "Known beta account";
      const status = offline ? "Offline · cached training available"
        : unavailable ? "Account services unavailable · cached training available"
        : state.user && state.user.verified ? "Email verified" : "Signed in";
      const signOut = button("Sign out on this device", "ghost profile-wide", async () => {
        if (!auth || !auth.signOutLocal) return;
        await auth.signOutLocal();
        if (options.onSignedOut) options.onSignedOut();
      });
      host.append(card("Your account", email, [
        node(document, "p", { className: "profile-status", textContent: status }), signOut
      ]));

      const library = programs && programs.getState ? programs.getState()
        : { status: "offline", items: [], activeId: "", pending: false, error: null };
      const summary = programSummary(options.getCachedProgram && options.getCachedProgram());
      const items = Array.isArray(library.items) ? library.items : [];
      const activeItem = items.find(item => item.id === library.activeId);
      const importAllowed = !!(auth && auth.canImport && auth.canImport());
      const libraryCopy = library.pending
        ? "Saved on this device · cloud backup queued"
        : library.status === "loading"
          ? "Loading your private cloud library…"
          : library.status === "offline"
            ? "Offline · the active programme remains available on this device"
            : library.status === "error"
              ? library.error && library.error.message || "The cloud library is unavailable."
              : "Private programmes · available only to this account";
      const programmeChildren = [];

      if (summary) {
        const facts = [summary.athlete, `${summary.weeks}-week block`, summary.version ? `v${summary.version}` : "",
          library.pending ? "Backup queued" : activeItem && activeItem.current ? "Cloud backup current"
            : activeItem ? "Cloud update available" : "On this device"]
          .filter(Boolean).join(" · ");
        const activeActions = [
          button("Start workout", "primary", () => { if (options.onOpenCached) options.onOpenCached(); })
        ];
        if (!activeItem && !library.pending && library.status === "ready" && state.status === "authenticated") {
          activeActions.push(button("Back up to library", "ghost", run(async () => {
            if (options.onBackUpCached) await options.onBackUpCached();
          })));
        }
        if (activeItem && !activeItem.current) {
          activeActions.push(button("Update device", "ghost", run(async () => {
            if (options.onActivateProgram) await options.onActivateProgram(activeItem.id);
          })));
        }
        if (activeItem && state.status === "authenticated") {
          activeActions.push(button("Remove", "ghost danger", run(async () => {
            if (options.onRemoveProgram) await options.onRemoveProgram(activeItem);
          })));
        }
        programmeChildren.push(node(document, "div", { className: "profile-programme" }, [
          node(document, "div", { className: "profile-programme-title", textContent: summary.title }),
          node(document, "div", { className: "profile-programme-meta", textContent: facts }),
          actionRow(activeActions)
        ]));
      }

      items.filter(item => !(summary && activeItem && item.id === activeItem.id)).forEach(item => {
        const facts = [item.athlete, `${item.weeks}-week block`, item.programVersion ? `v${item.programVersion}` : ""]
          .filter(Boolean).join(" · ");
        const itemActions = [
          button("Use on this device", "ghost", run(async () => {
            if (options.onActivateProgram) await options.onActivateProgram(item.id);
          }))
        ];
        if (state.status === "authenticated") itemActions.push(
          button("Remove", "ghost danger", run(async () => {
            if (options.onRemoveProgram) await options.onRemoveProgram(item);
          }))
        );
        programmeChildren.push(node(document, "div", { className: "profile-programme" }, [
          node(document, "div", { className: "profile-programme-title", textContent: item.title }),
          node(document, "div", { className: "profile-programme-meta", textContent: facts }),
          actionRow(itemActions)
        ]));
      });

      if (!summary && !items.length && library.status !== "loading") {
        programmeChildren.push(node(document, "p", { className: "profile-copy",
          textContent: importAllowed
            ? "No personal programme is stored yet. Import the first programme JSON for this account."
            : "No personal programme is cached, and account services are unavailable for a new import." }));
      }

      const importButton = button(importAllowed ? "Import programme JSON…" : "Import unavailable", "primary profile-wide", () => {
        if (importAllowed && options.onImport) options.onImport();
      });
      importButton.disabled = !importAllowed;
      programmeChildren.push(importButton);
      host.append(card("Programmes", libraryCopy, programmeChildren,
        library.status === "error" ? "profile-error" : ""));

      host.append(card("Recent workouts",
        "Cloud history is not connected yet. Current workout data still autosaves on this device and remains available through session export."));
    }

    function render() {
      const host = $("#profileBody");
      if (!host) return;
      host.innerHTML = "";
      if (!auth || !auth.getState) {
        blockedAccount(host, { status: "unavailable", error: { message: "Account services are unavailable." } });
        return;
      }
      const state = auth.getState();
      if (state.status === "loading") { accountLoading(host); return; }
      const canAccess = !!(auth.canAccessCached && auth.canAccessCached());
      if (canAccess) { ownerProfile(host, state); return; }
      if (state.status === "guest") { signedOut(host, state); return; }
      blockedAccount(host, state);
    }

    function init(nextOptions) {
      options = { ...options, ...(nextOptions || {}) };
      if (initialized || !document) { render(); return; }
      initialized = true;
      if (auth && auth.subscribe) unsubscribe = auth.subscribe(render);
      if (programs && programs.subscribe) {
        const stopPrograms = programs.subscribe(render);
        const stopAuth = unsubscribe;
        unsubscribe = () => { if (stopAuth) stopAuth(); stopPrograms(); };
      }
      render();
    }

    return {
      init,
      render,
      programSummary,
      destroy() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        initialized = false;
      }
    };
  }

  return { createProfileUI, programSummary };
});
