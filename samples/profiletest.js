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
let cachedReads = 0, sampleOpens = 0, imports = 0, signedOutCallbacks = 0;
let activations = 0, backups = 0, removals = 0;
let historyDownloads = 0, historyCopies = 0;
let accountExports = 0, accountDeletes = 0;
const personal = { meta: { block: "Private strength block", athlete: "Sample Athlete", weeks: 6, version: 3 }, exercises: [] };
const ui = profileModule.createProfileUI(document, auth, authUI, programs, sessions);
ui.init({
  getCachedProgram() { cachedReads++; return personal; },
  onOpenSample() { sampleOpens++; },
  onImport() { imports++; },
  onActivateProgram() { activations++; },
  onBackUpCached() { backups++; },
  onRemoveProgram() { removals++; },
  onDownloadHistory() { historyDownloads++; },
  onCopyHistory() { historyCopies++; },
  onExportAccount() { accountExports++; },
  onDeleteAccount() { accountDeletes++; },
  onSignedOut() { signedOutCallbacks++; },
  infoButton(title, copy) {
    const item = document.createElement("button");
    item.className = "infobtn"; item.setAttribute("data-info", copy);
    return item;
  }
});

function render(next) { state = next; ui.render(); return profileBody.textContent; }
function button(label, host = profileBody) {
  return host.findAll(item => item.tagName === "BUTTON").find(item => item.textContent === label);
}

console.log("\nprofile loading and signed-out entry");
ok(/Checking your account/.test(profileBody.textContent), "loading is explicit");
ok(!/Private strength block/.test(profileBody.textContent), "loading never exposes cached programme metadata");
same(cachedReads, 0, "loading does not read the personal cache for rendering");

let copy = render({ status: "guest", user: null, owner: null, error: null });
ok(!/administrator invitation/.test(copy), "the invitation note is not on screen");
ok(profileBody.findAll(item => item.tagName === "BUTTON")
  .some(item => /administrator invitation/.test(item.attributes["data-info"] || "")),
  "a new visitor can still read the private-beta sign-in context behind an info button");
button("Sign in").onclick(); button("Forgot password?").onclick(); button("View sample programme").onclick();
same(opened, ["sign-in", "recovery"], "profile actions open the existing auth flows");
same(sampleOpens, 1, "the signed-out profile opens the sample deliberately");
same(cachedReads, 0, "a guest cannot reveal the cached programme");

