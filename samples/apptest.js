/*
 * apptest.js — headless smoke test for the app logic in index.html.
 *
 *   node samples/apptest.js
 *
 * There is no test suite and no npm in this repo (see CLAUDE.md), so this is a
 * single dependency-free file that stubs just enough DOM to load the inline
 * script and drive it. It is NOT a rendering test — it checks the things that
 * are easy to break silently and expensive to notice in a gym basement:
 *
 *   - a tp-program-2 programme filters by day AND week
 *   - a tp-program-1 programme still filters by day only, and keeps its banner
 *   - a session is logged one set at a time: commit, edit, delete, finish, un-finish
 *   - a legacy (pre-set-at-a-time) session migrates without inventing phantom sets
 *   - the flat summary auto-fills from sets[] and stops once the athlete overrides it
 *   - `draft` and other app-local keys never reach an export
 *   - athleteId survives, including the v1 fallback
 *   - the programme revision is displayed and stamped on the export
 *   - the check-in renders into the drawer, not the training view
 *   - Overview is read-only (no inputs); Log shows one exercise and pages without
 *     losing data; tapping an Overview card opens that exercise in Log
 *   - an input's oninput never replaces the input node it fires from (the old
 *     focus-loss bug)
 *
 * Run it after any change to filtering, logging or export. Rendering, layout and
 * offline behaviour still need a real phone.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

/* ---------- minimal DOM ---------- */
class ClassList {
  constructor(){ this.s = new Set(); }
  add(...c){ c.forEach(x => this.s.add(x)); }
  remove(...c){ c.forEach(x => this.s.delete(x)); }
  contains(c){ return this.s.has(c); }
  toggle(c, on){ (on === undefined ? !this.s.has(c) : on) ? this.s.add(c) : this.s.delete(c); }
}
class El {
  constructor(tag){
    this.tagName = (tag || "div").toUpperCase();
    this.children = []; this.attributes = {}; this.dataset = {};
    this.classList = new ClassList(); this.nodeType = 1;
    this.style = { setProperty(){}, removeProperty(){} };
    this._text = ""; this.value = ""; this.disabled = false;
    this._focused = false;
  }
  set className(v){ this.classList = new ClassList(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); this._cn = v; }
  get className(){ return this._cn || ""; }
  set textContent(v){ this._text = String(v); this.children = []; }
  get textContent(){ return this.children.length ? this.children.map(c => c.textContent).join("") : this._text; }
  set innerHTML(v){ if(!v) this.children = []; }
  get innerHTML(){ return ""; }
  get firstChild(){ return this.children[0]; }
  append(...kids){ kids.forEach(k => { if(k == null) return; this.children.push(k.nodeType ? k : textNode(String(k))); }); }
  setAttribute(k, v){ this.attributes[k] = String(v); }
  getAttribute(k){ return this.attributes[k]; }
  focus(){ this._focused = true; ACTIVE_ELEMENT = this; }
  /* Only selectors the app actually uses on an element: "details", "input", ".chips". */
  querySelectorAll(sel){
    const out = [];
    const want = sel.startsWith(".") ? n => n.classList.contains(sel.slice(1))
                                     : n => n.tagName === sel.toUpperCase();
    (function walk(n){ n.children.forEach(c => { if(c.nodeType === 1){ if(want(c)) out.push(c); walk(c); } }); })(this);
    return out;
  }
  querySelector(sel){ return this.querySelectorAll(sel)[0] || null; }
  /* Test helpers, not DOM API. */
  find(pred){ let hit = pred(this) ? this : null;
    for(const c of this.children){ if(hit) break; if(c.nodeType === 1) hit = c.find(pred); } return hit; }
  findAll(pred, out = []){ if(pred(this)) out.push(this);
    this.children.forEach(c => { if(c.nodeType === 1) c.findAll(pred, out); }); return out; }
  get text(){ return this.textContent; }
}
function textNode(t){ return { nodeType: 3, textContent: t, children: [], find(){ return null; }, findAll(_, o = []){ return o; } }; }

let ACTIVE_ELEMENT = null;
const STUBS = {};
function stubFor(sel){ return STUBS[sel] || (STUBS[sel] = new El("div")); }

const store = new Map();
const sandbox = {
  console,
  document: {
    createElement: t => new El(t),
    createTextNode: t => textNode(String(t)),
    querySelector: stubFor,
    documentElement: { dataset: {} },
    body: new El("body"),
    execCommand(){},
    get activeElement(){ return ACTIVE_ELEMENT; },
    addEventListener(){}
  },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  },
  matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  navigator: { clipboard: { writeText: async () => {} } },
  window: { addEventListener(){} },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL(){} },
  Blob: function(){},
  setTimeout, clearTimeout,
  fetch: async () => { throw new Error("offline in test"); }
};
sandbox.window = Object.assign(sandbox.window, sandbox);
vm.createContext(sandbox);

/* Load the app's main <script> block (index 1; index 0 is the head theme script). */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if(blocks.length < 2){ console.error("expected two <script> blocks in index.html, found " + blocks.length); process.exit(1); }
/* `function` declarations land on the sandbox global by themselves, but the module
   state is `let`/`const`, which does not. Bind it explicitly rather than loosening
   the app's declarations for the sake of a test. */
const EPILOGUE = `
Object.defineProperties(globalThis, {
  STATE:        {get:()=>STATE,        set:v=>{STATE=v}},
  PROGRAM:      {get:()=>PROGRAM,      set:v=>{PROGRAM=v}},
  SETTINGS:     {get:()=>SETTINGS,     set:v=>{SETTINGS=v}},
  SET_DEFAULTS: {get:()=>SET_DEFAULTS},
  FIELD_DEFS:   {get:()=>FIELD_DEFS},
  NAV_AT:       {get:()=>NAV_AT}
});`;
vm.runInContext(blocks[1] + EPILOGUE, sandbox, { filename: "index.html<script>" });

/* ---------- harness ---------- */
let failures = 0;
function fail(msg){ console.error("  FAIL " + msg); failures++; }
function ok(msg){ console.log("  ok   " + msg); }
function is(actual, expected, msg){
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  a === b ? ok(msg) : fail(`${msg}\n         expected ${b}\n         got      ${a}`);
}
function assert(cond, msg){ cond ? ok(msg) : fail(msg); }

