(function (root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }
  root.TPProfileUI = exported.createProfileUI(
    root.document, root.TPAuth, root.TPAuthUI, root.TPPrograms, root.TPSessions
  );
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

  function createProfileUI(document, auth, authUI, programs, sessions) {
    let options = {};
    let initialized = false;
    let unsubscribe = null;
    const $ = selector => document && document.querySelector(selector);

    function button(label, className, onClick) {
      const item = node(document, "button", { className: className || "ghost", textContent: label });
      item.onclick = onClick;
      return item;
    }

    // `info` is the card's why, kept behind an info button in its title rather than on screen.
    function card(title, copy, children, className, info) {
      const body = node(document, "section", { className: "profile-card" + (className ? " " + className : "") });
      const button = info && options.infoButton ? options.infoButton(title, info) : null;
      body.append(node(document, "h2", { className: "profile-card-title" }, button ? [title, " ", button] : title));
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
          if (options.onNotice) options.onNotice(error && error.message || "Account action failed.");
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
        : "";
      host.append(card("Your account", copy, actionRow([
        button("Sign in", "primary", () => openAuth("sign-in")),
        button("Forgot password?", "quietaction", () => openAuth("recovery"))
      ]), "", "Private beta accounts are created by administrator invitation."));
      host.append(card("Explore the tracker", "", sampleAction(), "",
        "The sample is a separate demo. Anything logged there stays on this device and never mixes with a personal programme."));
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

    function historyDetail(payload) {
      if (!payload) return node(document, "p", { className: "profile-copy",
        textContent: "The original programme is not available, so this local workout cannot be reconstructed for cloud history yet." });
      const wrap = node(document, "div", { className: "profile-history-detail" });
      const checkin = payload.session || {};
      const labels = {
        amPainOnWaking: "Pain on waking", readiness: "Readiness", sleep: "Sleep",
        bodyweightKg: "Bodyweight", hrvNote: "HRV / notes", overall: "Overall notes"
      };
      const checkinFacts = Object.keys(labels).filter(key => text(checkin[key]))
        .map(key => `${labels[key]}: ${text(checkin[key])}`);
      if (checkinFacts.length) wrap.append(node(document, "p", {
        className: "profile-history-checkin", textContent: checkinFacts.join(" · ")
      }));
      (Array.isArray(payload.entries) ? payload.entries : []).forEach(entry => {
        const sets = Array.isArray(entry.sets) ? entry.sets : [];
        const headline = [text(entry.load), text(entry.reps), text(entry.rpe) ? `RPE ${text(entry.rpe)}` : "",
          text(entry.painDuring) ? `Pain ${text(entry.painDuring)}` : ""].filter(Boolean).join(" · ");
        const setCopy = sets.map(row => {
          const facts = [text(row.load), text(row.reps), text(row.rpe) ? `RPE ${text(row.rpe)}` : "",
            text(row.painDuring) ? `Pain ${text(row.painDuring)}` : "", text(row.note)]
            .filter(Boolean).join(" · ");
          return `Set ${row.set}: ${facts || "logged"}`;
        }).join(" | ");
        wrap.append(node(document, "div", { className: "profile-history-exercise" }, [
          node(document, "div", { className: "profile-history-exercise-title",
            textContent: `${entry.done ? "✓" : "○"} ${text(entry.exercise) || "Exercise"}` }),
          node(document, "div", { className: "profile-history-exercise-copy",
            textContent: [headline, setCopy, text(entry.notes)].filter(Boolean).join(" · ") ||
              (entry.done ? "Completed without logged values" : "Not completed") })
        ]));
      });
      return wrap;
    }

    function historyState() {
      return sessions && sessions.getState ? sessions.getState()
        : { status: "offline", items: [], pending: 0, conflicts: 0, localOnly: 0,
            syncing: false, hasMore: false, error: null };
    }
    /* Sync is ONE LINE, and it lives here rather than as a badge on the home, so it
       cannot compete with today's session for attention. */
    function syncLine(history) {
      const bits = [];
      if (history.syncing) bits.push("Syncing…");
      else if (history.status === "offline") bits.push("Offline");
      else if (history.status === "loading") bits.push("Loading cloud history…");
      else if (history.status === "error") bits.push(history.error && history.error.message || "Sync unavailable");
      else bits.push("Cloud history ready");
      if (history.pending) bits.push(`${history.pending} ${history.pending === 1 ? "change" : "changes"} queued`);
      if (history.conflicts) bits.push(`${history.conflicts} conflict ${history.conflicts === 1 ? "copy" : "copies"} kept`);
      if (history.localOnly) bits.push(`${history.localOnly} local-only`);
      return bits.join(" · ");
    }
    /* The workout browser is gone: every session on this device is a date on the
       calendar, which is a better index than a flat list ever was. What the calendar
       cannot show is a copy that is NOT on this device — a conflict copy, or a session
       logged on another install — so those, and only those, stay reachable, under Your
       data, and never on the home: "far less invasive" is the point. */
    function offDeviceItems() {
      const history = historyState();
      return (Array.isArray(history.items) ? history.items : [])
        .filter(item => item.syncState === "conflict" ||
          !(options.hasLocalSession && options.hasLocalSession(item.date, item.day)));
    }
    function offDeviceSection(host, accountState) {
      const history = historyState();
      const items = offDeviceItems();
      if (!items.length) return;
      const children = [];
      items.forEach(item => {
        const stateLabel = item.syncState === "conflict" ? "Conflict copy"
          : item.syncState === "queued" ? "Sync queued"
            : item.syncState === "local-only" ? "Local only" : "Synced elsewhere";
        const progress = item.totalExercises
          ? `${item.completedExercises}/${item.totalExercises} exercises`
          : "Workout saved";
        const details = node(document, "details", { className: "profile-history-item" });
        details.append(node(document, "summary", {}, [
          node(document, "span", { className: "profile-history-date", textContent: item.date }),
          node(document, "span", { className: "profile-history-day", textContent: item.day }),
          node(document, "span", { className: `profile-history-state ${item.syncState}`,
            textContent: `${stateLabel} · ${progress}` })
        ]));
        const payload = sessions && sessions.getPayload ? sessions.getPayload(item.id) : null;
        details.append(historyDetail(payload));
        if (payload) details.append(actionRow([
          button("Save a copy", "ghost", run(async () => {
            if (options.onDownloadHistory) await options.onDownloadHistory(payload);
          })),
          button("Copy", "ghost", run(async () => {
            if (options.onCopyHistory) await options.onCopyHistory(payload);
          }))
        ]));
        children.push(details);
      });
      if (history.hasMore) children.push(button("Load older workouts", "ghost profile-wide", run(async () => {
        if (sessions && sessions.loadMore) await sessions.loadMore();
      })));
      host.append(card("Copies not on this device", accountState.status === "authenticated"
        ? "Readable and exportable, never applied" : "Kept until this device is connected", children, "",
        "These are not on this device, so they do not appear on the calendar. Nothing here is applied to your training — it is kept so it can be read and saved."));
    }

    /* The head of the Account menu: who, and one line of sync. Everything that used to
       sit under it is a row now, drawn by the app, which owns the settings. */
    function accountSection(host, state) {
      const email = state.user && state.user.email || state.owner && state.owner.email || "Known beta account";
      const history = historyState();
      const line = [state.status === "unavailable" ? "Account services unavailable" : "", syncLine(history)]
        .filter(Boolean).join(" · ");
      host.append(node(document, "div", { className: "acct-head" }, [
        node(document, "div", { className: "acct-email", textContent: email }),
        node(document, "p", { className: "profile-sync", textContent: line }),
        history.status === "error"
          ? button("Retry sync", "quietaction", run(async () => {
              if (sessions && sessions.retry) await sessions.retry();
            }))
          : null
      ]));
    }

    /* Your data: the copy of everything, deletion, and what the calendar cannot show. */
    function accountDataSection(host, state) {
      if (state.status === "authenticated") {
        host.append(node(document, "div", { className: "panel" }, [
          button("Save a copy of everything", "ghost profile-wide", run(async () => {
            if (options.onExportAccount) await options.onExportAccount();
          })),
          button("Delete account…", "ghost danger profile-wide", run(async () => {
            if (options.onDeleteAccount) await options.onDeleteAccount();
          }))
        ]));
      }
      offDeviceSection(host, state);
    }

    async function signOut() {
      if (!auth || !auth.signOutLocal) return;
      await auth.signOutLocal();
      if (options.onSignedOut) options.onSignedOut();
    }

    // A suggestion only: activating still opens the start-date sheet, where the athlete decides.
    function startLabel(iso) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
      if (!m) return "";
      const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (date.getUTCDate() !== +m[3]) return "";
      return `suggested start ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()]} ${+m[3]} ${
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1]}`;
    }

    /* The active programme, then the block start (the app's, passed in as
       `blockStart`), then the library. Starting a workout is the hub's job, not this one. */
    function programmeSection(host, state) {
      const library = programs && programs.getState ? programs.getState()
        : { status: "offline", items: [], activeId: "", pending: false, error: null };
      const summary = programSummary(options.getCachedProgram && options.getCachedProgram());
      const items = Array.isArray(library.items) ? library.items : [];
      const activeItem = items.find(item => item.id === library.activeId);
      const importAllowed = !!(auth && auth.canImport && auth.canImport());
      const libraryCopy = library.status === "loading" ? "Loading your library…"
        : library.status === "offline" ? "Offline"
          : library.status === "error" ? library.error && library.error.message || "The library is unavailable."
            : "";

      if (summary) {
        const waiting = !!(activeItem && !activeItem.current);
        const facts = [summary.version ? `v${summary.version}` : "", `${summary.weeks} weeks`,
          library.pending ? "Backup queued" : !activeItem ? "On this device" : ""].filter(Boolean).join(" · ");
        const meta = node(document, "div", { className: "prog-meta" }, facts);
        if (waiting) meta.append(" · ", node(document, "span", { className: "prog-update", textContent: "Update available" }));
        // The note is the coach's why, shown at the one moment the athlete decides to take it.
        const pendingNote = waiting && activeItem.changeNote
          ? node(document, "p", { className: "profile-programme-note",
              textContent: `${activeItem.programVersion ? `v${activeItem.programVersion}: ` : ""}${activeItem.changeNote}` })
          : null;
        const quiet = [];
        if (!activeItem && !library.pending && library.status === "ready" && state.status === "authenticated") {
          quiet.push(button("Back up to library", "quietaction", run(async () => {
            if (options.onBackUpCached) await options.onBackUpCached();
          })));
        }
        if (activeItem && state.status === "authenticated") {
          quiet.push(button("Remove this programme", "quietaction", run(async () => {
            if (options.onRemoveProgram) await options.onRemoveProgram(activeItem);
          })));
        }
        host.append(node(document, "section", { className: "panel prog-active" }, [
          node(document, "div", { className: "prog-name", textContent: summary.title }),
          meta,
          pendingNote,
          waiting ? button("Update device", "primary profile-wide", run(async () => {
            if (options.onActivateProgram) await options.onActivateProgram(activeItem.id);
          })) : null,
          options.blockStart ? options.blockStart() : null,
          quiet.length ? node(document, "div", { className: "prog-quiet" }, quiet) : null
        ]));
      }

      const others = items.filter(item => !(summary && activeItem && item.id === activeItem.id));
      const libraryChildren = [];
      others.forEach(item => {
        const facts = [item.programVersion ? `v${item.programVersion}` : "", `${item.weeks} weeks`,
          startLabel(item.startDate)]
          .filter(Boolean).join(" · ");
        const itemActions = [
          button("Use on this device", "ghost", run(async () => {
            if (options.onActivateProgram) await options.onActivateProgram(item.id);
          }))
        ];
        if (state.status === "authenticated") itemActions.push(
          button("Remove", "quietaction", run(async () => {
            if (options.onRemoveProgram) await options.onRemoveProgram(item);
          }))
        );
        libraryChildren.push(node(document, "div", { className: "profile-programme" }, [
          node(document, "div", { className: "profile-programme-title", textContent: item.title }),
          node(document, "div", { className: "profile-programme-meta", textContent: facts }),
          actionRow(itemActions)
        ]));
      });

      if (!summary && !items.length && library.status !== "loading") {
        libraryChildren.push(node(document, "p", { className: "page-copy",
          textContent: importAllowed ? "No programme yet." : "No programme yet · import needs your account." }));
      }

      const importButton = button(importAllowed ? "Import from a file" : "Import unavailable", "quietaction", () => {
        if (importAllowed && options.onImport) options.onImport();
      });
      importButton.disabled = !importAllowed;
      host.append(node(document, "section", { className: "panel" + (library.status === "error" ? " profile-error" : "") }, [
        others.length ? node(document, "div", { className: "panel-title", textContent: "Library" }) : null,
        libraryCopy ? node(document, "p", { className: "page-copy", textContent: libraryCopy }) : null,
        ...libraryChildren,
        importButton
      ]));
    }

    function ownerProfile(host, state) {
      accountSection(host, state);
      programmeSection(host, state);
    }

    /* The entry gate. Once the owner is known the app routes to the hub instead, so the
       owner branch below only ever paints while the gate is still the visible surface —
       and `onRefresh` is what repaints whichever screen actually is. */
    function render() {
      if (options.onRefresh) options.onRefresh();
      if (options.isEntryVisible && !options.isEntryVisible()) return;
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
      if (sessions && sessions.subscribe) {
        const stopSessions = sessions.subscribe(render);
        const previous = unsubscribe;
        unsubscribe = () => { if (previous) previous(); stopSessions(); };
      }
      render();
    }

    /* Used by the Programme and Account screens, which own their own host. */
    function sectionRenderer(paint) {
      return host => {
        if (!host) return;
        if (!auth || !auth.getState) {
          blockedAccount(host, { status: "unavailable",
            error: { message: "Account services are unavailable." } });
          return;
        }
        const state = auth.getState();
        if (state.status === "loading") { accountLoading(host); return; }
        if (auth.canAccessCached && auth.canAccessCached()) { paint(host, state); return; }
        if (state.status === "guest") { signedOut(host, state); return; }
        blockedAccount(host, state);
      };
    }

    return {
      init,
      render,
      renderAccount: sectionRenderer(accountSection),
      renderAccountData: sectionRenderer(accountDataSection),
      renderProgramme: sectionRenderer(programmeSection),
      offDeviceCount: () => offDeviceItems().length,
      signOut,
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