console.log("\nauthenticated and offline-owner profile");
copy = render({ status: "authenticated", user: { email: "one@example.invalid", verified: true },
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/Private strength block/.test(copy), "the authenticated owner sees the cached active programme");
ok(/v3 · 6 weeks/.test(copy), "named with its version and length");
ok(!/On this device|Update available|Sample Athlete/.test(copy),
  "and nothing else while it is backed up and current — a row shows values, not states it is in");
ok(/Cloud history ready/.test(copy), "sync state is one explicit line, not a browser");
ok(!/2026-08-14/.test(copy), "a copy not on this device is not on the menu itself");
ok(ui.offDeviceCount() === 1, "but it is counted, so the menu can say it is there");
const dataHost = new Element("div");
ui.renderAccountData(dataHost);
ok(/2026-08-14/.test(dataHost.textContent) && /Squat/.test(dataHost.textContent) &&
  /Moved well/.test(dataHost.textContent), "and stays readable under Your data");
button("Save a copy", dataHost).onclick(); button("Copy", dataHost).onclick();
button("Save a copy of everything", dataHost).onclick(); button("Delete account…", dataHost).onclick();
ok(!button("Start workout"), "Programme has no Start workout — the hub does that");
ok(button("Import from a file").classList.contains("quietaction"), "import is a quiet link, not a primary");
button("Import from a file").onclick(); button("Remove this programme").onclick();
same(imports, 1, "import requests a library import");
same([historyDownloads, historyCopies], [1, 1], "history export actions stay behind profile callbacks");
same([accountExports, accountDeletes], [1, 1], "account portability controls stay behind profile callbacks");

programState = { ...programState, items: [...programState.items,
  { id: "program-two", title: "Cloud conditioning block", athlete: "Sample Athlete", weeks: 4,
    programVersion: 1, revision: 1, active: false, startDate: "2026-02-02" }] };
ui.render();
ok(/Cloud conditioning block/.test(profileBody.textContent), "the profile lists another private cloud programme");
ok(/suggested start Mon 2 Feb/.test(profileBody.textContent),
  "a coach-published block shows the start it suggests before it is activated");
button("Use on this device").onclick();

copy = render({ status: "offline-owner", user: null,
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/^one@example\.invalid/.test(copy), "a known owner offline still sees whose account it is");
ok(/Private strength block/.test(copy), "offline ownership retains cached programme access");

sessionState = { ...sessionState, status: "offline", pending: 1, conflicts: 1,
  items: [{ ...sessionState.items[0], syncState: "conflict", conflictOf: "canonical-one" }] };
copy = render({ status: "offline-owner", user: null,
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/1 change queued/.test(copy), "offline history reports queued local work");
const offlineData = new Element("div");
ui.renderAccountData(offlineData);
ok(/Conflict copy/.test(offlineData.textContent), "recoverable conflicts are clearly labelled");
ok(!button("Save a copy of everything", offlineData), "the account copy waits for a connection");

programState = { ...programState, activeId: "program-one", items: [
  { ...programState.items[0], active: true, current: false, programVersion: 4,
    changeNote: "W5 D1: low-bar squat replaces front squat" }
] };
copy = render({ status: "authenticated", user: { email: "one@example.invalid", verified: true },
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/Update available/.test(copy), "a newer cloud revision never silently replaces the device prescription");
ok(button("Update device").classList.contains("primary"), "and taking it is the screen's one primary action");
ok(/v4: W5 D1: low-bar squat replaces front squat/.test(copy),
  "the revision's change note is shown where the athlete decides to take it");
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
ok(/Account services unavailable/.test(copy), "known ownership retains cached access during service failure");
ok(/Private strength block/.test(copy), "the cached programme remains usable during service failure");

ui.signOut();
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
  same(accountHost.children.length, 1, "Account's head is one block: the menu rows are the app's");
  ok(/^one@example\.invalid/.test(accountHost.textContent), "the email first");
  ok(/Cloud history ready/.test(accountHost.textContent), "carrying sync state as one line");
  ok(!/Private strength block/.test(accountHost.textContent), "…without the programme library");
  ok(/Private strength block/.test(programmeHost.textContent), "Programme renders the library alone");
  ok(!/one@example/.test(programmeHost.textContent), "…without the account controls");
  let blockStarts = 0;
  ui.init({ blockStart() { blockStarts++; const row = new Element("div"); row.textContent = "Block start row"; return row; } });
  const ordered = new Element("div");
  blockStarts = 0;
  ui.renderProgramme(ordered);
  same(blockStarts, 1, "the app's block-start row is asked for once");
  ok(/Private strength block[\s\S]*Block start row[\s\S]*Import from a file/.test(ordered.textContent),
    "and sits under the active programme, before the library");

  /* The workout browser is gone: a session that IS on this device is a date on the
     calendar, which is a better index than a flat list ever was. Only what the calendar
     cannot show stays reachable in Account. */
  ui.init({ hasLocalSession: (date, day) => date === "2026-08-14" && day === "Day 1 - Strength" });
  const filtered = new Element("div");
  ui.renderAccountData(filtered);
  ok(!/2026-08-14/.test(filtered.textContent),
    "a cloud session already on this device is not listed a second time");
  sessionState = { ...sessionState, conflicts: 1,
    items: [{ ...sessionState.items[0], syncState: "conflict", conflictOf: "canonical-one" }] };
  const conflicted = new Element("div");
  ui.renderAccountData(conflicted);
  ok(/Conflict copy/.test(conflicted.textContent),
    "but a conflict copy is always listed, however local the date looks");
  const head = new Element("div");
  ui.renderAccount(head);
  ok(/1 conflict copy kept/.test(head.textContent), "and counted in the sync line");

  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
}, 0);