const app = sandbox;
function loadFixture(name){
  store.clear();
  ACTIVE_ELEMENT = null;
  app.SETTINGS = { ...app.SET_DEFAULTS };
  const prog = JSON.parse(fs.readFileSync(path.join(ROOT, "samples", name), "utf8"));
  app.loadProgram(prog);
  return prog;
}
/* Render the current view without asserting anything about layout. */
function cards(){ const m = stubFor("#main"); m.children = []; app.renderMain(); return m.children.filter(n => n.nodeType === 1); }
/* Only the exercise cards — banners are element children of #main too. */
function exCards(){ return cards().filter(c => c.classList.contains("card")); }
/* The check-in lives in the drawer now, so it is rendered and read separately from the
   training view. renderCheckin() clears the host itself. */
function checkinCard(){ app.renderCheckin(); return stubFor("#checkinHost").children.find(c => c.nodeType === 1); }
function labelsIn(node){ return node ? node.findAll(n => n.classList.contains("lbl")).map(n => n.text) : []; }
function pips(){ return stubFor("#pips").children.filter(n => n.nodeType === 1); }
/* Log view helpers: the set editor's chips / grid inputs / action buttons live inside
   whichever card is on screen (there is exactly one in focus view). */
function logCardNode(){ app.setView("focus"); return exCards()[0]; }
function setInputs(c){ return c.findAll(n => n.classList.contains("setgrid")).flatMap(g => g.findAll(n => n.tagName === "INPUT")); }
function chipsOf(c){ return c.findAll(n => n.classList.contains("setchip")); }
function actionBtn(c, re){ return c.findAll(n => n.classList.contains("setactions")).flatMap(a => a.children).find(b => re.test(b.text)); }
/* Type into a field WITHOUT re-finding the node afterwards — this is what would catch
   the old bug where oninput rebuilt the container and destroyed the input mid-keystroke. */
function type(inp, v){ inp.value = v; inp.oninput(); }

/* ---------- tests ---------- */
console.log("\ntp-program-2 — week-aware filtering");
{
  const prog = loadFixture("program.v2.sample.json");
  assert(app.isV2(), "isV2() true for tp-program-2");
  const perWeek = w => { app.STATE.week = w; return app.dayExercises(); };
  const w1 = perWeek(1), w2 = perWeek(2);
  assert(w1.length > 0, `week 1 has exercises (${w1.length})`);
  is(w1.length, w2.length, "week 1 and week 2 have the same number of exercises");
  assert(w1.every(e => e.week === 1), "week 1 filter returns only week-1 rows");
  assert(w2.every(e => e.week === 2), "week 2 filter returns only week-2 rows");
  const loads = w => perWeek(w).map(e => e.load).join("|");
  assert(loads(1) !== loads(2), "week 2 shows different prescriptions from week 1");
  const total = prog.exercises.filter(e => e.day === app.STATE.day).length;
  assert(w1.length < total, `day-only would have shown ${total}, week filter shows ${w1.length}`);

  /* Discriminating test: select a week beyond the authored rows. On v2 that must show
     "no exercises", never the v1 "apply the progression rule" banner. Running the SAME
     data as v1 must show the progression banner — otherwise this assertion would pass
     with isV2() hard-wired to either value. */
  app.setView("list");
  app.PROGRAM.meta.weeks = 6;                       // selector can reach past the rows
  app.STATE.week = 6;
  const v2banners = cards().filter(c => c.classList.contains("banner")).map(b => b.text);
  assert(!v2banners.some(t => /Week-1 template/.test(t)), "no progression banner on a v2 programme");
  assert(v2banners.some(t => /No exercises for week 6/.test(t)), "v2 says the week is empty instead");

  app.PROGRAM.meta.schema = "tp-program-1";         // same rows, v1 semantics
  const v1banners = cards().filter(c => c.classList.contains("banner")).map(b => b.text);
  assert(v1banners.some(t => /Week-1 template/.test(t)),
         "the same data read as v1 DOES show the progression banner — the test can fail");
  app.PROGRAM.meta.schema = "tp-program-2";

  /* A row with an unusable week must be reported, not silently dropped. */
  app.STATE.week = 1;
  const victim = app.dayExercises()[0];
  const before = app.dayExercises().length;
  delete victim.week;
  is(app.dayExercises().length, before - 1, "a row with no week drops out of the list");
  const warn = cards().filter(c => c.classList.contains("banner"))
                      .find(b => /no valid week/.test(b.text));
  assert(!!warn && warn.text.includes(victim.name), "and the athlete is told which exercise vanished");
  victim.week = 1;
}

console.log("\ntp-program-1 — unchanged day-only behaviour");
{
  loadFixture("program.sample.json");
  app.setView("list");
  assert(!app.isV2(), "isV2() false for tp-program-1");
  const byDay = app.PROGRAM.exercises.filter(e => e.day === app.STATE.day);
  app.STATE.week = 1;
  is(app.dayExercises().length, byDay.length, "week 1 shows every row for the day");
  app.STATE.week = 4;
  is(app.dayExercises().length, byDay.length, "week 4 still shows them — week is ignored in v1");
  const banner = cards().find(c => c.classList.contains("banner"));
  assert(!!banner && /Week-1 template/.test(banner.text), "progression banner shown past the authored week");
}

console.log("\nprescribedSets — plain integers, ranges, and prose");
{
  is(app.prescribedSets({ sets: "4" }), 4, "a plain integer is used as-is");
  is(app.prescribedSets({ sets: "99" }), 12, "absurd counts are capped at 12");
  is(app.prescribedSets({ sets: "3-4" }), 3, "a numeric range uses its lower bound");
  is(app.prescribedSets({ sets: "3–4" }), 3, "an en dash range parses the same way");
  is(app.prescribedSets({ sets: "0-4" }), 1, "a lower bound of 0 clamps up to 1");
  is(app.prescribedSets({ sets: "8-10 min" }), 1, "a decorated range is prose, not a range — one set");
  is(app.prescribedSets({ sets: "2 rounds" }), 1, "prose falls back to one set");
  is(app.prescribedSets({ sets: "1 + 3" }), 1, "arithmetic prose falls back to one set");
  is(app.prescribedSets({ sets: "AMRAP" }), 1, "AMRAP falls back to one set");
  is(app.prescribedSets({}), 1, "missing sets falls back to one set");
}

