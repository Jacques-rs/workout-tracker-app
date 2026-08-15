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
 *     losing data; tapping an Overview card opens that exercise in Log and returning
 *     restores the Overview's position
 *   - moving between sets never focuses a field or summons the keyboard
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
  navigator: { onLine: true, clipboard: { writeText: async () => {} } },
  TPAuth: {
    init(){}, subscribe(){ return () => {}; }, canImport(){ return true; },
    getState(){ return { status: "authenticated", user: { email: "test@example.invalid", verified: true } }; }
  },
  TPAuthUI: {
    init(){}, open(){}, renderAccount(host){ host.append(textNode("Test account")); },
    handleKeydown(){ return false; }
  },
  window: {
    scrollY: 0, pageYOffset: 0,
    addEventListener(){},
    scrollTo(x, y){
      this.scrollY = Number(y) || 0; this.pageYOffset = this.scrollY;
    }
  },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL(){} },
  Blob: function(){},
  setTimeout, clearTimeout,
  fetch: async () => { throw new Error("offline in test"); }
};
sandbox.window = Object.assign(sandbox.window, sandbox);
vm.createContext(sandbox);

/* Load the last inline <script> block. External browser dependencies are tested
   separately and must not make this harness execute a vendored bundle. */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\bsrc\s*=/.test(m[1]))
  .map(m => m[2]);
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
  NAV_AT:       {get:()=>NAV_AT},
  OVERVIEW_SCROLL: {get:()=>OVERVIEW_SCROLL, set:v=>{OVERVIEW_SCROLL=v}}
});`;
vm.runInContext(blocks[blocks.length - 1] + EPILOGUE, sandbox, { filename: "index.html<script>" });

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
  sandbox.window.scrollY = 0; sandbox.window.pageYOffset = 0;
  app.SETTINGS = { ...app.SET_DEFAULTS };
  const prog = JSON.parse(fs.readFileSync(path.join(ROOT, "samples", name), "utf8"));
  app.loadProgram(prog);
  return prog;
}
function loadSynthetic(exercises){
  store.clear();ACTIVE_ELEMENT=null;app.SETTINGS={...app.SET_DEFAULTS};
  sandbox.window.scrollY=0;sandbox.window.pageYOffset=0;
  const day="Day 1 (Mon) - Circuit test";
  const rows=exercises.map((e,i)=>({id:`w1d1e${i+1}`,week:1,day,name:e.name||`Circuit ${i+1}`,
    sets:e.sets,reps:e.reps,load:e.load||"",rpe:e.rpe||"RPE 7",tempo:"",rest:"",
    logHint:e.logHint||"",focus:"",progression:""}));
  app.loadProgram({meta:{schema:"tp-program-2",block:"Circuit fixture",athlete:"Sample",
    athleteId:"sample",weeks:1,version:1,days:[day]},exercises:rows});
  return rows;
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
/* Both action rows carry the .setactions class, so this keeps finding every button one
   level deep even though the primary and the quieter actions are now separate rows. */
function actionBtn(c, re){ return c.findAll(n => n.classList.contains("setactions")).flatMap(a => a.children).find(b => re.test(b.text)); }
function buttonOf(c, re){ return c.findAll(n => n.tagName === "BUTTON").find(b => re.test(b.text)); }
function sheetButton(re){ return stubFor("#sheetBody").findAll(n => n.tagName === "BUTTON").find(b => re.test(b.text)); }
function chooseRpe(c, value){
  const picker = c.findAll(n => n.classList.contains("pickerbtn"))[0];
  assert(!!picker, "RPE is a picker button, not a keyboard field");
  picker.onclick();
  const choice = sheetButton(new RegExp("^" + String(value).replace(".", "\\.") + "$"));
  assert(!!choice, `RPE picker offers ${value}`);
  choice.onclick();
}
function endExercise(c){
  const open=buttonOf(c,/End after|Skip exercise/);assert(!!open,"an explicit end/skip action is available");
  open.onclick();const confirm=sheetButton(/End after|Skip exercise/);assert(!!confirm,"ending early requires clear confirmation");
  confirm.onclick();
}
function setLabel(c){ const n = c.findAll(x => x.classList.contains("setlabel"))[0]; return n && n.text; }
/* Type into a field WITHOUT re-finding the node afterwards — this is what would catch
   the old bug where oninput rebuilt the container and destroyed the input mid-keystroke. */
function type(inp, v){ inp.value = v; inp.oninput(); }

/* ---------- tests ---------- */
console.log("\nauthenticated programme import boundary");
{
  const auth = sandbox.TPAuth;
  assert(app.authCanImport(), "an authenticated account may import a personal programme");
  sandbox.TPAuth = undefined; sandbox.window.TPAuth = undefined;
  assert(!app.authCanImport(), "a missing auth client fails closed instead of bypassing the account gate");
  sandbox.TPAuth = { canImport(){ return false; } }; sandbox.window.TPAuth = sandbox.TPAuth;
  assert(!app.authCanImport(), "a signed-out account may not import a personal programme");
  sandbox.TPAuth = auth; sandbox.window.TPAuth = auth;
}

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
  /* "4 rounds" IS four sets, and used to collapse to one. The rule is deliberately tight:
     an integer, whitespace, then a word — which "8-10 min" and "1 + 3" are not. */
  is(app.prescribedSets({ sets: "4 rounds" }), 4, "an integer followed by a word is that many sets");
  is(app.prescribedSets({ sets: "2 rounds" }), 2, "…so a 2-round couplet shows two set slots");
  is(app.prescribedSets({ sets: "1 + 3" }), 1, "arithmetic prose falls back to one set");
  is(app.prescribedSets({ sets: "AMRAP" }), 1, "AMRAP falls back to one set");
  is(app.prescribedSets({ sets: "8 x 2" }), 8, "…but a leading count still wins when there is one");
  is(app.prescribedSets({}), 1, "missing sets falls back to one set");
}

console.log("\nadaptive circuit logging modes");
{
  const fixed={sets:"4 rounds",reps:"200 m row + 15 KB swing + 10 pull-ups"};
  const forTime={sets:"3 rounds for time",reps:"300 m row + 12 KB swing"};
  const amrap={sets:"AMRAP 12",reps:"250 m row + 10 KB swing"};
  const emom={sets:"EMOM 12",reps:"Min 1 row; min 2 KB swing; repeat"};
  const ladder={sets:"21-15-9",reps:"KB swing + burpee"};
  is(app.circuitOf(fixed),{kind:"rounds",target:4,defaultMode:"quick",label:"Rounds"},
    "fixed rounds default to one-tap round counting");
  is(app.circuitOf(forTime).target,3,"rounds-for-time keeps its prescribed round count");
  is(app.circuitOf(forTime).defaultMode,"final","rounds-for-time defaults to the finish result, not live tapping");
  is(app.circuitOf(amrap).defaultMode,"final","AMRAP defaults to final-result logging");
  is(app.circuitOf(emom).minutes,12,"EMOM duration is understood");
  is(app.circuitOf({sets:"12 min AMRAP"}).minutes,12,"duration-first AMRAP wording is understood");
  is(app.circuitOf(ladder).kind,"ladder","descending ladders use the circuit logger");
  is(app.circuitParts(fixed),["200 m row","15 KB swing","10 pull-ups"],
    "composite work is split into a readable movement list");
  is(app.circuitParts({reps:"200 m row, 15 kg KB swing, 10 pull-ups"}),
    ["200 m row","15 kg KB swing","10 pull-ups"],"comma-separated rounds read just as clearly");
  const legacyCircuit=app.blankEntry();legacyCircuit.reps="Time 10:22";legacyCircuit.load="16";
  app.circuitState(legacyCircuit,forTime);app.syncFinalCircuit(forTime,legacyCircuit);
  is(legacyCircuit.reps,"Time 10:22","opening the new result editor preserves a legacy circuit headline");

  const rows=loadSynthetic([{...fixed,name:"Fixed circuit",load:"15 kg KB",logHint:"Time; RPE at finish"},
    {...amrap,name:"AMRAP circuit",load:"16 kg KB"},
    {...fixed,name:"Detailed circuit",load:"15 kg KB"}]);
  app.STATE.focus=0;
  let C=logCardNode();
  assert(/Quick rounds/.test(C.text),"the adaptive mode is visible without extra fields");
  const round=buttonOf(C,/Complete round 1 of 4/);assert(!!round,"quick mode has one large round action");
  round.onclick();
  let e=app.getSession().entries[rows[0].id];
  is(e.sets[0].reps,"As prescribed","a quick tap records an explicit completed-as-prescribed round");
  is(e.reps,"1 round","the flat circuit summary remains useful to older readers");
  is(app.statusLine(rows[0],e),"1 of 4 rounds completed","Overview speaks in rounds, not strength sets");
  assert(!("circuit" in app.buildSessionExport().entries[0]),"circuit UI bookkeeping never reaches export");

  app.goFocus(1);C=logCardNode();
  assert(/Final result/.test(C.text),"AMRAP opens directly on its final-result form");
  const resultInputs=C.findAll(n=>n.classList.contains("circuitresult")).flatMap(g=>g.findAll(n=>n.tagName==="INPUT"));
  is(resultInputs.map(i=>i.getAttribute("placeholder")),["e.g. 4","e.g. 12","0","Only if different","Optional finish note"],
    "the final-result fields stay in a fast, predictable order");
  type(resultInputs[0],"4");
  is(app.getSession().entries[rows[1].id].circuit.rounds,"4","the rounds field autosaves independently");
  type(resultInputs[1],"12");
  is(app.getSession().entries[rows[1].id].circuit.extra,"12","the extra-reps field autosaves independently");
  is(app.getSession().entries[rows[1].id].reps,"4 rounds + 12 reps","AMRAP fields serialize to a clear flat result");
  buttonOf(C,/Save result & next/).onclick();
  const exportedAmrap=app.buildSessionExport().entries[1];
  is(exportedAmrap.sets,[],"a final-result circuit does not fabricate per-round rows");
  is(exportedAmrap.reps,"4 rounds + 12 reps","the final result survives completion and export");

  C=logCardNode();buttonOf(C,/Change/).onclick();sheetButton(/^Round details/).onclick();
  C=logCardNode();assert(/Round details/.test(C.text),"the quiet override switches to per-round details");
  chooseRpe(C,8.5);
  is(app.getSession().entries[rows[2].id].draft.rpe,"8.5","a detailed-round RPE survives the picker redraw");
  app.goFocus(1);
  const detailed=app.getSession().entries[rows[2].id];
  is(detailed.sets[0].rpe,"8.5","navigating away commits a typed detailed round");
  is(detailed.sets[0].reps,"As prescribed","that round still identifies the completed circuit work");

  app.goFocus(0);C=logCardNode();
  buttonOf(C,/Complete round 2 of 4/).onclick();
  C=logCardNode();buttonOf(C,/Complete round 3 of 4/).onclick();
  C=logCardNode();buttonOf(C,/Complete final round/).onclick();
  is(stubFor("#sheetTitle").text,"Finish circuit","the final planned round opens one compact finish sheet");
  app.sheetClose();C=logCardNode();
  assert(!!buttonOf(C,/Complete another round/),"dismissing finish details cannot log the final round twice");
  is(app.getSession().entries[rows[0].id].sets.length,4,"exactly four quick rounds remain committed");
}

console.log("\nmetricOf — the reps field is whatever the exercise measures");
{
  /* The reported bug: the field was inputmode="numeric", a digits-only keypad on iOS, so
     a 45-second hold could not be typed at all. Two prescriptions in five in the real
     programme are a duration, a distance or prose. */
  const m = reps => app.metricOf({ reps });
  const shape = reps => { const x = m(reps); return [x.label, x.unit, x.inputmode]; };
  is(shape("45 sec"), ["Hold", "s", "decimal"], "seconds become a Hold in s");
  is(shape("45s"), ["Hold", "s", "decimal"], "…with or without the space");
  is(shape("8-10 min"), ["Time", "min", "decimal"], "minutes become Time in min, not metres");
  is(shape("20 m"), ["Dist", "m", "decimal"], "a bare m is metres");
  is(shape("15/12 cal"), ["Work", "cal", "decimal"], "calories are their own metric");
  is(shape("4"), ["Reps", "", "numeric"], "a plain count keeps the fast numeric keypad");
  is(shape("4-6"), ["Reps", "", "numeric"], "…and so does a range");
  is(shape("6/side"), ["Reps", "", "numeric"], "per-side work is still a rep count");
  is(shape("20-30 sec/side"), ["Hold", "s", "decimal"], "…and a per-side hold is still a hold");
  /* The unit lives in the label, not as an overlay inside the field: "min" plus "8-10"
     does not fit a 68px column, and it clipped the value. */
  is(m("8-10 min").fieldLabel, "Time (min)", "the field label carries the unit");
  is(m("4").fieldLabel, "Reps", "…and says nothing extra when there is no unit");
  assert(m("15/12 cal").fieldLabel.length <= 10,
     `every field label stays short enough not to wrap a 68px column (got ${JSON.stringify(m("15/12 cal").fieldLabel)})`);
  /* Composite prose is tested FIRST, or this reads as a 45-second hold. */
  is(shape("45 sec hard / 75 sec easy"), ["Result", "", "text"],
     "an interval prescription is prose, and gets the full keyboard");
  is(shape("5 TnG power cleans + 15/12 cal bike"), ["Result", "", "text"],
     "…as does anything with arithmetic in it");
  is(shape(""), ["Reps", "", "text"],
     "no prescription at all never gets a digits-only keypad — that is the whole bug");
  is(m("45 sec").placeholder, "45", "the placeholder is the prescription, minus the unit");
  is(m("8-10 min").placeholder, "8-10", "…range and all");
  is(m("5 TnG power cleans + 15/12 cal bike").placeholder, "result",
     "…but prose gets a generic word, not a prescription clipped mid-syllable");
  is(m("45 sec hard / 75 sec easy").autocap, "sentences", "free text keeps capitalisation");
  is(m("4").autocap, "off", "…and a number never does");

  /* The value carries its unit into the derived summary, so "3x45" can't be read as
     45 reps. Still a plain string, still exactly what was typed plus a suffix. */
  const rows = n => Array.from({ length: n }, () => ({ load: "", reps: "45", rpe: "", painDuring: "", note: "" }));
  is(app.deriveReps(rows(3), "s"), "3x45s", "three 45-second holds derive as 3x45s");
  is(app.deriveReps(rows(3)), "3x45", "…and with no unit, exactly as before");
  is(app.deriveReps(rows(1), "s"), "45s", "a single hold is never prefixed 1x");
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
  assert(/Log set 1 of/.test(actionBtn(C, /Log set|Log final|Log another/).text), "the primary button names the current and planned set");

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
  chooseRpe(C, "9");
  C = card();
  actionBtn(C, /Log set 1/).onclick();

  is(stored().sets.length, 1, "committing appends one row");
  is(stored().sets[0], { set: 1, load: "100", reps: "4", rpe: "9", painDuring: "", note: "" },
     "the committed row carries what was typed");
  C = card();
  is(stored().draft.load, "100", "the next draft seeds from the set just committed");
  assert(/Log set 2 of/.test(actionBtn(C, /Log set|Log final|Log another/).text), "the button now reads Log set 2");
  assert(!!buttonOf(C, /End after 1 of/), "partial work has an explicit End-after action");

  /* Commit the rest without changing anything — a confirmed set that matches the one
     before it is still a set that was performed, and must still be exported. */
  while(stored().sets.length < n-1)actionBtn(card(), /Log set/).onclick();
  const originalIndex=app.STATE.focus;
  assert(/Log final set/.test(actionBtn(card(), /Log final set/).text), "the last prescribed action is named as final");
  actionBtn(card(), /Log final set/).onclick();
  is(stored().sets.length, n, `all ${n} prescribed sets committed`);
  is(stored().sets[n - 1].load, "100", "an unedited commit keeps following the seed — it is still a real set");
  is(stored().done, true, "the final planned set completes the exercise");
  is(app.STATE.focus, originalIndex+1, "the final planned set advances to the next exercise");

  /* The recovery action reads the latest session rather than its pre-navigation copy:
     tapping it after starting the next exercise must never autosave that new work away. */
  const nextEx=app.dayExercises()[originalIndex+1],nextCard=card();
  type(setInputs(nextCard)[0],"keep me");
  const addFromToast=buttonOf(stubFor("#toast"),/Add set/);assert(!!addFromToast,"completion offers a quiet Add set recovery action");
  addFromToast.onclick();
  is(app.getSession().entries[nextEx.id].draft.load,"keep me","Add set preserves anything already typed on the next exercise");

  /* Every new draft seeds forward from the set just committed — that is the whole
     point, so logging another set past the prescribed count costs one tap, not four. */
  const before2 = stored().sets.length;
  app.goFocus(originalIndex);
  const c2=card();
  is(setInputs(c2).map(i => i.value).some(Boolean), true, "the extra-set draft is seeded from the last commit, not blank");
  actionBtn(c2, /Log final set/).onclick();
  is(stored().sets.length, before2 + 1, "logging another set after the prescribed count still works");

  /* Committing an entirely empty draft must be a no-op, not a phantom set. The only way
     to get an empty draft is if the athlete clears every field by hand — simulate that
     directly rather than through the UI, since a fresh draft is never blank on its own. */
  const s3 = app.getSession();
  s3.entries[ex.id].draft = app.blankDraft();
  s3.entries[ex.id].done = false;
  app.saveSession(s3);
  app.goFocus(originalIndex);
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
  chooseRpe(C, "8.5");
  C = logCardNode();
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

console.log("\nset transitions do not summon the keyboard");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises().slice().sort((a, b) => app.prescribedSets(b) - app.prescribedSets(a))[0];
  app.STATE.focus = app.dayExercises().indexOf(ex);

  let C = logCardNode();
  const first = setInputs(C)[0];
  first.focus(); type(first, "70");
  const commit = actionBtn(C, /Log set 1/);
  commit.focus(); commit.onclick();
  C = logCardNode();
  assert(setInputs(C).every(i => !i._focused), "advancing to the next set leaves its fields unfocused");

  const chip = chipsOf(C)[0];
  chip.focus(); chip.onclick();
  assert(setInputs(C).every(i => !i._focused), "opening a committed set leaves its fields unfocused");
  const save = actionBtn(C, /Save set 1/);
  save.focus(); save.onclick();
  assert(setInputs(C).every(i => !i._focused), "returning from a committed set leaves the draft unfocused");

  const addNote = buttonOf(C, /^\+ note$/);
  addNote.focus(); addNote.onclick();
  const note = C.findAll(n => n.tagName === "INPUT" && /note$/i.test(n.getAttribute("aria-label") || ""))[0];
  assert(!!note && note._focused, "the explicit + note action still focuses its new note field");
}

console.log("\nupcoming chips are inert; set-count changes are secondary");
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
  is(before.length, n, `all ${n} chips show`);
  const todoChips = before.filter(c => c.getAttribute("data-state") === "todo");
  assert(todoChips.length === n - 3, "everything past the current slot (set 3) is todo");
  assert(todoChips.every(c => !c.onclick), "a todo chip has no handler at all — nothing to mis-tap");
  assert(todoChips.every(c => c.tagName === "SPAN"), "…and is not even a button, so it does not invite one");
  const doneChips = before.filter(c => c.getAttribute("data-state") === "done");
  assert(doneChips.every(c => typeof c.onclick === "function"),
     "a logged set is still tappable, because there is something there to edit");

  assert(!C.findAll(n=>n.classList.contains("cntbtn")).length,
    "set-count steppers do not compete with the main logging action");
  const adjust=buttonOf(C,/Adjust sets/);
  assert(!!adjust,"a quiet Adjust sets action remains available");
  adjust.onclick();
  const minus=stubFor("#sheetBody").findAll(n=>n.tagName==="BUTTON").find(b=>b.getAttribute("aria-label")==="Plan one set fewer");
  const plus=stubFor("#sheetBody").findAll(n=>n.tagName==="BUTTON").find(b=>b.getAttribute("aria-label")==="Plan one set more");
  assert(!!minus&&!!plus,"the add/remove controls live in the secondary sheet");
  minus.onclick();app.sheetClose();
  C = logCardNode();
  is(chipsOf(C).length, n - 1, "⊖ drops exactly one planned set");
  is(app.getSession().entries[ex.id].sets.length, 2, "…without touching anything already committed");
  is(app.getSession().entries[ex.id].setTarget, n - 1, "the reduced target is what's stored");

  buttonOf(C,/Adjust sets/).onclick();
  const plus2=stubFor("#sheetBody").findAll(n=>n.tagName==="BUTTON").find(b=>b.getAttribute("aria-label")==="Plan one set more");
  plus2.onclick();app.sheetClose();
  C = logCardNode();
  is(chipsOf(C).length,n,"⊕ restores the prescribed planned count");
  is(setLabel(C),`Set 3 of ${n}`,"the visible progress label follows the sheet choice");

  assert(!("setTarget" in app.buildSessionExport().entries.find(x => x.exercise === ex.name)),
     "setTarget is app-local bookkeeping and never reaches the export");

  /* Editing a committed set is not the moment to be re-planning the session. */
  chipsOf(C)[0].onclick();
  C = logCardNode();
  assert(!buttonOf(C,/Adjust sets/), "set planning is absent while editing a committed set");
  actionBtn(C, /Cancel/).onclick();
}

console.log("\na typed set is never lost — flushed on End, navigation and export");
{
  /* The defect: Finish marked the exercise done and left the typed set sitting in the
     draft, which nothing but the editor reads. It exported as if the set never happened,
     and Overview said "nothing logged" for an exercise that had just been trained. */
  const setup = () => {
    loadFixture("program.v2.sample.json");
    app.STATE.week = 1;
    const ex = app.dayExercises()[1];
    app.STATE.focus = 1;
    app.STATE.setEdit = null;
    return ex;
  };
  const entry = ex => app.getSession().entries[ex.id] || app.blankEntry();

  let ex = setup();
  let C = logCardNode();
  type(setInputs(C)[0], "72.5");
  type(setInputs(C)[1], "5");
  is(entry(ex).sets.length, 0, "typing alone commits nothing — the draft is still a draft");
  assert(app.draftDirty(entry(ex)), "…but it is flagged as typed, not as a seeded copy");
  endExercise(C);
  is(entry(ex).sets.length, 1, "End commits the typed set instead of discarding it");
  is(entry(ex).sets[0].load, "72.5", "…carrying exactly what was typed");
  is(entry(ex).done, true, "and the exercise is still marked done");

  /* The same on the way past: Next, a pip, a day change, a week change. */
  ex = setup();
  C = logCardNode();
  type(setInputs(C)[0], "80");
  app.stepFocus(1);
  is(entry(ex).sets.length, 1, "paging to the next exercise commits it");

  ex = setup();
  C = logCardNode();
  type(setInputs(C)[0], "80");
  app.selectWeek(2);
  app.selectWeek(1);
  is(entry(ex).sets.length, 1, "changing week commits it");

  ex = setup();
  C = logCardNode();
  type(setInputs(C)[0], "80");
  app.setView("list");
  is(entry(ex).sets.length, 1, "so does leaving the editor for Overview");
  app.setView("focus");

  ex = setup();
  C = logCardNode();
  type(setInputs(C)[0], "80");
  app.flushDraft();
  is(app.buildSessionExport().entries.find(x => x.exercise === ex.name).sets.length, 1,
     "and the flush before an export puts it in the file");

  /* A draft that is only a seeded copy of the last set is NOT a set that happened. */
  ex = setup();
  C = logCardNode();
  type(setInputs(C)[0], "60");
  actionBtn(C, /Log set 1/).onclick();
  is(entry(ex).sets.length, 1, "one set committed");
  assert(!app.draftDirty(entry(ex)), "the next draft is seeded, not dirty");
  endExercise(logCardNode());
  is(entry(ex).sets.length, 1, "so End does not invent a second set from the seed");

  /* Neither is an empty draft, and the bookkeeping never reaches a log file. */
  ex = setup();
  const s = app.getSession();
  s.entries[ex.id] = { ...app.blankEntry(), draft: { ...app.blankDraft(), dirty: true } };
  app.saveSession(s);
  is(app.flushDraft(), false, "a dirty but empty draft commits nothing");
  ex = setup();
  C = logCardNode();
  type(setInputs(C)[0], "90");
  actionBtn(C, /Log set 1/).onclick();
  const exported = app.buildSessionExport().entries.find(x => x.exercise === ex.name);
  assert(!("dirty" in exported.sets[0]), "the dirty flag never reaches an exported set row");
}

console.log("\nOverview always says where an exercise stands");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const exs = app.dayExercises();
  const ex = exs[1];
  app.STATE.focus = 1;
  /* Read Overview WITHOUT going through setView(): switching views deliberately commits a
     dirty draft, so an in-progress draft has to be set up in storage and read directly.
     That is also the only way it reaches the athlete for real — a reload (or a crash)
     with a set still typed and unconfirmed. */
  const ovOf = i => {
    app.SETTINGS.view = "list";
    const c = exCards()[i];
    app.SETTINGS.view = "focus";
    return { line: (c.find(n => n.classList.contains("ov-status")) || {}).text,
             badge: (c.find(n => n.classList.contains("ov-badge")) || {}).text };
  };
  is(ovOf(1).line, "Not started", "an untouched exercise says so, instead of rendering no line at all");
  is(ovOf(1).badge, "○", "…with the untouched badge");

  /* The reported symptom: a set typed but not confirmed was invisible here. */
  let s = app.getSession();
  s.entries[ex.id] = { ...app.blankEntry(),
    draft: { load: "60", reps: "", rpe: "", painDuring: "", note: "", dirty: true } };
  app.saveSession(s);
  is(ovOf(1).line, "Set 1 typed — not logged yet", "a typed-but-unlogged set is visible, not silent");
  is(ovOf(1).badge, "◐", "…and reads as in progress");

  actionBtn(logCardNode(), /Log set 1/).onclick();
  const target = app.targetSets(ex, app.getSession().entries[ex.id]);
  is(ovOf(1).line, `1 of ${target} sets logged`, "a committed set is counted");
  type(setInputs(logCardNode())[1], "4");
  is(ovOf(1).line, `1 of ${target} sets logged · set 2 in progress`,
     "…and a set in progress on top of it is spelled out");

  endExercise(logCardNode());
  /* The badge carries "done"; the line is spent on what was logged, not on a second tick. */
  is(ovOf(1).badge, "✓", "a finished exercise gets the done badge");
  assert(!/✓/.test(ovOf(1).line) && ovOf(1).line.length > 0,
     `…and its line summarises the work instead (got ${JSON.stringify(ovOf(1).line)})`);

  /* Finishing a warm-up with nothing logged is legitimate, and must read as deliberate
     rather than as an error. */
  const warm = app.dayExercises().find(e => app.prescribedSets(e) === 1) || exs[0];
  const wi = app.dayExercises().indexOf(warm);
  app.goFocus(wi);
  endExercise(logCardNode());
  is(ovOf(wi).line, "Skipped — no sets logged", "a deliberate skip says exactly that");

  is(app.summaryText(app.blankEntry()), "", "summaryText itself reports nothing as empty, not as prose");
}

console.log("\nthe programme's own logHint drives what gets flagged");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const asked = ex => !!app.painAsked(ex);
  const site = ex => (app.painAsked(ex) || {}).site;

  const iso = { name: "Spanish squat isometric", logHint: "Pain 0-10 during + next-AM stiffness" };
  assert(asked(iso), "an exercise whose logHint mentions pain is flagged");
  is(site(iso), "", "…with no site when the hint names none");
  const sled = { name: "Backward sled drag", logHint: "Total load; knee response during + next AM" };
  assert(asked(sled), "so is 'knee response'");
  is(site(sled), "knee", "…and the site is picked up");
  const ham = { name: "Nordic hamstring eccentric", logHint: "Reps; hamstring soreness next AM" };
  is(site(ham), "hamstring", "a different site is read as itself, not as knee");
  assert(!asked({ name: "Bench press - back-off", logHint: "Load" }), "a plain load hint is not flagged");
  assert(!asked({ name: "Warm-up: bike", logHint: "" }), "and neither is an empty one");
  /* Declared tendon work counts even with no logHint — the category says it. */
  assert(asked({ name: "Something", logHint: "", category: "prehab" }),
     "declared tendon/prehab work is flagged on the category alone");
  /* The keyword guess reaches the same conclusion when nothing is declared. */
  assert(asked({ name: "Copenhagen plank", logHint: "" }),
     "…as does a name the category rules resolve to tendon work");

  is(app.parseHints({ logHint: "Top load; RPE-1; depth owned Y/N; knee pain during + next AM" }),
     ["Top load", "RPE-1", "depth owned Y/N", "knee pain during + next AM"],
     "hints split on semicolons only — a '+' clause is one instruction, not two");
  is(app.parseHints({ logHint: "" }), [], "no hint, no chips");
  is(app.parseHints({ logHint: "a; b; c; d; e" }).length, 4, "and at most four, so the row stays one line-ish");

  /* The pain field is accented where it is asked for, and present either way. */
  const labelsOf = ex => { app.STATE.focus = app.dayExercises().indexOf(ex); return logCardNode(); };
  const real = app.dayExercises().find(e => app.painAsked(e));
  const plain = app.dayExercises().find(e => !app.painAsked(e));
  assert(!!real && !!plain, "the fixture has one of each");
  const askedLbl = c => c.findAll(n => n.classList.contains("lbl") && n.classList.contains("asked")).length;
  const painLbls = c => c.findAll(n => n.classList.contains("lbl") && /pain/i.test(n.text)).length;
  assert(askedLbl(labelsOf(real)) >= 1, "the pain label is accented where the programme asks");
  is(askedLbl(labelsOf(plain)), 0, "…and plain where it does not");
  assert(painLbls(labelsOf(plain)) >= 1,
     "but the field is still there — hiding it would make an empty value unreadable");

  /* The drawer offers the site the programme talks about, rather than expecting the
     athlete to know that "Knee" is a setting. */
  assert(["knee", "hamstring", ""].includes(app.programPainSite()),
     `programPainSite reads a site off the fixture (got ${JSON.stringify(app.programPainSite())})`);
}

console.log("\nclear early stopping and reopening");
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
  endExercise(logCardNode());
  is(entry().done, true, "ending early marks the exercise done");
  is(entry().sets.length, 1, "…without inventing the sets that were never logged");
  is(app.STATE.focus, exIdx + 1, "and — like the old Mark done — finishing advances to the next exercise");

  app.goFocus(exIdx);
  const reopen = actionBtn(logCardNode(), /Reopen exercise/);
  assert(!!reopen, "a completed exercise can be reopened");
  reopen.onclick();
  is(entry().done, false, "reopening clears done");
  is(entry().sets.length, 1, "…and does not touch what was already logged");

  /* A warm-up with zero sets can still be finished. */
  loadFixture("program.v2.sample.json");
  const warm = app.dayExercises().find(e => app.prescribedSets(e) === 1) || app.dayExercises()[0];
  app.STATE.focus = app.dayExercises().indexOf(warm);
  const wCard = logCardNode();
  const skipNoSets = buttonOf(wCard, /Skip exercise/);
  assert(!!skipNoSets, "Skip exercise is explicit with nothing logged yet");
  endExercise(wCard);
  is(app.getSession().entries[warm.id].done, true, "and it skips with an empty sets[]");
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
  chooseRpe(C,"7");
  C=logCardNode();
  actionBtn(C, /Log set 1/).onclick();

  let e = app.getSession().entries[ex.id];
  /* This fixture row is a timed hold, so the derived value carries the metric's unit —
     "5s", never a bare "5" that reads as five reps. */
  const unit = app.metricOf(ex).unit;
  is([e.load, e.reps, e.rpe], ["60", "5" + unit, "7"],
     "the summary auto-fills from the one set logged, unit and all");
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

  /* Ending or skipping deliberately keeps the old forward-navigation behaviour. */
  const isDone = i => !!(app.getSession().entries[exs[i].id] || {}).done;
  app.goFocus(0);
  if(isDone(0)){ actionBtn(logCardNode(),/Reopen exercise/).onclick(); }
  app.goFocus(0);
  endExercise(logCardNode());
  is(app.STATE.focus, 1, "ending moves on to the next exercise");
  is(isDone(0), true, "and the one behind you stays logged");

  const lastIdx = exs.length - 1;
  app.goFocus(lastIdx);
  if(isDone(lastIdx)){ actionBtn(logCardNode(),/Edit result|Reopen exercise/).onclick(); app.goFocus(lastIdx); }
  endExercise(logCardNode());
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
  sandbox.window.scrollY = 640; sandbox.window.pageYOffset = 640;
  targetCard.onclick();
  is(app.SETTINGS.view, "focus", "tapping a card switches to Log view");
  is(app.STATE.focus, idx, "…on the exercise that was tapped");
  is(sandbox.window.scrollY, 0, "Log opens at the top");
  app.setView("list");
  is(sandbox.window.scrollY, 640, "returning to Overview restores its previous position");
}

console.log("\nOverview position resets when the workout context changes");
{
  const prog = loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  app.OVERVIEW_SCROLL = 400; app.selectWeek(2);
  is(app.OVERVIEW_SCROLL, 0, "changing week clears the Overview position");

  const otherDay = prog.meta.days.find(d => d !== app.STATE.day);
  app.OVERVIEW_SCROLL = 400; app.selectDay(otherDay);
  is(app.OVERVIEW_SCROLL, 0, "changing day clears the Overview position");

  app.OVERVIEW_SCROLL = 400; app.selectDate("2020-02-02");
  is(app.OVERVIEW_SCROLL, 0, "changing date clears the Overview position");

  app.OVERVIEW_SCROLL = 400; app.loadProgram(prog);
  is(app.OVERVIEW_SCROLL, 0, "importing a programme clears the Overview position");
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
