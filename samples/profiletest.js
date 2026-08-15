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
let cachedReads = 0, sampleOpens = 0, workoutOpens = 0, imports = 0, signedOutCallbacks = 0;
const personal = { meta: { block: "Private strength block", athlete: "Sample Athlete", weeks: 6, version: 3 }, exercises: [] };
const ui = profileModule.createProfileUI(document, auth, authUI);
ui.init({
  getCachedProgram() { cachedReads++; return personal; },
  onOpenSample() { sampleOpens++; },
  onOpenCached() { workoutOpens++; },
  onImport() { imports++; },
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
ok(/Stored on this device/.test(copy), "the programme is honestly labelled device-only");
ok(/Cloud history is not connected yet/.test(copy), "history is an honest not-yet-connected state");
button("Start workout").onclick(); button("Replace JSON…").onclick();
same([workoutOpens, imports], [1, 1], "programme actions enter training or request a local import");

copy = render({ status: "offline-owner", user: null,
  owner: { email: "one@example.invalid", signedOut: false }, error: null });
ok(/Offline · cached training available/.test(copy), "a known owner gets a clear offline state");
ok(/Private strength block/.test(copy), "offline ownership retains cached programme access");

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
  same(profileModule.programSummary(personal), {
    title: "Private strength block", athlete: "Sample Athlete", weeks: 6, version: 3
  }, "programme metadata is reduced to the profile's display-only summary");
  same(profileModule.programSummary({}), null, "invalid cached programmes produce no profile summary");
  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
}, 0);