console.log("\nderiving the flat summary from sets[]");
{
  const rows = (...loads) => loads.map(load => ({ load, reps: "", rpe: "", painDuring: "", note: "" }));
  is(app.deriveSummary(rows("100", "80", "80")).load, "80", "the more common load wins");
  is(app.deriveSummary(rows("100", "80")).load, "100", "a tie prefers the heavier value, not the later one");
  is(app.deriveSummary(rows("100", "", "")).load, "100", "blank rows are ignored, not counted as ties");
  is(app.deriveSummary([]).load, "", "no sets logged — empty, not fabricated");
  is(app.deriveSummary([]).rpe, "", "…and never a fabricated RPE of 0");

  const repsRows = reps => reps.map(r => ({ load: "", reps: r, rpe: "", painDuring: "", note: "" }));
  is(app.deriveReps(repsRows(["4", "4", "4"])), "3x4", "uniform reps collapse to N x reps");
  is(app.deriveReps(repsRows(["4"])), "4", "a single set is never prefixed 1x");
  is(app.deriveReps(repsRows(["4", "4", "3"])), "4/4/3", "differing reps are joined, not collapsed");
  is(app.deriveReps(repsRows(["4", "4", ""])), "4/4/-", "a hole is shown as a dash, never dropped silently");
  is(app.deriveReps(repsRows(["", "", ""])), "", "nothing logged — empty");

  const rpeRows = vals => vals.map(rpe => ({ load: "", reps: "", rpe, painDuring: "", note: "" }));
  is(app.deriveSummary(rpeRows(["7", "7.5"])).rpe, "7.5", "the higher RPE wins, and a half point survives");
  is(app.deriveSummary(rpeRows(["7-8"])).rpe, "7-8", "prose RPE that fails to parse is kept as-is, never NaN");

  const painRows = vals => vals.map(painDuring => ({ load: "", reps: "", rpe: "", painDuring, note: "" }));
  is(app.deriveSummary(painRows(["1", "3", "2"])).painDuring, "3", "the highest pain score wins");
  is(app.deriveSummary(painRows(["", "", ""])).painDuring, "", "no pain logged — empty, not zero");
}

console.log("\nlogging one set at a time — the commit flow");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises().slice().sort((a, b) => app.prescribedSets(b) - app.prescribedSets(a))[0];
  const n = app.prescribedSets(ex);
  assert(n >= 3, `chose "${ex.name}" with ${n} prescribed sets`);
  app.STATE.focus = app.dayExercises().indexOf(ex);
  app.STATE.setEdit = null;

  const card = () => logCardNode();
  let C = card();
  is(chipsOf(C).length, n, `${n} set chips shown before anything is logged`);
  assert(/Log set 1/.test(actionBtn(C, /Log set|Log another/).text), "the primary button reads Log set 1");

  /* Rendering a never-touched exercise creates its entry in memory only (exactly like
     the old exerciseCard did) — nothing is persisted until a save happens, so read
     tolerantly here rather than assuming the key already exists in storage. */
  const stored = () => { const e = app.getSession().entries[ex.id]; return e || app.blankEntry(); };
  is(stored().sets.length, 0, "nothing committed yet");

  /* Type into set 1's fields and hold the same node — this is exactly the old bug: a
     keystroke that rebuilds its own container destroys the input being typed into. */
  let inputs = setInputs(C);
  const loadInp = inputs[0];
  type(loadInp, "100");
  assert(setInputs(C)[0] === loadInp, "typing a character does not replace the input node");
  type(inputs[1], "4");
  type(inputs[2], "9");
  actionBtn(C, /Log set 1/).onclick();

  is(stored().sets.length, 1, "committing appends one row");
  is(stored().sets[0], { set: 1, load: "100", reps: "4", rpe: "9", painDuring: "", note: "" },
     "the committed row carries what was typed");
  C = card();
  is(stored().draft.load, "100", "the next draft seeds from the set just committed");
  assert(/Log set 2/.test(actionBtn(C, /Log set|Log another/).text), "the button now reads Log set 2");
  assert(!!actionBtn(C, /Finish exercise/), "Finish is offered even before every set is logged");

  /* Commit the rest without changing anything — a confirmed set that matches the one
     before it is still a set that was performed, and must still be exported. */
  while(stored().sets.length < n){
    actionBtn(card(), /Log set|Log another/).onclick();
  }
  is(stored().sets.length, n, `all ${n} prescribed sets committed`);
  is(stored().sets[n - 1].load, "100", "an unedited commit keeps following the seed — it is still a real set");
  assert(/Finish exercise ›/.test(actionBtn(card(), /Finish/).text), "once all sets are logged the Finish label drops the count");

  /* Every new draft seeds forward from the set just committed — that is the whole
     point, so "Log another set" past the prescribed count costs one tap, not four. */
  const before2 = stored().sets.length;
  const c2 = card();
  is(setInputs(c2).map(i => i.value).some(Boolean), true, "the new draft is seeded from the last commit, not blank");
  actionBtn(c2, /Log another/).onclick();
  is(stored().sets.length, before2 + 1, "logging another set after the prescribed count still works");

  /* Committing an entirely empty draft must be a no-op, not a phantom set. The only way
     to get an empty draft is if the athlete clears every field by hand — simulate that
     directly rather than through the UI, since a fresh draft is never blank on its own. */
  const s3 = app.getSession();
  s3.entries[ex.id].draft = app.blankDraft();
  app.saveSession(s3);
  const beforeEmpty = stored().sets.length;
  actionBtn(card(), /Log another/).onclick();
  is(stored().sets.length, beforeEmpty, "committing a wholly empty draft does nothing");
}

