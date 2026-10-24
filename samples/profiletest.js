#!/usr/bin/env node
"use strict";

const profileModule = require("../js/profile-ui.js");

let failures = 0;
function ok(condition, message) {
  if (condition) console.log("  ok   " + message);
  else { console.error("  FAIL " + message); failures++; }
}
function same(actual, expected, message) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), message);
}

class ClassList {
  constructor(value = "") { this.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  contains(value) { return this.values.has(value); }
}
class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.nodeType = 1;
    this.classList = new ClassList(); this._text = ""; this.disabled = false; this.attributes = {};
  }
  set className(value) { this._className = value; this.classList = new ClassList(value); }
  get className() { return this._className || ""; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join("") : this._text; }
  set innerHTML(value) { if (!value) { this.children = []; this._text = ""; } }
  append(...children) { children.forEach(child => this.children.push(child.nodeType ? child : textNode(child))); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  findAll(predicate, output = []) {
    if (predicate(this)) output.push(this);
    this.children.forEach(child => { if (child.nodeType === 1) child.findAll(predicate, output); });
    return output;
  }
}
function textNode(value) { return { nodeType: 3, textContent: String(value) }; }

const profileBody = new Element("main");
const document = {
  createElement: tag => new Element(tag),
  createTextNode: textNode,
  querySelector: selector => selector === "#profileBody" ? profileBody : null
};

let state = { status: "loading", user: null, owner: null, error: null };
let listener = null;
let signedOut = 0;
const auth = {
  getState: () => state,
  subscribe(next) { listener = next; next(state); return () => { listener = null; }; },
  canAccessCached() {
    return state.status === "authenticated" || state.status === "offline-owner" ||
      (state.status === "unavailable" && state.owner && !state.owner.signedOut);
  },
  canImport() { return state.status === "authenticated" || state.status === "offline-owner"; },
  async signOutLocal() { signedOut++; }
};
const opened = [];
const authUI = { open(mode) { opened.push(mode); } };
let programState = { status: "ready", error: null, activeId: "program-one", pending: false, items: [
  { id: "program-one", title: "Private strength block", athlete: "Sample Athlete", weeks: 6,
    programVersion: 3, revision: 1, active: true, current: true }
] };
const programs = {
  getState: () => programState,
  subscribe(next) { next(programState); return () => {}; }
};
const historyPayload = {
  schema: "tp-session-3", block: "Private strength block", athlete: "Sample Athlete",
  week: 2, date: "2026-08-14", day: "Day 1 - Strength", session: { readiness: "Green" },
  entries: [{ exercise: "Squat", done: true, load: "80", reps: "5", rpe: "7",
    painDuring: "", notes: "Moved well", sets: [{ set: 1, load: "80", reps: "5", rpe: "7", painDuring: "", note: "" }] }]
};
let sessionState = { status: "ready", error: null, syncing: false, pending: 0,
  conflicts: 0, localOnly: 0, hasMore: false, items: [{
    id: "session-one", programId: "program-one", conflictOf: null,
    block: "Private strength block", date: "2026-08-14", day: "Day 1 - Strength", week: 2,
    completedExercises: 1, totalExercises: 1, complete: true, syncState: "synced", detailAvailable: true
  }] };
const sessions = {
  getState: () => sessionState,
  getPayload: id => id === "session-one" ? historyPayload : null,
  subscribe(next) { next(sessionState); return () => {}; },
  async loadMore() {}, async retry() {}
};
let cachedReads = 0, sampleOpens = 0, workoutOpens = 0, imports = 0, signedOutCallbacks = 0;
let activations = 0, backups = 0, removals = 0;
let historyDownloads = 0, historyCopies = 0;
let accountExports = 0, accountDeletes = 0;
const personal = { meta: { block: "Private strength block", athlete: "Sample Athlete", weeks: 6, version: 3 }, exercises: [] };
const ui = profileModule.createProfileUI(document, auth, authUI, programs, sessions);
ui.init({
  getCachedProgram() { cachedReads++; return personal; },
  onOpenSample() { sampleOpens++; },
  onOpenCached() { workoutOpens++; },
  onImport() { imports++; },
  onActivateProgram() { activations++; },
  onBackUpCached() { backups++; },
  onRemoveProgram() { removals++; },
  onDownloadHistory() { historyDownloads++; },
  onCopyHistory() { historyCopies++; },
  onExportAccount() { accountExports++; },
  onDeleteAccount() { accountDeletes++; },
  onSignedOut() { signedOutCallbacks++; }
});