console.log("\nediting and deleting a committed set");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises()[1];
  app.STATE.focus = 1;
  const s = app.getSession();
  const e = (s.entries[ex.id] = { done: false, load: "", reps: "", rpe: "", painDuring: "", notes: "",
    sets: [
      { set: 1, load: "100", reps: "4", rpe: "9", painDuring: "", note: "too heavy" },
      { set: 2, load: "80",  reps: "4", rpe: "7", painDuring: "", note: "" },
      { set: 3, load: "80",  reps: "4", rpe: "7", painDuring: "", note: "" }
    ],
    draft: { load: "80", reps: "4", rpe: "7", painDuring: "", note: "" }, summaryAuto: true });
  app.applyDerivedSummary(e);
  app.saveSession(s);

  let C = logCardNode();
  is(chipsOf(C).map(c => c.getAttribute("data-state")), ["done", "done", "done", "current"],
     "three committed chips, the fourth (draft) is current");

  /* Tap chip 1 to edit it. */
  chipsOf(C)[0].onclick();
  C = logCardNode();
  is(app.STATE.setEdit, 0, "tapping a committed chip opens it for editing");
  let inputs = setInputs(C);
  const rpeInp = inputs[2];
  type(rpeInp, "8.5");
  assert(setInputs(C)[2] === rpeInp, "editing a committed set's field does not rebuild it either");
  is(app.getSession().entries[ex.id].sets[0].rpe, "8.5", "the edit writes into the committed row, not the draft");
  is(app.getSession().entries[ex.id].draft.rpe, "7", "…and the draft is untouched while editing");

  actionBtn(C, /Save set 1/).onclick();
  is(app.STATE.setEdit, null, "saving returns to the draft");
  is(app.getSession().entries[ex.id].load, "80", "the flat summary follows the edit (80 is now the mode of 80,80,80)");

  /* Re-open, then Cancel must leave the edit exactly where it was. */
  C = logCardNode();
  chipsOf(C)[0].onclick();
  C = logCardNode();
  actionBtn(C, /Cancel/).onclick();
  is(app.STATE.setEdit, null, "Cancel also returns to the draft");
  is(app.getSession().entries[ex.id].sets[0].rpe, "8.5", "…without discarding what was already saved");

  /* Delete requires two taps. */
  C = logCardNode();
  chipsOf(C)[1].onclick();
  C = logCardNode();
  const del = actionBtn(C, /Delete set/);
  del.onclick();
  is(app.getSession().entries[ex.id].sets.length, 3, "one tap on Delete destroys nothing");
  assert(/Tap again/.test(del.text), "it arms and says so");
  del.onclick();
  is(app.getSession().entries[ex.id].sets.length, 2, "the second tap deletes");
  is(app.getSession().entries[ex.id].sets.map(r => r.set), [1, 2], "the remaining sets renumber from 1");
  is(app.STATE.setEdit, null, "deleting returns to the draft rather than an edit for a row that moved");
}

console.log("\nupcoming (todo) chips are unlocked — tap one to skip a set");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises().slice().sort((a, b) => app.prescribedSets(b) - app.prescribedSets(a))[0];
  const n = app.prescribedSets(ex);
  assert(n >= 4, `chose "${ex.name}" with ${n} prescribed sets`);
  app.STATE.focus = app.dayExercises().indexOf(ex);
  app.STATE.setEdit = null;

  let C = logCardNode();
  type(setInputs(C)[0], "60");
  actionBtn(C, /Log set 1/).onclick();
  C = logCardNode();
  type(setInputs(C)[0], "60");
  actionBtn(C, /Log set 2/).onclick();

  C = logCardNode();
  const before = chipsOf(C);
  is(before.length, n, `all ${n} chips show before anything is skipped`);
  const todoChips = before.filter(c => c.getAttribute("data-state") === "todo");
  assert(todoChips.length === n - 3, "everything past the current slot (set 3) is todo");
  assert(todoChips.every(c => !c.disabled), "and none of them are disabled — this is the reported lock");
  assert(!!todoChips[0].onclick, "a todo chip has a real handler, not just a look");

  todoChips[0].onclick();
  C = logCardNode();
  is(chipsOf(C).length, n - 1, "tapping a todo chip removes exactly one upcoming slot");
  is(app.getSession().entries[ex.id].sets.length, 2, "…without touching anything already committed");
  is(app.getSession().entries[ex.id].setTarget, n - 1, "the reduced target is what's stored");

  /* Keep tapping away every upcoming slot; it must stop at the current one, never eat
     into the sets already logged or vanish the draft itself. */
  while(chipsOf(C).some(c => c.getAttribute("data-state") === "todo")){
    chipsOf(C).find(c => c.getAttribute("data-state") === "todo").onclick();
    C = logCardNode();
  }
  is(chipsOf(C).length, 3, "shrinks all the way down to the two logged sets plus the current draft, no further");
  const label = C.findAll(n => n.classList.contains("setlabel"))[0];
  is(label.text, "Set 3 of 3", "the label reflects the reduced target");
  assert(/Finish exercise \(2 logged\)/.test(actionBtn(C, /Finish/).text),
     "Finish still counts up, since the reduced target's own last set hasn't been logged yet");

  /* Logging that last set must still work — a shrunk target is a ceiling on the display,
     never a hard cap on what can actually be logged. */
  type(setInputs(C)[0], "60");
  actionBtn(C, /Log set 3/).onclick();
  C = logCardNode();
  is(app.getSession().entries[ex.id].sets.length, 3, "the set really was recorded");
  assert(/Finish exercise ›/.test(actionBtn(C, /Finish/).text),
     "…and Finish now reads as complete, since the reduced target has actually been met");

  /* Logging past a reduced target must still work too. */
  actionBtn(C, /Log another set/).onclick();
  C = logCardNode();
  is(chipsOf(C).length, 5, "logging beyond the reduced target grows the strip again");
  is(app.getSession().entries[ex.id].sets.length, 4, "…and that set is recorded as well");

  assert(!("setTarget" in app.buildSessionExport().entries.find(x => x.exercise === ex.name)),
     "setTarget is app-local bookkeeping and never reaches the export");
}

console.log("\nfinish, un-finish, and early stopping");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises().slice().sort((a, b) => app.prescribedSets(b) - app.prescribedSets(a))[0];
  const n = app.prescribedSets(ex);
  assert(n >= 3, `chose "${ex.name}" with ${n} prescribed sets for the early-stop case`);
  app.STATE.focus = app.dayExercises().indexOf(ex);

  /* Finishing with fewer sets than prescribed is legitimate — cutting a set short for
     pain is exactly the signal the coach wants, not something the UI should block. */
  let C = logCardNode();
  type(setInputs(C)[0], "60");
  actionBtn(C, /Log set 1/).onclick();
  const entry = () => app.getSession().entries[ex.id];
  const exIdx = app.STATE.focus;
  is(entry().sets.length, 1, "one set committed");
  actionBtn(logCardNode(), /Finish exercise/).onclick();
  is(entry().done, true, "finishing early marks the exercise done");
  is(entry().sets.length, 1, "…without inventing the sets that were never logged");
  is(app.STATE.focus, exIdx + 1, "and — like the old Mark done — finishing advances to the next exercise");

  app.goFocus(exIdx);              /* Un-finish only makes sense back on the card itself */
  const undo = actionBtn(logCardNode(), /Un-finish/);
  assert(!!undo, "an un-finish action is offered on a done exercise");
  undo.onclick();
  is(entry().done, false, "un-finishing clears done");
  is(entry().sets.length, 1, "…and does not touch what was already logged");

  /* A warm-up with zero sets can still be finished. */
  loadFixture("program.v2.sample.json");
  const warm = app.dayExercises().find(e => app.prescribedSets(e) === 1) || app.dayExercises()[0];
  app.STATE.focus = app.dayExercises().indexOf(warm);
  const wCard = logCardNode();
  const finishNoSets = actionBtn(wCard, /Finish exercise/);
  assert(!!finishNoSets, "Finish is offered with nothing logged yet");
  finishNoSets.onclick();
  is(app.getSession().entries[warm.id].done, true, "and it finishes with an empty sets[]");
  is(app.getSession().entries[warm.id].sets.length, 0, "…exactly zero, not a fabricated set");
}

console.log("\nthe typed summary — auto-follows sets until overridden");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises()[1];
  app.STATE.focus = 1;
  let C = logCardNode();
  type(setInputs(C)[0], "60");
  type(setInputs(C)[1], "5");
  type(setInputs(C)[2], "7");
  actionBtn(C, /Log set 1/).onclick();

  let e = app.getSession().entries[ex.id];
  is([e.load, e.reps, e.rpe], ["60", "5", "7"], "the summary auto-fills from the one set logged");
  is(e.summaryAuto, true, "and is still following");

  /* Open "Summary & notes" and edit the load directly — a deliberate override. */
  const summary = C.findAll(n => n.tagName === "DETAILS").find(d => /Summary/.test(d.text));
  const loadField = summary.findAll(n => n.tagName === "INPUT")[0];
  type(loadField, "65");
  e = app.getSession().entries[ex.id];
  is(e.load, "65", "editing the summary directly overrides the derived value");
  is(e.summaryAuto, false, "…and turns off auto-follow for this entry");

  /* Committing another set must not clobber the manual override. */
  C = logCardNode();
  actionBtn(C, /Log set 2/).onclick();
  is(app.getSession().entries[ex.id].load, "65", "a later commit does not overwrite the manual summary");
}

console.log("\nexport — whitelist, never a leaked app-local key");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises().find(e => /front squat/i.test(e.name)) || app.dayExercises()[1];
  const s = app.getSession();
  const e = (s.entries[ex.id] = { done: true, load: "80", reps: "3x4", rpe: "7",
    painDuring: "3", notes: "dropped after set 1", sets: [], draft: { load: "80", reps: "4", rpe: "7", painDuring: "", note: "" },
    summaryAuto: false });
  e.sets.push({ set: 1, load: "100", reps: "4", rpe: "9", painDuring: "3", note: "too heavy" });
  e.sets.push({ set: 2, load: "80",  reps: "4", rpe: "7", painDuring: "3", note: "" });
  e.sets.push({ set: 3, load: "80",  reps: "4", rpe: "7", painDuring: "2", note: "" });
  e.sets.push({ set: 4, load: "",    reps: "",  rpe: "",  painDuring: "",  note: "" });   // untouched
  app.saveSession(s);

  const out = app.buildSessionExport();
  is(out.schema, "tp-session-3", "schema stays tp-session-3 — the summary contract did not change shape");
  is(out.athleteId, "fixture-slug", "athleteId taken from meta, not re-slugged from the name");
  const entry = out.entries.find(x => x.exercise === ex.name);
  is(entry.sets.length, 3, "the blank 4th row is dropped from the export");
  is(entry.sets.map(r => r.set), [1, 2, 3], "sets are renumbered contiguously");
  is(entry.sets[0], { set: 1, load: "100", reps: "4", rpe: "9", painDuring: "3", note: "too heavy" },
     "set 1 keeps every field");
  is([entry.load, entry.reps, entry.rpe], ["80", "3x4", "7"],
     "a manually-overridden summary is exported as typed, not recomputed from sets");
  is(Object.keys(entry).sort(),
     ["done", "exercise", "load", "notes", "painDuring", "prescribed", "reps", "rpe", "sets"].sort(),
     "no app-local key (draft, summaryAuto, …) reaches the export — this fixture declares no category");
  assert(!("draft" in entry) && !("summaryAuto" in entry), "draft and summaryAuto specifically are absent");
  assert(out.entries.every(x => Array.isArray(x.sets)), "every entry has a sets array");
  assert(out.entries.every(x => x.prescribed && "load" in x.prescribed), "prescribed denormalised into every entry");
  assert(out.entries.length === app.dayExercises().length, "untouched exercises are still exported");
  is(out.tracking.perSetLogging, true, "tracking always records per-set logging as available now");
  const untouched = out.entries.find(x => x.exercise !== ex.name);
  is(untouched.sets, [], "an untouched exercise exports sets: []");
}

console.log("\nexport respects the selected week");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 2;
  const out = app.buildSessionExport();
  is(out.week, 2, "export records the selected week");
  const names = new Set(app.dayExercises().map(e => e.name));
  assert(out.entries.every(x => names.has(x.exercise)), "entries match week 2's exercises");
}

console.log("\ntp-program-1 export still works (v1 fallback)");
{
  loadFixture("program.sample.json");
  const out = app.buildSessionExport();
  is(out.schema, "tp-session-3", "a v1 programme still exports the current session schema");
  is(out.athleteId, "sample-athlete", "athleteId derived by slugging meta.athlete when absent");
  assert(out.entries.every(x => Array.isArray(x.sets)), "sets array present even with nothing logged");
}