function render(next) { state = next; ui.render(); return profileBody.textContent; }
function button(label) {
  return profileBody.findAll(item => item.tagName === "BUTTON").find(item => item.textContent === label);
}

console.log("\nprofile loading and signed-out entry");
ok(/Checking your account/.test(profileBody.textContent), "loading is explicit");
ok(!/Private strength block/.test(profileBody.textContent), "loading never exposes cached programme metadata");
same(cachedReads, 0, "loading does not read the personal cache for rendering");

let copy = render({ status: "guest", user: null, owner: null, error: null });
ok(/administrator invitation/.test(copy), "a new visitor sees private-beta sign-in context");
button("Sign in").onclick(); button("Forgot password?").onclick(); button("View sample programme").onclick();
same(opened, ["sign-in", "recovery"], "profile actions open the existing auth flows");
same(sampleOpens, 1, "the signed-out profile opens the sample deliberately");
same(cachedReads, 0, "a guest cannot reveal the cached programme");

console.log("\nauthenticated and offline-owner profile");
copy = render({ status: "authenticated", user: { email: "one@example.invalid", verified: true },
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/Private strength block/.test(copy), "the authenticated owner sees the cached active programme");
ok(/Cloud backup current/.test(copy), "the active programme is identified as backed up");
ok(/Cloud history ready/.test(copy), "sync state is one explicit line, not a browser");
ok(/2026-08-14/.test(copy) && /Squat/.test(copy) && /Moved well/.test(copy),
  "a copy that is not on this device stays readable");
button("Download JSON").onclick(); button("Copy JSON").onclick();
button("Export account data").onclick(); button("Delete account…").onclick();
button("Start workout").onclick(); button("Import programme JSON…").onclick(); button("Remove").onclick();
same([workoutOpens, imports], [1, 1], "programme actions enter training or request a library import");
same([historyDownloads, historyCopies], [1, 1], "history export actions stay behind profile callbacks");
same([accountExports, accountDeletes], [1, 1], "account portability controls stay behind profile callbacks");

programState = { ...programState, items: [...programState.items,
  { id: "program-two", title: "Cloud conditioning block", athlete: "Sample Athlete", weeks: 4,
    programVersion: 1, revision: 1, active: false }] };
ui.render();
ok(/Cloud conditioning block/.test(profileBody.textContent), "the profile lists another private cloud programme");
button("Use on this device").onclick();

copy = render({ status: "offline-owner", user: null,
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/Offline · cached training available/.test(copy), "a known owner gets a clear offline state");
ok(/Private strength block/.test(copy), "offline ownership retains cached programme access");

sessionState = { ...sessionState, status: "offline", pending: 1, conflicts: 1,
  items: [{ ...sessionState.items[0], syncState: "conflict", conflictOf: "canonical-one" }] };
copy = render({ status: "offline-owner", user: null,
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/1 change queued/.test(copy), "offline history reports queued local work");
ok(/Conflict copy/.test(copy), "recoverable conflicts are clearly labelled");

programState = { ...programState, activeId: "program-one", items: [
  { ...programState.items[0], active: true, current: false }
] };
copy = render({ status: "authenticated", user: { email: "one@example.invalid", verified: true },
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/Cloud update available/.test(copy), "a newer cloud revision never silently replaces the device prescription");
button("Update device").onclick();

console.log("\nlegacy device-only programme can join the library");
programState = { status: "ready", error: null, activeId: "", pending: false, items: [] };
copy = render({ status: "authenticated", user: { email: "one@example.invalid", verified: true },
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/On this device/.test(copy), "an unlinked cached programme is labelled honestly");
button("Back up to library").onclick();

console.log("\nexplicit sign-out and account conflicts");
copy = render({ status: "guest", user: null,
  owner: { email: "one@example.invalid", signedOut: true }, error: null });
ok(/Personal data is still on this device/.test(copy), "sign-out explains preservation without exposing data");
ok(!/Private strength block/.test(copy), "explicit sign-out hides cached programme metadata");

copy = render({ status: "conflict", user: null,
  owner: { email: "one@example.invalid", signedOut: true }, error: { message: "conflict" } });
ok(/Account mismatch/.test(copy), "account conflicts have a dedicated state");
ok(!/Private strength block/.test(copy), "a conflicting account cannot inspect the bound cache");

console.log("\nknown owner with unavailable account services");
copy = render({ status: "unavailable", user: null,
  owner: { email: "one@example.invalid", signedOut: false }, error: { message: "Unavailable" } });
ok(/cached training available/.test(copy), "known ownership retains cached access during service failure");
ok(/Private strength block/.test(copy), "the cached programme remains usable during service failure");

button("Sign out on this device").onclick();
setTimeout(() => {
  same([signedOut, signedOutCallbacks], [1, 1], "profile sign-out uses the local auth boundary and returns home");
  same([activations, backups, removals], [2, 1, 1], "library actions are routed through callbacks");
  same(profileModule.programSummary(personal), {
    title: "Private strength block", athlete: "Sample Athlete", weeks: 6, version: 3
  }, "programme metadata is reduced to the profile's display-only summary");
  same(profileModule.programSummary({}), null, "invalid cached programmes produce no profile summary");

  console.log("\nthe hub's two screens render on their own");
  state = { status: "authenticated", user: { email: "one@example.invalid", verified: true },
    owner: { email: "one@example.invalid", signedOut: false }, error: null };
  /* Own preconditions: earlier blocks deliberately left the sync state offline and
     conflicted. */
  sessionState = { status: "ready", error: null, syncing: false, pending: 0, conflicts: 0,
    localOnly: 0, hasMore: false, items: [{ id: "session-one", programId: "program-one",
      conflictOf: null, block: "Private strength block", date: "2026-08-14",
      day: "Day 1 - Strength", week: 2, completedExercises: 1, totalExercises: 1,
      complete: true, syncState: "synced", detailAvailable: true }] };
  const accountHost = new Element("div"), programmeHost = new Element("div");
  ui.renderAccount(accountHost);
  ui.renderProgramme(programmeHost);
  ok(/Your account/.test(accountHost.textContent), "Account renders the account section alone");
  ok(!/Programmes/.test(accountHost.textContent), "…without the programme library");
  ok(/Cloud history ready/.test(accountHost.textContent), "carrying sync state as one line");
  ok(/Programmes/.test(programmeHost.textContent), "Programme renders the library alone");
  ok(!/Your account/.test(programmeHost.textContent), "…without the account controls");

  /* The workout browser is gone: a session that IS on this device is a date on the
     calendar, which is a better index than a flat list ever was. Only what the calendar
     cannot show stays reachable in Account. */
  ui.init({ hasLocalSession: (date, day) => date === "2026-08-14" && day === "Day 1 - Strength" });
  const filtered = new Element("div");
  ui.renderAccount(filtered);
  ok(!/2026-08-14/.test(filtered.textContent),
    "a cloud session already on this device is not listed a second time");
  sessionState = { ...sessionState, conflicts: 1,
    items: [{ ...sessionState.items[0], syncState: "conflict", conflictOf: "canonical-one" }] };
  const conflicted = new Element("div");
  ui.renderAccount(conflicted);
  ok(/Conflict copy/.test(conflicted.textContent),
    "but a conflict copy is always listed, however local the date looks");
  ok(/1 conflict copy kept/.test(conflicted.textContent), "and counted in the sync line");

  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
}, 0);