console.log("\nprogramme revision — displayed and stamped on the export");
{
  /* The v2 fixture is deliberately at v3, not v1: a test that passes because the
     expected value happens to be 1 would also pass with the field hard-wired. */
  loadFixture("program.v2.sample.json");
  is(app.progVersion(), 3, "version read from meta.version");
  is(app.buildSessionExport().programVersion, 3, "and stamped on the export");
  app.renderAll();
  assert(/·\s*v3$/.test(stubFor("#blockSub").text),
         `shown next to the block name (got ${JSON.stringify(stubFor("#blockSub").text)})`);

  /* A programme from before the revision convention. The app must not invent "v1". */
  loadFixture("program.sample.json");
  is(app.progVersion(), 0, "an unversioned programme reads as 0");
  is(app.buildSessionExport().programVersion, 0, "exported as 0, not omitted");
  app.renderAll();
  assert(!/v\d/.test(stubFor("#blockSub").text),
         "and no version is claimed in the header");

  /* Junk in meta.version must not put "vNaN" on screen or in a log file. */
  loadFixture("program.v2.sample.json");
  for(const junk of ["", "two", -1, 0, null, {}]){
    app.PROGRAM.meta.version = junk;
    is(app.progVersion(), 0, `meta.version ${JSON.stringify(junk)} reads as 0`);
  }
  app.PROGRAM.meta.version = "4";
  is(app.progVersion(), 4, "a numeric string still works");
}

console.log("\npain on waking — a pre-session field, not a next-morning one");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;

  /* It has to be reachable at check-in, before a single set is logged — that is the
     whole point of the move away from amPainNextDay. It is now one tap away in the
     drawer rather than the first card of the training view. */
  const checkin = checkinCard();
  assert(!!checkin && checkin.classList.contains("sessioncard"), "the check-in card renders in the drawer");
  app.setView("list");
  assert(!cards().some(c => c.classList.contains("sessioncard")),
         "and no longer sits at the top of the training view");
  const labels = labelsIn(checkin);
  assert(labels.some(t => /on waking/i.test(t)),
         `labelled for the morning reading (got ${JSON.stringify(labels)})`);
  is(labels[0], "Knee pain on waking", "and it is the first field, not buried under bodyweight");
  assert(!labels.some(t => /next AM/i.test(t)), "the old next-morning field is gone");

  const s = app.getSession();
  s.session.amPainOnWaking = "4";
  app.saveSession(s);
  const out = app.buildSessionExport();
  is(out.session.amPainOnWaking, "4", "the reading round-trips into the export");
  assert(!("amPainNextDay" in out.session), "and amPainNextDay is not exported at all");
  is(out.tracking.painOnWaking, true, "tracking says the field was available");
  assert(!("painNextMorning" in out.tracking), "the old tracking key is gone too");

  /* Switched off, the key keeps its shape so the coach never probes for it. */
  app.SETTINGS.painOnWaking = false;
  const off = app.buildSessionExport();
  is(off.tracking.painOnWaking, false, "switching it off is recorded");
  assert("amPainOnWaking" in off.session, "but the key still ships, so silence is readable");
  assert(!labelsIn(checkinCard()).some(t => /on waking/i.test(t)), "and the input is not rendered");
  app.SETTINGS.painOnWaking = true;

  /* With the check-in behind a tap, the drawer's closed-state summary is the only place
     "did I fill this in?" is answered — so it has to be right in both directions. */
  is(app.checkinSummary(app.getSession()), "knee pain 4/10", "the closed summary reports the reading");
  is(app.checkinFilled(app.getSession()), true, "and the session counts as filled");
  is(app.checkinSummary({ session: {} }), "Not filled", "an untouched session says so plainly");
  is(app.checkinFilled({ session: {} }), false, "…which is what puts the dot on the menu button");
}

console.log("\nview modes — Overview (read-only) vs Log (one exercise)");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const exs = app.dayExercises();
  assert(exs.length >= 3, `the day has ${exs.length} exercises to page through`);

  is(app.SETTINGS.view, "focus", "Log is the default view now — an existing install migrates to it (see below)");

  app.setView("list");
  const overviewCards = exCards();
  is(overviewCards.length, exs.length, "Overview renders every exercise");
  overviewCards.forEach(c => {
    is(c.findAll(n => n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT").length, 0,
       `Overview card for "${c.find(n=>n.classList.contains("ex-name")).text}" has zero inputs`);
  });
  is(pips().length, 0, "and no pips");

  app.setView("focus");
  is(exCards().length, 1, "Log view renders exactly one card");
  is(exCards()[0].find(n => n.classList.contains("ex-name")).text, exs[0].name, "…the first one");
  is(pips().length, exs.length, "one pip per exercise");
  is(stubFor("#navCount").text, `1 / ${exs.length}`, "the counter says where you are");
  is(stubFor("#prevBtn").disabled, true, "Prev is dead on the first exercise");
  is(stubFor("#nextBtn").disabled, false, "Next is live");

  app.stepFocus(1);
  is(app.STATE.focus, 1, "Next advances");
  is(exCards()[0].find(n => n.classList.contains("ex-name")).text, exs[1].name, "and the card follows");
  app.stepFocus(-1);
  is(app.STATE.focus, 0, "Prev goes back");
  app.stepFocus(-1);
  is(app.STATE.focus, 0, "…and stops at the start rather than going negative");
  app.goFocus(999);
  is(app.STATE.focus, exs.length - 1, "jumping past the end clamps to the last exercise");
  is(stubFor("#nextBtn").disabled, true, "where Next is dead instead");

  /* Finishing is the one thing that moves you without being asked, so it is the one
     most worth pinning down. */
  const finishBtn = c => actionBtn(c, /Finish exercise/);
  const isDone = i => !!(app.getSession().entries[exs[i].id] || {}).done;
  app.goFocus(0);
  if(isDone(0)){ finishBtn(logCardNode()).onclick(); }             // start from a known state
  app.goFocus(0);
  finishBtn(logCardNode()).onclick();
  is(app.STATE.focus, 1, "finishing moves on to the next exercise");
  is(isDone(0), true, "and the one behind you stays logged");

  const lastIdx = exs.length - 1;
  app.goFocus(lastIdx);
  if(isDone(lastIdx)){ finishBtn(logCardNode()).onclick(); app.goFocus(lastIdx); }
  finishBtn(logCardNode()).onclick();
  is(app.STATE.focus, lastIdx, "and the last exercise has nowhere to advance to");
  is(isDone(lastIdx), true, "…but is still marked done");

  /* Pips have to carry the same truth as the progress bar, or they are decoration. */
  const doneFlags = () => pips().map(p => p.getAttribute("data-done")).join("");
  assert(/1/.test(doneFlags()), `pips mark what is done (${doneFlags()})`);
  is(pips()[app.STATE.focus].getAttribute("aria-current"), "true", "and which one you are on");
  app.goFocus(0);
  is(pips()[0].getAttribute("aria-current"), "true", "tapping a pip moves the focus");

  /* Changing the session must not leave you on exercise 7 of a day that has 4. */
  const other = app.PROGRAM.meta.days.find(d => d !== app.STATE.day);
  app.goFocus(exs.length - 1);
  app.selectDay(other);
  is(app.STATE.focus, 0, "switching day lands on the first exercise not yet done");
  assert(app.STATE.focus < app.dayExercises().length, "and never past the end of the new day");
  is(app.STATE.setEdit, null, "…and any in-progress set edit is cleared");

  /* The view is a per-device preference, and cosmetic — it must not reach a log file. */
  is(JSON.parse(store.get("tp_settings_v1")).view, "focus", "the choice is remembered");
  assert(!("view" in app.buildSessionExport().tracking), "but never exported in tracking");
  app.setView("list");
  is(exCards().length, app.dayExercises().length, "and switching back shows everything again");
}

console.log("\ntapping an Overview card opens it in Log");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  app.setView("list");
  const exs = app.dayExercises();
  const idx = exs.length > 1 ? 1 : 0;
  const targetCard = exCards()[idx];
  targetCard.onclick();
  is(app.SETTINGS.view, "focus", "tapping a card switches to Log view");
  is(app.STATE.focus, idx, "…on the exercise that was tapped");
  app.setView("list");
}

console.log("\ndrawer — week navigation has a dropdown, not just arrows");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const host = stubFor("#drawerBody");
  host.children = [];
  app.renderDrawer();
  const stepper = host.findAll(n => n.classList.contains("stepper"))[0];
  assert(!!stepper, "the week stepper renders in the drawer");
  const select = stepper.findAll(n => n.tagName === "SELECT")[0];
  assert(!!select, "…and it contains a dropdown — jumping from week 1 to week 6 no longer costs five taps of the arrow");
  is(select.children.filter(c => c.nodeType === 1).length, app.PROGRAM.meta.weeks, "one option per week");
  const arrows = stepper.findAll(n => n.classList.contains("stepbtn"));
  is(arrows.length, 2, "the arrows stay too, for the one-tap case");

  select.value = "4";
  select.onchange();
  is(app.STATE.week, 4, "picking a week from the dropdown jumps straight there");
}

console.log("\nStateEdit is cleared by every navigation entry point");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises()[0];
  app.STATE.focus = 0;
  const s = app.getSession();
  s.entries[ex.id] = { done: false, load: "", reps: "", rpe: "", painDuring: "", notes: "",
    sets: [{ set: 1, load: "60", reps: "5", rpe: "7", painDuring: "", note: "" }],
    draft: { load: "60", reps: "5", rpe: "7", painDuring: "", note: "" }, summaryAuto: true };
  app.saveSession(s);

  const setEditing = () => { app.STATE.setEdit = 0; };
  setEditing(); app.goFocus(1); is(app.STATE.setEdit, null, "goFocus clears it");
  setEditing(); app.selectDay(app.PROGRAM.meta.days[1]); is(app.STATE.setEdit, null, "selectDay clears it");
  app.selectDay(app.PROGRAM.meta.days[0]);
  setEditing(); app.selectDate("2020-02-02"); is(app.STATE.setEdit, null, "selectDate clears it");
  setEditing(); app.selectWeek(2); is(app.STATE.setEdit, null, "selectWeek clears it");
  setEditing(); app.loadProgram(JSON.parse(fs.readFileSync(path.join(ROOT, "samples", "program.v2.sample.json"), "utf8")));
  is(app.STATE.setEdit, null, "loadProgram clears it");
}

console.log("\nmigrating a legacy (pre-set-at-a-time) session on read");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises()[1];

  /* The old "Log each set" table: the athlete typed into set 1 only, and propagate()
     copied that load into every row below it with `auto:true` — the exact shape that
     used to export as N sets performed when only one ever was. */
  store.set(app.sessionKey(), JSON.stringify({
    block: "old", athlete: "old", week: 1, day: app.STATE.day, date: app.STATE.date,
    session: { overall: "written by an older build" },
    entries: { [ex.id]: { done: false, load: "", reps: "", rpe: "", painDuring: "", notes: "",
      sets: [
        { set: 1, load: "100", reps: "4", rpe: "9", painDuring: "", note: "", auto: false },
        { set: 2, load: "100", reps: "",  rpe: "",  painDuring: "", note: "", auto: true },
        { set: 3, load: "100", reps: "",  rpe: "",  painDuring: "", note: "", auto: true },
        { set: 4, load: "100", reps: "",  rpe: "",  painDuring: "", note: "", auto: true }
      ] } }
  }));
  let s = app.getSession();
  is(s.entries[ex.id].sets.length, 1, "auto-seeded rows the athlete never typed into are dropped, not exported as sets");
  is(s.entries[ex.id].sets[0].load, "100", "the one real set survives");
  is(s.entries[ex.id].load, "100", "the flat summary derives from the surviving set");
  assert(!("auto" in s.entries[ex.id].sets[0]), "the auto flag itself is gone after migration");
  assert(!!s.entries[ex.id].draft, "a draft object exists after migration");

  const out = app.buildSessionExport();
  is(out.entries.find(x => x.exercise === ex.name).sets.length, 1,
     "and the export reflects exactly one set performed, not four");

  /* Migration must be idempotent: reading twice must not change anything further, and
     must not write to storage the second time. */
  const raw1 = store.get(app.sessionKey());
  app.getSession();
  const raw2 = store.get(app.sessionKey());
  is(raw1, raw2, "a second read is a no-op — migration does not re-run every time");

  /* A pre-existing flat-only entry (per-set logging used to be opt-in) must be promoted
     into one committed set, not silently blanked by derivation. */
  store.set(app.sessionKey(), JSON.stringify({
    block: "old", athlete: "old", week: 1, day: app.STATE.day, date: app.STATE.date,
    session: {},
    entries: { [ex.id]: { done: true, load: "60", reps: "3x5", rpe: "7", painDuring: "", notes: "" } }
  }));
  s = app.getSession();
  is(s.entries[ex.id].sets.length, 1, "a flat-only legacy entry is promoted to one set");
  is(s.entries[ex.id].sets[0], { set: 1, load: "60", reps: "3x5", rpe: "7", painDuring: "", note: "" },
     "carrying the original values");
  is([s.entries[ex.id].load, s.entries[ex.id].reps, s.entries[ex.id].rpe], ["60", "3x5", "7"],
     "and deriving right back to the same flat summary — promotion is a fixpoint");

  /* A ticked box with nothing logged must not gain an invented set. */
  store.set(app.sessionKey(), JSON.stringify({
    block: "old", athlete: "old", week: 1, day: app.STATE.day, date: app.STATE.date,
    session: {},
    entries: { [ex.id]: { done: true, load: "", reps: "", rpe: "", painDuring: "", notes: "" } }
  }));
  s = app.getSession();
  is(s.entries[ex.id].sets.length, 0, "a done exercise with nothing logged stays sets: []");

  /* A session missing `session`/`entries` entirely must not blank the app. */
  store.set(app.sessionKey(), JSON.stringify({ week: 1, day: app.STATE.day }));
  app.setView("list");
  assert(cards().length > 0, "a session with no session/entries keys still renders");

  /* Non-string values in a set row must not make Export do nothing. */
  const s2 = app.getSession();
  s2.entries[ex.id] = { done: true, load: "", reps: "", rpe: "", painDuring: "", notes: "",
                        sets: [{ set: 1, load: 100, reps: 4, rpe: null, painDuring: undefined, note: "" }],
                        draft: app.blankDraft(), summaryAuto: false };
  app.saveSession(s2);
  is(app.buildSessionExport().entries.find(x => x.exercise === ex.name).sets,
     [{ set: 1, load: "100", reps: "4", rpe: "", painDuring: "", note: "" }],
     "numbers and nulls in a set row are coerced, not thrown on");
}

console.log("\nsettings migration — an existing install lands on Log, not a blank Overview");
{
  store.clear();
  store.set("tp_settings_v1", JSON.stringify({ view: "list", palette: "b" }));
  app.loadSettings();
  is(app.SETTINGS.view, "focus", "a pre-existing install with no `sv` marker is moved to Log");
  is(app.SETTINGS.palette, "b", "…without disturbing an unrelated preference");
  is(JSON.parse(store.get("tp_settings_v1")).sv, 1, "and the migration is persisted");
  app.SETTINGS = { ...app.SET_DEFAULTS };
}

console.log("\nwhere you are in the block survives a refresh");
{
  /* What boot() does to the position on a cold start: a fresh STATE, then restorePos().
     Date is carried over rather than re-derived so the test doesn't depend on the clock —
     boot() starts it at today on purpose, which is tested separately below. */
  const refresh = () => {
    app.STATE = { week: 1, day: null, date: app.STATE.date, focus: 0, setEdit: null };
    app.restorePos();
  };

  const prog = loadFixture("program.v2.sample.json");
  const day2 = prog.meta.days[1];
  app.selectWeek(3);
  app.selectDay(day2);
  refresh();
  is(app.STATE.week, 3, "the selected week is restored, not reset to 1");
  is(app.STATE.day, day2, "and so is the selected day");

  /* The bug this guards: week 5 prescriptions silently becoming week 1's on reload. */
  app.selectWeek(4);
  const wk4 = app.dayExercises().map(e => e.id);
  refresh();
  is(app.dayExercises().map(e => e.id), wk4, "so the exercises on screen are still that week's");

  /* Clamped against the programme actually loaded, not against what was saved. */
  store.set("tp_pos_v1", JSON.stringify({ week: 99, day: day2 }));
  refresh();
  is(app.STATE.week, 1, "a saved week past the end of the block falls back to week 1");
  store.set("tp_pos_v1", JSON.stringify({ week: 2, day: "Day 9 (Sun) - not in this program" }));
  refresh();
  is(app.STATE.day, prog.meta.days[0], "a saved day this programme lacks falls back to day 1");
  is(app.STATE.week, 2, "without discarding the week alongside it");

  /* localStorage is hand-editable and survives builds — it must never be trusted. */
  store.set("tp_pos_v1", "{not json");
  refresh();
  is([app.STATE.week, app.STATE.day], [1, prog.meta.days[0]], "corrupt saved position is ignored");

  /* A fresh import starts at the top of the block, and that has to be written through:
     otherwise the next refresh restores a position belonging to the replaced programme. */
  app.selectWeek(4);
  loadFixture("program.v2.sample.json");
  is(JSON.parse(store.get("tp_pos_v1")).week, 1, "importing a programme resets the saved week");
  refresh();
  is(app.STATE.week, 1, "so a refresh straight after an import stays at week 1");

  /* v1 has no per-week rows, but the athlete still moves through weeks against the
     progression banner, so the selection has to stick there too. */
  loadFixture("program.sample.json");
  app.selectWeek(5);
  refresh();
  is(app.STATE.week, 5, "a v1 programme restores its week as well");

  /* Date is deliberately NOT restored — it keys the stored session, so reopening the app
     the next morning must open a new day, not yesterday's file. */
  app.selectDate("2020-01-01");
  is(JSON.parse(store.get("tp_pos_v1")).week, 5, "changing the date leaves the position alone");
  assert(!/2020-01-01/.test(store.get("tp_pos_v1")), "and the date itself is never persisted");
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
