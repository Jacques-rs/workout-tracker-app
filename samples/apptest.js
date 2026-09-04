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
  /* Real DOM methods the export path calls on the anchor it builds. Without them
     exportSession() throws into its own catch and looks like a failed export. */
  click(){ if(this.onclick) this.onclick(); }
  remove(){ const p = this.parentNode; if(p) p.children = p.children.filter(c => c !== this); }
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
  /* `length` and `key(i)` are part of the real Storage API and the app uses them: the
     session index scans sibling tp_sess_v1::* keys. Without them the index would come
     back empty here and every date-first assertion below would pass for the wrong
     reason. */
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    get length(){ return store.size; },
    key: i => [...store.keys()][i] ?? null
  },
  matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  navigator: { onLine: true, clipboard: { writeText: async () => {} } },
  TPAuth: {
    init(){}, subscribe(){ return () => {}; }, canImport(){ return true; }, canAccessCached(){ return true; },
    getState(){ return { status: "authenticated", user: { email: "test@example.invalid", verified: true } }; }
  },
  TPAuthUI: {
    init(){}, open(){}, renderAccount(host){ host.append(textNode("Test account")); },
    handleKeydown(){ return false; }
  },
  TPProfileUI: { init(){}, render(){} },
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
  /* The rest clock arms one repaint interval. Stubbed rather than real: a live interval
     would keep this process alive after the assertions finish, and what is worth testing
     is the arithmetic and the repaint, not the timer. */
  setInterval: () => "rest-tick", clearInterval: () => {},
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
  ,APP:          {get:()=>APP}
  ,LS:           {get:()=>LS}
  ,SAMPLE_PROGRAM:{get:()=>SAMPLE_PROGRAM,set:v=>{SAMPLE_PROGRAM=v}}
  ,SCHEDULE:      {get:()=>SCHEDULE,      set:v=>{SCHEDULE=v}}
  ,ACCOUNT_SETTINGS:{get:()=>ACCOUNT_SETTINGS,set:v=>{ACCOUNT_SETTINGS=v}}
  ,ACCOUNT_KEYS:  {get:()=>ACCOUNT_KEYS}
  ,DEVICE_KEYS:   {get:()=>DEVICE_KEYS}
  ,SESSION_INDEX: {get:()=>SESSION_INDEX}
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
  /* Date-first: a programme lands on TODAY, and today may well be a rest day for it —
     these fixtures train Mon/Tue. Claim week 1 day 1, which is exactly what the athlete
     does from the date view's "Doing a different day?", so the tests below have a
     session to log against. The date-resolution path itself is tested on its own. */
  app.applyClaim(1, prog.meta.days[0]);
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
  app.applyClaim(1,day);
  return rows;
}
/* Render the current view without asserting anything about layout. */
function cards(){ const m = stubFor("#main"); m.children = []; app.renderMain(); return m.children.filter(n => n.nodeType === 1); }
/* Only the exercise cards — banners are element children of #main too. */
function exCards(){ return cards().filter(c => c.classList.contains("card")); }
/* The check-in lives in the drawer now, so it is rendered and read separately from the
   training view. renderCheckin() clears the host itself. */
/* The check-in lives at the top of the date view now. renderCheckin() clears its own
   host, and only fills it when a day is claimed — a rest day holds notes, not a workout. */
function checkinCard(){ stubFor("#checkinHost").children = []; app.renderCheckin();
  return stubFor("#checkinHost").children.find(c => c.nodeType === 1); }
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

/* The first date within the next fortnight that this programme does NOT train, so the
   rest-day assertions do not depend on what weekday the suite happens to run on. */
function nonTrainingDate(app, days){
  const trained = new Set(days.map(d => app.parseWeekday(d)));
  let iso = app.todayISO();
  for(let i = 0; i < 14; i++){ if(!trained.has(app.weekdayOf(iso))) return iso;
    iso = app.addDays(iso, 1); }
  return iso;
}

/* ---------- tests ---------- */
console.log("\naccount-first entry and isolated sample storage");
{
  is(app.APP.surface, "profile", "a cold boot lands on the account/profile home");
  assert(stubFor("#workoutView").hidden, "the personal workout is hidden during account entry");

  const personal = loadFixture("program.v2.sample.json");
  const personalJson = store.get("tp_program_v1");
  app.APP.surface = "profile";
  app.SAMPLE_PROGRAM = personal;
  app.openSampleWorkout();
  is(app.APP.source, "sample", "the deliberate sample action opens demo mode");
  assert(!stubFor("#demoBanner").hidden, "sample mode is labelled persistently in the workout header");
  /* The sample trains Mon/Tue, so today is very likely a rest day for it and there is
     no session key until a day is claimed. That is the model, not a gap. */
  app.applyClaim(1, personal.meta.days[0]);
  assert(/^tp_demo_sess_v1::/.test(app.sessionKey()), "sample sessions use their own storage namespace");
  assert(store.has("tp_demo_schedule_v1"), "the sample's block anchor is stored separately too");
  assert(!store.has("tp_schedule_v1") || JSON.parse(store.get("tp_demo_schedule_v1")).anchorMonday,
    "…so opening the sample cannot move a personal block's anchor");
  is(store.get("tp_program_v1"), personalJson, "opening the sample never replaces the cached personal programme");

  app.openProfile();
  is(app.APP.surface, "profile", "the workout can return to profile home");
  app.openCachedWorkout();
  is(app.APP.source, "personal", "the known owner can reopen cached personal training");
  app.applyClaim(1, personal.meta.days[0]);
  assert(/^tp_sess_v1::/.test(app.sessionKey()), "personal sessions retain their existing keys");
  assert(!/^tp_demo_/.test(app.sessionKey()), "personal and sample session keys cannot collide");

  app.openProfile();
  app.acceptProgramImport(personal,true);
  is(app.APP.surface, "profile", "an import started from the profile stays on the profile");
}

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

console.log("\ndevice-first session synchronization boundary");
{
  loadFixture("program.v2.sample.json");
  app.APP.source = "personal";
  const staged = [];
  const programStore = { getActiveIdentity(){ return { id: "program-cloud-id", revision: 1, pending: false }; } };
  const sessionStore = { stage(key, programId, payload){
    staged.push({ key, programId, payload, localAlreadySaved: store.has(key) });
  }};
  sandbox.TPPrograms = programStore; sandbox.window.TPPrograms = programStore;
  sandbox.TPSessions = sessionStore; sandbox.window.TPSessions = sessionStore;
  const session = app.getSession();
  session.session.overall = "Saved locally before cloud staging";
  app.saveSession(session);
  is(staged.length, 1, "a personal autosave stages one cloud snapshot");
  assert(staged[0].localAlreadySaved, "the local session write completes before cloud staging begins");
  is(staged[0].programId, "program-cloud-id", "the snapshot uses the stable programme identity");
  is(staged[0].payload.schema, "tp-session-3", "the cloud payload is the existing export contract");
  is(staged[0].payload.session.overall, "Saved locally before cloud staging",
    "the queued snapshot contains the just-saved keystroke");
  app.APP.source = "sample";
  app.saveSession(app.getSession());
  is(staged.length, 1, "sample sessions never cross the personal sync boundary");
  sandbox.TPPrograms = undefined; sandbox.window.TPPrograms = undefined;
  sandbox.TPSessions = undefined; sandbox.window.TPSessions = undefined;
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
  app.openWorkout("personal");
  C = logCardNode();
  type(setInputs(C)[0], "80");
  app.openProfile();
  is(entry(ex).sets.length, 1, "returning to profile home commits the set in progress");

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
  app.setView("list"); app.renderAll();
  assert(/·\s*v3$/.test(stubFor("#ctxSub").text),
         `shown in the date view's header context (got ${JSON.stringify(stubFor("#ctxSub").text)})`);

  /* A programme from before the revision convention. The app must not invent "v1". */
  loadFixture("program.sample.json");
  is(app.progVersion(), 0, "an unversioned programme reads as 0");
  is(app.buildSessionExport().programVersion, 0, "exported as 0, not omitted");
  app.setView("list"); app.renderAll();
  assert(!/v\d/.test(stubFor("#ctxSub").text),
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
     whole point of the move away from amPainNextDay. It sits near the top of the date
     view, above the exercise list and below the primary action, so it is asked for
     without ever standing between the athlete and a warm-up. */
  app.setView("list");
  const checkin = checkinCard();
  assert(!!checkin && checkin.classList.contains("checkin"), "the check-in renders on the date view");
  assert(!checkin.classList.contains("card"),
         "as a hairline block rather than another nested card");
  app.setView("focus");
  assert(!checkinCard(), "and never inside the focus logger");
  assert(!cards().some(c => c.classList.contains("checkin")),
         "…which the logger's own render confirms");
  app.setView("list");
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

console.log("\nthe drawer is gone, and nothing lost a home");
{
  /* The largest single cut against "too many loose structural parts": four accordions
     and a hamburger disappear, and every one of the things they held has a better home.
     What must NOT survive is a second way to change week, day or date — two independent
     axes are exactly what could drift out of step with the claim. */
  loadFixture("program.v2.sample.json");
  ["renderDrawer", "openDrawer", "closeDrawer", "toggleDrawer", "drawerOpen",
   "weekStepper", "dateRow", "renderDayList", "paintDays", "renderDataSection",
   "accordion"].forEach(name => {
    is(typeof app[name], "undefined", `${name}() is gone`);
  });
  /* The week/day picker survives as the claim picker — one sheet, both halves together,
     and it is the context line that opens it. */
  is(typeof app.openClaimPicker, "function", "the claim picker replaces all three pickers");
  is(typeof app.openCalendarPage, "function", "the calendar replaces the date picker");
  is(typeof app.renderAccountPage, "function", "the Account screen holds the settings");
  is(typeof app.renderProgrammePage, "function", "and the Programme screen import/export");
  /* Appearance and Tracked fields still render — they moved two taps deeper, which is
     right for settings touched twice a year, and they did not disappear. */
  const appearance = new El("div"); app.renderAppearance(appearance);
  assert(appearance.findAll(n => n.classList.contains("pal")).length >= 2,
    "Appearance still offers its palettes");
  const fields = new El("div"); app.renderFields(fields);
  is(fields.findAll(n => n.getAttribute("role") === "switch").length, app.FIELD_DEFS.length,
    "and Tracked fields still offers every switch");
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

console.log("\nreload mid-session restores the claim, not the schedule's guess");
{
  /* There is no stored position any more: the claim lives in the session record, so a
     reload re-resolves the open date and reads (week, day) straight off it. This is the
     single most likely subtle bug in the whole revamp — saveSession() writes week/day
     from STATE on every keystroke, so if STATE were re-derived from the schedule the
     next autosave would quietly rewrite the claim. */
  const today = app.todayISO();
  const wd = app.weekdayOf(today);
  const d1 = `Day 1 (${app.weekdayShort(wd)}) - Squat day`;
  const d2 = `Day 2 (${app.weekdayShort(wd % 7 + 1)}) - Press day`;
  store.clear(); ACTIVE_ELEMENT = null; app.SETTINGS = { ...app.SET_DEFAULTS };
  const rows = [];
  for(let w = 1; w <= 4; w++) for(const day of [d1, d2])
    rows.push({ id: `w${w}${day === d1 ? "d1" : "d2"}e1`, week: w, day,
      name: day === d1 ? "Back squat" : "Strict press", sets: "3", reps: "5",
      load: String(90 + w * 5), rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" });
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Dated", athlete: "Sample",
    athleteId: "sample", weeks: 4, days: [d1, d2] }, exercises: rows });

  is([app.STATE.date, app.STATE.day], [today, d1],
    "a fresh import lands on today, resolved through the schedule");
  is(app.STATE.week, 1, "at the week the anchor puts today in");
  is(app.openState(), "start", "with nothing stored, today is a session waiting to be started");

  /* Two weeks behind the plan — the most common way a block goes off-plan. */
  app.applyClaim(3, d1);
  is(app.openState(), "start", "claiming a week without logging creates nothing");
  is(app.sessionsOn(today).length, 0, "…so browsing weeks never litters the calendar");
  app.startSession();
  is(app.openState(), "resume", "starting a session writes it, and that write IS the claim");
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "97.5"); type(inputs[1], "5");
  actionBtn(c, /^Log set|^Log final/).onclick();

  /* A cold start is a fresh STATE plus today's date, and nothing else. */
  const reload = () => {
    app.STATE = { week: 1, day: null, date: "not-a-date", focus: 0, setEdit: null };
    app.invalidateSessionIndex();
    app.adoptDate(app.todayISO());
  };
  reload();
  is(app.STATE.date, today, "a reload opens today");
  is([app.STATE.week, app.STATE.day], [3, d1],
    "and reads the claimed week and day off the stored session, not the schedule's week 1");
  is(app.dayExercises().map(e => e.load), ["105"],
    "so the prescriptions on screen are the claimed week's");
  is(app.getSession().entries["w3d1e1"].sets[0].load, "97.5",
    "and the set logged before the reload is still there");

  app.saveSession(app.getSession());
  is(JSON.parse(store.get(app.sessionKey())).week, 3,
    "an autosave after the reload keeps the claim rather than overwriting it");

  /* Re-claiming corrects the session in place rather than orphaning it. */
  app.applyClaim(4, d1);
  is(JSON.parse(store.get(app.sessionKey())).week, 4, "re-claiming rewrites the stored week");
  is(app.sessionsOn(today).length, 1, "without leaving a second session on the date");
  is(app.getSession().entries["w3d1e1"].sets[0].load, "97.5",
    "and the logged set is not lost by the correction");

  /* A different day on the same date is a different session, and adopts its own week. */
  app.applyClaim(2, d2);
  app.startSession();
  is(app.sessionsOn(today).length, 2, "two sessions on one date are allowed and listed");
  app.applyClaim(4, d1);
  app.selectDay(d2);
  is(app.STATE.week, 2, "switching to a day already claimed on this date adopts its week");

  /* A v1 programme has no per-week rows, but the week still has to survive a reload —
     the progression banner is read against it. */
  const v1 = loadFixture("program.sample.json");
  app.applyClaim(5, v1.meta.days[0]);
  app.startSession();
  reload();
  is(app.STATE.week, 5, "a v1 programme restores its claimed week too");
  assert(!app.isV2(), "…and is still read as v1");
}

console.log("\nsealing a session, and what an edit does to it afterwards");
{
  const prog = loadFixture("program.v2.sample.json");
  const first = app.dayExercises()[0];
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "100"); type(inputs[1], "5");
  actionBtn(c, /^Log set|^Log final/).onclick();
  is(app.openState(), "resume", "a session with logged work is open");

  const sealedSession = app.sealSession();
  assert(app.sealed(sealedSession), "Finish session seals it");
  assert(/^\d{4}-\d{2}-\d{2}T/.test(sealedSession.sealedAt), "and records when");
  is(app.openState(), "review", "so the date now reads as a sealed session to review");
  /* Sealing is local: it must work with the radio off, or a dropped connection would
     look like an unfinished workout. */
  is(JSON.parse(store.get(app.sessionKey())).status, "sealed", "and it is stored, not sent");

  /* Editing a sealed session does not un-seal it — un-sealing because a typo was fixed
     would flip the calendar back to "unfinished", which is a lie about that day. */
  app.markExported();
  assert(!app.editedSinceExport(app.getSession()), "exporting is not itself an edit");
  const s = app.getSession();
  s.entries[first.id].notes = "felt heavier than it read";
  app.saveSession(s);
  assert(app.sealed(app.getSession()), "an edit after sealing leaves the session sealed");
  is(app.openState(), "review", "so the date's state does not change");
  assert(app.editedSinceExport(app.getSession()),
    "but the exported file is now marked stale");

  /* Re-exporting clears it again. */
  app.markExported();
  assert(!app.editedSinceExport(app.getSession()), "re-exporting clears the stale mark");

  /* An explicit reopen exists so a mis-tapped Finish is not permanent. */
  app.unsealSession();
  is(app.openState(), "resume", "reopening the day is deliberate and available");
  is(app.getSession().sealedAt, "", "and clears the seal time with it");
}

console.log("\na rest day, and no programme at all");
{
  /* A date the programme does not train has no session and no key — a rest day holds
     notes, not a workout. The guard matters: a stray autosave must not file a `::null`
     record that the calendar would then have to explain. */
  const today = app.todayISO();
  const wd = app.weekdayOf(today);
  const other = `Day 1 (${app.weekdayShort(wd % 7 + 1)}) - Not today`;
  store.clear(); app.SETTINGS = { ...app.SET_DEFAULTS };
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Rest", athlete: "Sample",
    athleteId: "sample", weeks: 2, days: [other] },
    exercises: [{ id: "w1d1e1", week: 1, day: other, name: "Squat", sets: "3", reps: "5",
      load: "100", rpe: "RPE 7", tempo: "", rest: "", logHint: "", focus: "", progression: "" }] });
  is(app.STATE.day, null, "today is a rest day for this programme");
  is(app.openState(), "rest", "and reads as one");
  is(app.sessionKey(), "", "with no session key");
  const before = store.size;
  app.saveSession({ entries: {}, session: {} });
  is(store.size, before, "a save with no day claimed writes nothing at all");
  const next = app.nextScheduled(today);
  is(next && next.date, app.addDays(today, 1), "and the next session is one day out");
  is(next && next.week, 1, "in week 1 of the block");

  /* Claiming from a rest day is the documented way to train something today. */
  app.applyClaim(1, other);
  is(app.openState(), "start", "claiming a day on a rest date gives it a session to start");
  is(app.dayExercises().length, 1, "with that day's exercises on screen");

  app.PROGRAM = null; app.refreshSchedule();
  is(app.openState(), "noprogram", "with nothing imported the date has no state to resolve");
  is(app.nextScheduled(today), null, "and there is no next session");
}

console.log("\nthe derived schedule");
{
  /* Nothing in tp-program-2 carries a date, so the whole calendar hangs off one anchor
     plus a weekday read out of each day label. Every case below is a documented
     fallback in docs/date-first-revamp.md, in that order. */
  const prog = loadFixture("program.v2.sample.json");
  const sched = app.SCHEDULE;
  assert(!!sched, "loading a programme derives a schedule");
  is(sched.days.map(d => d.weekday), [1, 2],
    "the weekday is parsed out of a real day label's parenthetical");
  is(app.weekdayOf(sched.anchorMonday), 1, "the anchor is always a Monday");
  is(sched.anchorMonday, app.mondayOf(app.todayISO()),
    "and defaults to the Monday of the week the programme was imported");
  is(JSON.parse(store.get("tp_schedule_v1")).anchorMonday, sched.anchorMonday,
    "the resolved anchor is persisted, so it keeps meaning 'imported' rather than 'now'");
  is(sched.weeks, 4, "the schedule knows how many weeks the block runs");

  /* Round-trip, and specifically across a month boundary — the place naive date maths
     breaks. Anchored on a Monday late in January, week 2 Tuesday lands in February. */
  app.setAnchorMonday("2026-01-26");
  is(app.SCHEDULE.anchorMonday, "2026-01-26", "the anchor can be moved in one call");
  const d1 = prog.meta.days[0], d2 = prog.meta.days[1];
  is(app.dateFor(1, d1), "2026-01-26", "week 1 day 1 is the anchor itself");
  is(app.dateFor(2, d2), "2026-02-03", "week 2 day 2 crosses into the next month");
  is(app.scheduleForDate("2026-02-03"), { week: 2, day: d2 },
    "and reading that date back gives the same (week, day)");
  is(app.dateFor(4, d2), "2026-02-17", "the last week of the block still resolves");
  is(app.scheduleForDate("2026-02-17"), { week: 4, day: d2 }, "and round-trips");
  /* Every (week, day) in the block, both directions. */
  let roundTripped = 0, brokeAt = null;
  for(let w = 1; w <= app.SCHEDULE.weeks; w++) for(const day of [d1, d2]){
    const iso = app.dateFor(w, day);
    const back = app.scheduleForDate(iso);
    if(back && back.week === w && back.day === day) roundTripped++;
    else brokeAt = brokeAt || `${w} / ${day} -> ${iso}`;
  }
  is([roundTripped, brokeAt], [app.SCHEDULE.weeks * 2, null],
    "every (week, day) in the block round-trips through its date");

  /* Outside the block, and on a weekday the programme doesn't train: null, not a guess. */
  is(app.scheduleForDate("2026-01-25"), null, "a date before the anchor has nothing on it");
  is(app.scheduleForDate("2026-01-28"), null, "an untrained weekday is a rest day, not a session");
  is(app.scheduleForDate("2026-03-30"), null, "a date past the last week has nothing on it");
  is(app.dateFor(1, "Day 9 (Sun) - not in this program"), "",
    "a day this programme does not have resolves to no date");

  /* A leap day is a real calendar day and must not be skipped or doubled. */
  app.setAnchorMonday("2024-02-26");
  is(app.dateFor(1, d2), "2024-02-27", "…");
  is(app.dateFor(2, d1), "2024-03-04", "a week spanning 29 February advances exactly seven days");
}

console.log("\nschedule fallbacks: unlabelled days, and no programme at all");
{
  /* Second fallback exhausted: no label parses. Distribute across consecutive weekdays
     from Monday, which is the documented behaviour — a programme whose labels carry no
     weekday must still import and be trainable. */
  const days = ["Session A - Lower", "Session B - Upper", "Session C - Conditioning"];
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Unlabelled", athlete: "Sample",
    athleteId: "sample", weeks: 2, days },
    exercises: days.map((day, i) => ({ id: `w1d${i + 1}e1`, week: 1, day, name: "Squat",
      sets: "3", reps: "5", load: "100", rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" })) });
  is(app.SCHEDULE.days.map(d => d.weekday), [1, 2, 3],
    "days with no readable weekday are distributed from Monday");
  app.setAnchorMonday("2026-01-05");
  is(app.dateFor(1, days[2]), "2026-01-07", "so they still resolve to real dates");

  /* Mixed: the labels that DO parse keep their weekday, and the rest fill the gaps
     rather than flattening the whole programme back to Mon/Tue/Wed. */
  const mixed = ["Day 1 (Mon) - Lower", "Day 2 - Upper", "Day 3 (Thu) - Skill", "Day 4 - Row"];
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Mixed", athlete: "Sample",
    athleteId: "sample", weeks: 1, days: mixed },
    exercises: mixed.map((day, i) => ({ id: `w1d${i + 1}e1`, week: 1, day, name: "Squat",
      sets: "3", reps: "5", load: "100", rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" })) });
  is(app.SCHEDULE.days.map(d => d.weekday), [1, 2, 4, 3],
    "a partly-labelled programme keeps the weekdays it declares and fills the gaps");

  /* First fallback: structured fields, which nothing emits yet. Adding them later must
     be a no-op in the app, so the reader accepts them now. */
  const structured = [{ label: "Session A - Lower", weekday: 3 },
                      { label: "Session B - Upper", weekday: "Saturday" }];
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Structured", athlete: "Sample",
    athleteId: "sample", weeks: 1, startDate: "2026-03-11", days: structured },
    exercises: [{ id: "w1d1e1", week: 1, day: "Session A - Lower", name: "Squat",
      sets: "3", reps: "5", load: "100", rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" }] });
  is(app.SCHEDULE.days.map(d => d.weekday), [3, 6],
    "a declared weekday is used ahead of anything parsed, as a number or a name");
  is(app.SCHEDULE.anchorMonday, "2026-03-09",
    "meta.startDate anchors the block to the Monday of its own week");
  is(app.dateFor(1, "Session A - Lower"), "2026-03-11", "and the declared weekdays resolve");

  /* "Monostructural" is not Monday. */
  is(app.parseWeekday("Day 2 (Tue) - Monostructural grind"), 2,
    "a weekday word inside another word is not mistaken for a weekday");
  is(app.parseWeekday("Day 1 (Mon) - Sunday long grind"), 1,
    "the parenthetical convention wins over a weekday word elsewhere in the label");
  is(app.parseWeekday("Day 3 Thursday - Snatch"), 4, "a bare weekday word is read too");

  /* No programme loaded is one of the honest date states, not an error. */
  app.PROGRAM = null; app.refreshSchedule();
  is(app.SCHEDULE, null, "with no programme there is no schedule");
  is(app.dateFor(1, "Day 1 (Mon) - anything"), "", "and no date resolves");
  is(app.scheduleForDate(app.todayISO()), null, "and no date has anything on it");
  is(app.setAnchorMonday("2026-01-05"), "", "and the anchor cannot be set");
}

console.log("\nsession lifecycle state, read tolerantly");
{
  const prog = loadFixture("program.v2.sample.json");
  const day = prog.meta.days[0];

  /* A record already on a phone has none of the new keys. Absent status means OPEN: a
     session written before sealing existed cannot have been sealed, and reading it as
     anything else would flip the calendar's account of a day already finished.
     Written straight into storage and then OPENED by date, which is how it would really
     arrive — and the index has to be dropped, exactly as the app's own writes do. */
  const legacyKey = "tp_sess_v1::2026-05-04::" + day;
  store.set(legacyKey, JSON.stringify({ block: "x", athlete: "y", week: 1, day,
    date: "2026-05-04", session: { readiness: "Green" },
    entries: { [prog.exercises[0].id]: { done: true, load: "100", reps: "5", rpe: "7",
      painDuring: "1", notes: "", sets: [{ set: 1, load: "100", reps: "5", rpe: "7",
        painDuring: "1", note: "" }] } } }));
  app.invalidateSessionIndex();
  app.openDate("2026-05-04");
  is([app.STATE.day, app.STATE.week], [day, 1],
    "a session already on the phone is found by its date and its claim adopted");
  const legacy = app.getSession();
  is(legacy.status, "open", "a stored session with no status reads as open");
  is([legacy.sealedAt, legacy.exportedAt, legacy.lastSetAt], ["", "", ""],
    "and the other lifecycle fields default to empty rather than undefined");
  is(legacy.session.readiness, "Green", "without losing what was already logged");
  is(legacy.entries[prog.exercises[0].id].sets.length, 1, "or the sets that were committed");
  assert(!app.sealed(legacy), "so it is not treated as sealed");

  /* Sealing is a stored fact, and editing a sealed session must not un-seal it. */
  legacy.status = "sealed"; legacy.sealedAt = "2026-05-04T18:00:00.000Z";
  app.saveSession(legacy);
  const reread = app.getSession();
  assert(app.sealed(reread), "a sealed session reads back as sealed");
  is(reread.sealedAt, "2026-05-04T18:00:00.000Z", "with the time it was sealed");

  /* A garbage status is not a third state. */
  store.set(legacyKey, JSON.stringify({ ...reread, status: "finished-ish" }));
  is(app.getSession().status, "open", "an unrecognised status falls back to open");

  /* exportedAt vs editedAt: information the app has never had before. */
  const s = app.getSession();
  s.status = "sealed"; s.exportedAt = "2026-05-04T18:00:00.000Z";
  s.editedAt = "2026-05-04T17:00:00.000Z";
  assert(!app.editedSinceExport(s), "a session exported after its last edit is not stale");
  app.saveSession(s);
  assert(app.editedSinceExport(app.getSession()),
    "but any later edit makes the exported file stale, without un-sealing the session");
  assert(app.sealed(app.getSession()), "editing a sealed session leaves it sealed");
}

console.log("\nthe session index");
{
  const prog = loadFixture("program.v2.sample.json");
  const day1 = prog.meta.days[0], day2 = prog.meta.days[1];
  const first = prog.exercises.find(e => e.day === day1);

  /* Log the same exercise on two earlier dates, then open a third. */
  const logOn = (date, load) => {
    app.selectDate(date); app.selectDay(day1);
    const c = logCardNode();
    const inputs = setInputs(c);
    type(inputs[0], load); type(inputs[1], "5");
    actionBtn(c, /^Log set|^Log final/).onclick();
  };
  logOn("2026-05-04", "100");
  logOn("2026-05-11", "105");
  app.selectDate("2026-05-18");

  is(app.sessionsOn("2026-05-11").length, 1, "a stored session is indexed on its date");
  is(app.sessionsOn("2026-05-11")[0].day, day1, "with the day it was logged against");
  is(app.sessionsOn("2026-05-13").length, 0, "a date with nothing stored resolves to nothing");

  const last = app.lastLoggedFor(first, "2026-05-18");
  is(last && last.date, "2026-05-11", "'last time' is the most recent EARLIER session");
  is(last && last.sets[0].load, "105", "and carries what was actually logged");
  const earlier = app.lastLoggedFor(first, "2026-05-11");
  is(earlier && earlier.date, "2026-05-04", "asking from an earlier date walks further back");
  is(app.lastLoggedFor(first, "2026-05-04"), null,
    "and the first session in the block has nothing before it");

  /* Matching survives a re-generated programme: same names, new ids. */
  const renamedIds = JSON.parse(JSON.stringify(prog));
  renamedIds.exercises.forEach((e, i) => { e.id = "regen-" + i; });
  const regen = renamedIds.exercises.find(e => e.day === day1);
  const byName = app.lastLoggedFor(regen, "2026-05-18");
  is(byName && byName.date, "2026-05-11",
    "a re-generated programme still finds last time by normalised name");
  is(app.lastLoggedFor({ id: "nope", name: "Nothing ever logged" }, "2026-05-18"), null,
    "an exercise never logged returns nothing rather than an empty row");

  /* It is a cache. Every write must drop it, or the calendar goes stale mid-block. */
  app.selectDate("2026-05-18"); app.selectDay(day2);
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "60"); type(inputs[1], "8");
  actionBtn(c, /^Log set|^Log final/).onclick();
  is(app.sessionsOn("2026-05-18").length, 1,
    "a session logged after the index was read appears immediately");

  /* The demo namespace is separate storage, so it must be a separate index. */
  app.APP.source = "sample"; app.invalidateSessionIndex();
  is(app.sessionsOn("2026-05-11").length, 0, "sample mode never sees personal sessions");
  app.APP.source = "personal"; app.invalidateSessionIndex();
  is(app.sessionsOn("2026-05-11").length, 1, "and personal sessions come back");
}

console.log("\nthe rest clock's timestamp");
{
  const prog = loadFixture("program.v2.sample.json");
  app.selectDay(prog.meta.days[0]);
  is(app.getSession().lastSetAt, "", "a session with nothing logged has no last-set time");
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "100"); type(inputs[1], "5");
  actionBtn(c, /^Log set|^Log final/).onclick();
  const stamped = app.getSession().lastSetAt;
  assert(/^\d{4}-\d{2}-\d{2}T/.test(stamped), "committing a set stamps lastSetAt");
  /* Session-level on purpose: the clock is "time since you last logged anything", which
     is what you want between exercises as well as between sets. It survives a reload
     because it is stored, and nothing in the log path reads it back. */
  is(app.getSession().lastSetAt, stamped, "and it is stored, so it survives a reload");
}

console.log("\nthe date view: one date, one action, and a claim picker");
{
  const today = app.todayISO();
  const wd = app.weekdayOf(today);
  const d1 = `Day 1 (${app.weekdayShort(wd)}) - Squat day`;
  const d2 = `Day 2 (${app.weekdayShort(wd % 7 + 1)}) - Press day`;
  store.clear(); ACTIVE_ELEMENT = null; app.SETTINGS = { ...app.SET_DEFAULTS };
  const rows = [];
  for(let w = 1; w <= 4; w++) for(const day of [d1, d2])
    rows.push({ id: `w${w}${day === d1 ? "d1" : "d2"}e1`, week: w, day,
      name: day === d1 ? "Back squat" : "Strict press", sets: "2", reps: "5",
      load: String(90 + w * 5), rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" });
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Dated", athlete: "Sample",
    athleteId: "sample", weeks: 4, days: [d1, d2] }, exercises: rows });
  app.setView("list");

  const head = () => cards().find(c => c.classList.contains("datehead"));
  const headText = () => { const h = head(); return h ? h.text : ""; };
  const foot = () => cards().find(c => c.classList.contains("datefoot"));

  assert(!!head(), "the date view leads with the date, not with an exercise");
  is(head().getAttribute("data-state"), "start", "…in the state the date resolves to");
  assert(/Today/.test(headText()), "today is named as today");
  assert(/Week 1/.test(headText()), "with the week the schedule puts it in");
  assert(!!buttonOf(head(), /^Start session$/), "and one primary action: Start");
  assert(!foot(), "nothing is offered to finish before anything has started");

  /* The check-in is above the list and below the action, so it never gates Start. */
  const order = cards().map(c => c.className);
  const iHead = order.findIndex(c => /datehead/.test(c));
  const ids = cards().map(c => c.id || "");
  const iCheck = ids.indexOf("checkinHost");
  const iCard = order.findIndex(c => /card ov/.test(c));
  assert(iHead === 0, "the head is first");
  assert(iCheck > iHead && iCheck < iCard,
    `the check-in sits between the action and the exercise list (${JSON.stringify(order)})`);
  assert(!head().findAll(n => n.tagName === "INPUT").length,
    "and the head itself has no inputs on it");

  /* Start writes the session, which is what makes the date a claim. */
  buttonOf(head(), /^Start session$/).onclick();
  is(app.SETTINGS.view, "focus", "Start drops straight into the logger");
  app.setView("list");
  is(head().getAttribute("data-state"), "resume", "and the date now reads as in progress");
  assert(!!buttonOf(head(), /^Resume logging$/), "offering Resume");
  assert(!!buttonOf(foot(), /^Finish session$/), "with Finish at the end of the list");

  /* Finish seals, behind a confirmation that says what will be kept. */
  buttonOf(foot(), /^Finish session$/).onclick();
  assert(/0 of 1 exercises are marked done/.test(stubFor("#sheetCopy").text),
    `the confirmation says exactly what is being recorded (got ${JSON.stringify(stubFor("#sheetCopy").text)})`);
  sheetButton(/^Finish session$/).onclick();
  is(head().getAttribute("data-state"), "review", "the date is now a sealed session");
  assert(/Finished/.test(headText()), "which it says out loud");
  assert(/not exported yet/.test(headText()), "including that the file has not been made");
  assert(!buttonOf(head(), /Start|Resume/), "with no Start or Resume left to offer");
  assert(!!buttonOf(head(), /^Log more$/), "but editing is still one tap away");

  /* Editing a sealed session does not un-seal it. */
  const s = app.getSession();
  s.session.overall = "knee quiet throughout";
  app.saveSession(s);
  app.renderMain();
  is(head().getAttribute("data-state"), "review", "an edit leaves the date sealed");

  /* Reopen is deliberate, and behind its own confirmation. */
  buttonOf(head(), /^Reopen day$/).onclick();
  sheetButton(/^Reopen day$/).onclick();
  is(head().getAttribute("data-state"), "resume", "reopening is available for a mis-tap");

  /* The claim picker: week and day together, current selection preselected. */
  buttonOf(head(), /Doing a different day\?/).onclick();
  const sheet = stubFor("#sheetBody");
  assert(/the schedule suggests Week 1/.test(stubFor("#sheetCopy").text),
    "the picker says what the schedule suggests");
  assert(/Nothing is moved/.test(stubFor("#sheetCopy").text),
    "and that claiming moves nothing — there is no such operation");
  const weekVal = () => sheet.findAll(n => n.classList.contains("stepval"))[0].text;
  is(weekVal(), "Week 1", "the week starts where the date already is");
  const dayBtns = () => sheet.findAll(n => n.classList.contains("dayitem"));
  is(dayBtns().length, 2, "every day of the programme is offered");
  is(dayBtns().map(b => b.getAttribute("aria-pressed")), ["true", "false"],
    "with the day already open preselected");
  sheet.findAll(n => n.classList.contains("stepbtn"))[1].onclick();
  is(weekVal(), "Week 2", "the week steps");
  dayBtns()[1].onclick();
  is(dayBtns().map(b => b.getAttribute("aria-pressed")), ["false", "true"], "and the day picks");
  const go = sheet.findAll(n => n.classList.contains("primary"))
    .find(b => /^Train Week/.test(b.text));
  is(go.text, "Train Week 2 · D2", "the confirm names both halves of the claim");
  go.onclick();
  is([app.STATE.week, app.STATE.day], [2, d2], "confirming claims week AND day together");
  is(app.dayExercises().map(e => e.load), ["100"], "so the prescriptions follow the week");
  is(app.openState(), "start", "and the new day has nothing stored yet");
  is(app.sessionsOn(today).length, 1, "while the session already on this date is untouched");

  /* A scheduled date that has passed with nothing logged stays not-done: greyed and
     quiet, never red, never rolled forward. Move the anchor back a fortnight so there
     are passed dates inside the block at all. */
  app.setAnchorMonday(app.addDays(app.mondayOf(today), -14));
  app.openDate(app.addDays(today, -7));
  is(head().getAttribute("data-state"), "start", "a passed scheduled date is still just 'not done'");
  assert(!!buttonOf(head(), /^Log it late$/), "and offers to be logged late");
  assert(/days ago|Yesterday/.test(headText()), "saying how far back it is");
  is(app.STATE.week, 2, "at the week the schedule puts that date in");

  /* A rest day: no action, but the next session and the picker. */
  app.openDate(nonTrainingDate(app, [d1, d2]));
  is(head().getAttribute("data-state"), "rest", "an untrained weekday is a rest day");
  assert(/Rest day/.test(headText()), "and says so");
  assert(!buttonOf(head(), /Start|Resume|Log it late/), "with no session action at all");
  assert(/Next session/.test(headText()), "but it points at the next one");
  assert(!!buttonOf(head(), /Doing a different day\?/), "and the picker is still there");
  assert(!checkinCard(), "a rest day has no check-in to fill");
  assert(!foot(), "and nothing to finish");
}

console.log("\nexport records that the session left the phone");
{
  const prog = loadFixture("program.v2.sample.json");
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "100"); type(inputs[1], "5");
  actionBtn(c, /^Log set|^Log final/).onclick();
  is(app.getSession().exportedAt, "", "a session that has never been exported says so");

  app.exportSession();
  const at = app.getSession().exportedAt;
  assert(/^\d{4}-\d{2}-\d{2}T/.test(at), "a successful export stamps exportedAt");
  assert(!app.editedSinceExport(app.getSession()), "and is not itself an edit");

  /* Copy JSON is the fallback when the download fails, and also how the JSON gets
     looked at — neither is a file on disk, so it claims nothing. */
  const s = app.getSession();
  s.session.overall = "second look";
  app.saveSession(s);
  assert(app.editedSinceExport(app.getSession()), "a later edit marks the file stale");
  app.setView("list");
  assert(/edited since export/.test(cards().find(c => c.classList.contains("datehead")).text) ||
         app.openState() !== "review",
    "which the date view says while the session is sealed");
  app.sealSession();
  app.renderMain();
  assert(/edited since export/.test(cards().find(c => c.classList.contains("datehead")).text),
    "…and does say, once it is");
}

console.log("\nthe hub: today first, the last few sessions, rows to everything else");
{
  const today = app.todayISO();
  const wd = app.weekdayOf(today);
  const d1 = `Day 1 (${app.weekdayShort(wd)}) - Squat day`;
  const d2 = `Day 2 (${app.weekdayShort(wd % 7 + 1)}) - Press day`;
  store.clear(); ACTIVE_ELEMENT = null; app.SETTINGS = { ...app.SET_DEFAULTS };
  const rows = [];
  for(let w = 1; w <= 4; w++) for(const day of [d1, d2])
    rows.push({ id: `w${w}${day === d1 ? "d1" : "d2"}e1`, week: w, day,
      name: day === d1 ? "Back squat" : "Strict press", sets: "2", reps: "5",
      load: String(90 + w * 5), rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" });
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Hub block", athlete: "Sample",
    athleteId: "sample", weeks: 4, days: [d1, d2] }, exercises: rows });

  const home = () => { app.renderHome(); return stubFor("#homeBody"); };
  const homeText = () => home().text;
  const homeBtn = re => home().findAll(n => n.tagName === "BUTTON").find(b => re.test(b.text));
  const rowTitles = () => home().findAll(n => n.classList.contains("hr-title")).map(n => n.text);

  assert(/Hub block/.test(homeText()), "the hub names the block it is for");
  assert(/Today/.test(homeText()), "and always shows today, never the next thing");
  assert(/Week 1/.test(homeText()), "with what is on today");
  assert(!!homeBtn(/^Start session$/), "one primary action: Start");
  is(rowTitles().slice(-3), ["Calendar", "Programme", "Account"],
    "and one row each to the calendar, the programme and the account");
  /* Sync state is a line inside Account, never a badge here. */
  assert(!/queued|conflict|Syncing/.test(homeText()),
    "no sync badge competes with today's session for attention");

  /* Start from the hub lands on that date's own view. */
  homeBtn(/^Start session$/).onclick();
  is(app.APP.route, "date", "the hub's primary action opens the date");
  is(app.STATE.date, today, "…which is today");
  app.startSession();
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "97.5"); type(inputs[1], "5");
  actionBtn(c, /^Log set|^Log final/).onclick();
  assert(/Resume/.test(homeText()), "an open session turns the hub's action into Resume");
  assert(/1 of 1 done|0 of 1 done/.test(homeText()), "with how far through it is");

  app.sealSession();
  assert(!!homeBtn(/^Review$/), "a sealed session turns it into Review");

  /* Recent sessions appear inline, newest first, and never include today. */
  const s1 = "tp_sess_v1::" + app.addDays(today, -7) + "::" + d1;
  const s2 = "tp_sess_v1::" + app.addDays(today, -14) + "::" + d2;
  const s3 = "tp_sess_v1::" + app.addDays(today, -21) + "::" + d1;
  const body = (date, day, week, status) => JSON.stringify({ block: "Hub block",
    athlete: "Sample", week, day, date, status,
    session: {}, entries: { [`w${week}${day === d1 ? "d1" : "d2"}e1`]:
      { done: true, sets: [{ set: 1, load: "100", reps: "5", rpe: "7", painDuring: "", note: "" }] } } });
  store.set(s1, body(app.addDays(today, -7), d1, 3, "sealed"));
  store.set(s2, body(app.addDays(today, -14), d2, 2, "open"));
  store.set(s3, body(app.addDays(today, -21), d1, 1, "sealed"));
  app.invalidateSessionIndex();
  const recent = app.recentSessions(3, today).map(r => r.date);
  is(recent, [app.addDays(today, -7), app.addDays(today, -14), app.addDays(today, -21)],
    "the last three sessions are newest first");
  assert(!recent.includes(today), "and never repeat the date the hub already shows");
  assert(/Recent/.test(homeText()), "they are inline on the hub, not a destination");
  const recentRow = home().findAll(n => n.classList.contains("homerow"))
    .find(b => new RegExp(app.fmtDateLong(app.addDays(today, -7)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(b.text));
  assert(!!recentRow, "each is a row you can open");
  recentRow.onclick();
  is(app.STATE.date, app.addDays(today, -7), "which opens that date");
  is(app.STATE.week, 3, "at the week it was claimed for");

  /* A rest day: no action, but the next session and the missed one behind. */
  const restProgram = { meta: { schema: "tp-program-2", block: "Rest block",
    athlete: "Sample", athleteId: "sample", weeks: 4, days: [d2] },
    exercises: [{ id: "w1d2e1", week: 1, day: d2, name: "Press", sets: "2", reps: "5",
      load: "60", rpe: "RPE 7", tempo: "", rest: "", logHint: "", focus: "", progression: "" }] };
  store.clear(); app.loadProgram(restProgram);
  app.setAnchorMonday(app.addDays(app.mondayOf(today), -7));
  is(app.dateStateOf(today).kind, "rest", "today is a rest day for this programme");
  assert(/Rest day/.test(homeText()), "the hub says so");
  assert(!homeBtn(/^Start session$|^Resume$|^Review$/), "with no session action");
  assert(/Next session/.test(homeText()), "but points at the next one");
  const missed = app.lastMissed(today);
  assert(!!missed, "and finds the scheduled day just behind, unlogged");
  assert(!!homeBtn(/^Log .* late$/), "offering to log it late");
  homeBtn(/^Log .* late$/).onclick();
  is(app.STATE.date, missed.date, "which opens that date");

  /* Once the last scheduled day HAS been trained, nothing is offered — a missed date
     stays quiet, and this is an offer rather than a list of accusations. */
  app.startSession();
  is(app.lastMissed(today), null, "a trained last-scheduled-day silences the offer");

  /* No programme is a state, not an error. */
  app.PROGRAM = null; app.refreshSchedule(); app.invalidateSessionIndex();
  assert(/No programme loaded/.test(homeText()), "no programme is an honest hub state");
  assert(!!homeBtn(/^Import a programme$/), "with the one action that fixes it");
}

console.log("\nthe calendar: every date resolves to exactly one state");
{
  const today = app.todayISO();
  const wd = app.weekdayOf(today);
  const d1 = `Day 1 (${app.weekdayShort(wd)}) - Squat day`;
  store.clear(); ACTIVE_ELEMENT = null; app.SETTINGS = { ...app.SET_DEFAULTS };
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Cal", athlete: "Sample",
    athleteId: "sample", weeks: 3, days: [d1] },
    exercises: [1, 2, 3].map(w => ({ id: `w${w}d1e1`, week: w, day: d1, name: "Back squat",
      sets: "2", reps: "5", load: "100", rpe: "RPE 7", tempo: "", rest: "", logHint: "",
      focus: "", progression: "" })) });

  /* Sessions already in localStorage — written by an older build, with no status and no
     new keys — must appear on their correct dates with NO migration. This is the whole
     justification for keeping the existing tp_sess_v1::<date>::<day> key. */
  const oldDate = app.addDays(today, -7);
  store.set(`tp_sess_v1::${oldDate}::${d1}`, JSON.stringify({ block: "Cal", athlete: "Sample",
    week: 2, day: d1, date: oldDate, session: { amPainOnWaking: "5" },
    entries: { w2d1e1: { done: true, load: "100", reps: "5", rpe: "7", painDuring: "1",
      notes: "", sets: [{ set: 1, load: "100", reps: "5", rpe: "7", painDuring: "1", note: "" }] } } }));
  app.invalidateSessionIndex();
  is(app.sessionsOn(oldDate).length, 1, "a pre-existing session is found on its own date");
  is(app.calendarMark(oldDate), "part", "and marked as logged but not finished");

  is(app.calendarMark(today), "scheduled", "a scheduled date with nothing on it is 'scheduled'");
  is(app.calendarMark(app.addDays(today, 1)), "none", "an untrained weekday has no mark");
  app.gotoDate(today, "calendar");
  app.startSession();
  is(app.calendarMark(today), "claimed", "a started session with nothing logged is 'claimed'");
  const c = logCardNode();
  const inputs = setInputs(c);
  type(inputs[0], "100"); type(inputs[1], "5");
  actionBtn(c, /^Log set|^Log final/).onclick();
  is(app.calendarMark(today), "part", "logging turns it into 'part'");
  app.sealSession();
  is(app.calendarMark(today), "sealed", "and finishing into 'sealed'");
  is(app.calendarMark(app.addDays(today, -400)), "none", "a date far outside the block is plain");

  /* Exactly one state, for every date in a two-month sweep. */
  const seen = new Set();
  let bad = null;
  for(let i = -30; i <= 30; i++){
    const iso = app.addDays(today, i);
    const mark = app.calendarMark(iso);
    seen.add(mark);
    if(!["sealed", "part", "claimed", "scheduled", "none"].includes(mark)) bad = iso + " -> " + mark;
    const kind = app.dateStateOf(iso).kind;
    if(!["noprogram", "rest", "start", "resume", "review"].includes(kind))
      bad = bad || iso + " -> " + kind;
  }
  is(bad, null, "every date over two months resolves to one known state");
  assert(seen.has("scheduled") && seen.has("none") && seen.has("sealed"),
    `and the sweep actually covers several of them (${[...seen].join(", ")})`);

  /* The pain tick is gated on the athlete tracking it at all: no mark, and no legend
     entry, for someone who doesn't — not a greyed one. */
  is(app.calendarPain(oldDate), 5, "a pain-on-waking reading above zero shows on the calendar");
  app.SETTINGS.painOnWaking = false;
  is(app.calendarPain(oldDate), 0, "an athlete who does not track it sees no mark");
  const legendOff = app.calendarLegend().text;
  app.SETTINGS.painOnWaking = true;
  const legendOn = app.calendarLegend().text;
  assert(/on waking/.test(legendOn) && !/on waking/.test(legendOff),
    "…and no legend entry either");

  /* The calendar renders, covers the block plus a week either side, and the week labels
     name the block's weeks. */
  app.renderCalendar();
  const page = stubFor("#pageBody");
  const cells = page.findAll(n => n.classList.contains("cal-cell"));
  const weeks = page.findAll(n => n.classList.contains("cal-week")).map(n => n.text);
  assert(cells.length >= 35, `the calendar is a continuous scroll of weeks (${cells.length} cells)`);
  is(cells.length % 7, 0, "always whole weeks");
  assert(weeks.includes("W1") && weeks.includes("W3"), "labelled W1–Wn across the block");
  assert(weeks.includes("·"), "with dates outside the block still present but plain");
  is(page.findAll(n => n.classList.contains("cal-dow")).map(n => n.text),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "one column per weekday, Monday first");
  const todayCells = cells.filter(n => n.getAttribute("data-today") === "true");
  is(todayCells.length, 1, "exactly one cell is today");
  todayCells[0].onclick();
  is([app.APP.route, app.STATE.date, app.APP.from], ["date", today, "calendar"],
    "tapping a date opens it, and remembers it came from the calendar");
  app.backFromDate();
  is(app.APP.route, "calendar", "so back returns to the calendar rather than the hub");
}

console.log("\nrouting: five surfaces, one place that decides");
{
  const seen = {};
  ["entry", "home", "calendar", "date", "programme", "account"].forEach(route => {
    app.showRoute(route);
    seen[route] = {
      entry: !stubFor("#profileView").hidden, home: !stubFor("#homeView").hidden,
      page: !stubFor("#pageView").hidden, date: !stubFor("#workoutView").hidden
    };
  });
  is(seen.entry, { entry: true, home: false, page: false, date: false }, "the gate stands alone");
  is(seen.home, { entry: false, home: true, page: false, date: false }, "so does the hub");
  is(seen.calendar, { entry: false, home: false, page: true, date: false },
    "the calendar shares the page chrome");
  is(seen.programme, { entry: false, home: false, page: true, date: false }, "so does Programme");
  is(seen.account, { entry: false, home: false, page: true, date: false }, "and Account");
  is(seen.date, { entry: false, home: false, page: false, date: true }, "and the date view is its own");
  app.showRoute("nonsense");
  is(app.APP.route, "entry", "an unknown route falls back to the gate rather than showing nothing");
  app.showRoute("date");
  is(app.APP.surface, "workout", "the older `surface` question still answers correctly");
  app.showRoute("home");
  is(app.APP.surface, "profile", "…in both directions");
}

console.log("\nthe focus logger: the instruments, and the regressions this can reintroduce");
{
  const prog = loadFixture("program.v2.sample.json");
  const exs = app.dayExercises();
  const first = exs[0];

  /* ---- the reported regressions, first, because this phase can bring each one back ---- */
  const c = logCardNode();
  const inputs = setInputs(c);
  const rpe = c.findAll(n => n.classList.contains("pickerbtn"))[0];
  assert(!!rpe, "RPE is still a picker, not a keyboard field");
  /* Typing a full 7.5 through the picker must not move focus or rebuild the row. */
  ACTIVE_ELEMENT = inputs[0];
  inputs[0].value = "100"; inputs[0].oninput();
  is(ACTIVE_ELEMENT, inputs[0], "an oninput never moves focus off the field it fired from");
  is(setInputs(exCards()[0])[0], inputs[0],
    "and never replaces the input node — the old focus-loss bug");
  chooseRpe(c, 7.5);
  is(app.getSession().entries[first.id].draft.rpe, "7.5",
    "a half-point RPE is stored exactly as picked");

  /* metricOf() still drives the reps field: a 45-second hold must not get a digits-only
     keypad, and the label has to say what the number means. */
  const holdEx = { name: "Spanish squat isometric", sets: "3", reps: "45 sec" };
  is(app.metricOf(holdEx).fieldLabel, "Hold (s)", "a 45-second hold is a Hold, in seconds");
  is(app.metricOf(holdEx).placeholder, "45", "with the prescription as its placeholder");
  is(app.metricOf({ reps: "8-10 min" }).fieldLabel, "Time (min)", "a warm-up is minutes");
  is(app.metricOf({ reps: "20 m" }).fieldLabel, "Dist (m)", "a sled drag is metres");
  is(app.metricOf({ reps: "5 cleans + 15 cal bike" }).inputmode, "text",
    "and prose gets a full keyboard, never a numeric keypad");
  const holdCard = (() => {
    loadSynthetic([{ name: "Spanish squat isometric", sets: "3", reps: "45 sec" }]);
    return logCardNode();
  })();
  const holdInput = setInputs(holdCard)[1];
  is(holdInput.getAttribute("inputmode"), "decimal",
    "the rendered field opens a keyboard that can type a decimal, not a digits-only pad");
  is(holdInput.getAttribute("placeholder"), "45", "…with the prescribed hold in it");

  /* ---- the rest clock ---- */
  loadFixture("program.v2.sample.json");
  is(app.parseRestSeconds({ rest: "90 sec" }), 90, "a rest in seconds is read as seconds");
  is(app.parseRestSeconds({ rest: "2.5-3 min" }), 150,
    "a range takes its lower bound — the mark is 'you may go', not 'you must wait'");
  is(app.parseRestSeconds({ rest: "EMOM / 90 sec" }), 90, "and prose around it is ignored");
  is(app.parseRestSeconds({ rest: "~90 sec between rounds" }), 90, "…in either direction");
  is(app.parseRestSeconds({ rest: "1 min easy between" }), 60, "minutes too");
  /* A unit is REQUIRED: guessing at a bare number would read 90 as an hour and a half. */
  is(app.parseRestSeconds({ rest: "90" }), 0, "a bare number is never guessed at");
  is(app.parseRestSeconds({ rest: "-" }), 0, "and prose simply leaves the clock unmarked");
  is(app.parseRestSeconds({ rest: "Included" }), 0, "…as does 'Included'");
  is(app.parseRestSeconds({}), 0, "…and a missing rest");

  is(app.restSeconds({ lastSetAt: "" }), null,
    "with nothing logged there is no rest to show — not zero");
  is(app.restSeconds({ lastSetAt: "not a date" }), null, "corrupt storage shows nothing");
  const t0 = Date.parse("2026-05-04T10:00:00.000Z");
  is(app.restSeconds({ lastSetAt: "2026-05-04T10:00:00.000Z" }, t0 + 95000), 95,
    "otherwise it is exactly now minus lastSetAt");
  is(app.fmtClock(95), "1:35", "shown as minutes and seconds");
  is(app.fmtClock(0), "0:00", "including the moment a set lands");
  is(app.fmtClock(605), "10:05", "and past ten minutes");

  /* It is stored, so it survives a reload, a backgrounded tab and a killed PWA — there
     is no timer state to lose. */
  const card = logCardNode();
  const ins = setInputs(card);
  type(ins[0], "100"); type(ins[1], "5");
  actionBtn(card, /^Log set|^Log final/).onclick();
  const stamped = app.getSession().lastSetAt;
  assert(/^\d{4}-\d{2}-\d{2}T/.test(stamped), "committing a set stamps the clock's origin");
  const clock = exCards()[0].findAll(n => n.classList.contains("restclock"))[0];
  assert(!!clock, "the logger shows a rest clock");
  assert(!clock.hidden, "…once something has been logged");
  assert(/^\d+:\d{2}$/.test(clock.findAll(n => n.classList.contains("rc-value"))[0].text),
    "reading as a clock");
  /* Reload: fresh STATE, same storage. The clock comes back because it is derived. */
  app.STATE = { week: app.STATE.week, day: app.STATE.day, date: app.STATE.date,
    focus: 0, setEdit: null };
  app.invalidateSessionIndex();
  is(app.getSession().lastSetAt, stamped, "and it is still there after a reload");
  /* Nothing in the log path reads it, so it can never interfere with logging. The
     payload's own `exportedAt` is stamped at build time, so it is the one key that
     legitimately differs between two builds. */
  const payload = () => { const p = app.buildSessionExport(); delete p.exportedAt;
    return JSON.stringify(p); };
  const before = payload();
  app.getSession();
  is(payload(), before, "and it never reaches an export or changes one");
  assert(!/lastSetAt|sealedAt|editedAt|"status"/.test(before),
    "…nor do any of the other lifecycle fields");

  /* ---- "last time" ---- */
  /* Its own programme, with a genuinely multi-set exercise: the fixture's day 1 opens
     with a one-set warm-up, and one commit there finishes the exercise and advances. */
  const day1 = "Day 1 (Mon) - Squat day";
  store.clear(); app.SETTINGS = { ...app.SET_DEFAULTS };
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Last time", athlete: "Sample",
    athleteId: "sample", weeks: 2, days: [day1] },
    exercises: [1, 2].map(w => ({ id: `w${w}d1e1`, week: w, day: day1, name: "Back squat",
      sets: "4", reps: "5", load: "100", rpe: "RPE 7", tempo: "", rest: "2-3 min",
      logHint: "", focus: "", progression: "" })) });
  app.openDate("2026-06-01"); app.applyClaim(1, day1);
  const log = (load, reps) => { const k = logCardNode(); const i = setInputs(k);
    type(i[0], load); type(i[1], reps);
    actionBtn(k, /^Log set|^Log final/).onclick(); };
  log("100", "5"); log("105", "5");
  app.openDate("2026-06-08"); app.applyClaim(1, day1);
  const lt = () => { const k = logCardNode();
    return k.findAll(n => n.classList.contains("lasttime"))[0]; };
  const line = lt();
  assert(!!line, "the logger shows what was lifted last time");
  assert(/Set 1 last time/.test(line.text), "matched to the set about to be logged");
  assert(/100/.test(line.text), "with that set's actual load");
  assert(/days ago|yesterday|weeks ago/.test(line.text), "and how long ago it was");
  /* Not a target: it must not borrow the colour that means "logged". */
  const value = line.findAll(n => n.classList.contains("lt-value"))[0];
  assert(!!value && !/good|accent/.test(String(value.className)),
    "and it is not coloured as a target — it is a fact about the past");
  /* Set 2 of this session reads set 2 of last time. */
  log("100", "5");
  assert(/Set 2 last time/.test(lt().text), "the second set reads the second set last time");
  assert(/105/.test(lt().text), "…with the load that set actually carried");
  /* Past the end of last time's sets, it falls back to the top set. */
  log("100", "5"); log("100", "5");
  assert(/Top set last time/.test(lt().text),
    "past the end of last time's sets it falls back to the top set");
  assert(/105/.test(lt().text), "which is the heaviest one, not the last one");
  /* Silent rather than empty when there is nothing to compare against. */
  app.openDate("2026-05-01"); app.applyClaim(1, day1);
  is(lt(), undefined, "an exercise with nothing before it prints no row at all");
  is(app.agoWords(0), "today", "…");
  is([app.agoWords(1), app.agoWords(6), app.agoWords(21), app.agoWords(120)],
    ["yesterday", "6 days ago", "3 weeks ago", "4 months ago"],
    "how long ago is worded at the scale it matters");

  /* ---- a typed-but-unlogged set still reaches sets[] ---- */
  /* Two exercises, so Next has somewhere to go. */
  const twoDay = "Day 1 (Mon) - Two lifts";
  const twoProgram = { meta: { schema: "tp-program-2", block: "Flush", athlete: "Sample",
    athleteId: "sample", weeks: 2, days: [twoDay] },
    exercises: [1, 2].flatMap(w => ["Back squat", "Strict press"].map((name, i) => ({
      id: `w${w}d1e${i + 1}`, week: w, day: twoDay, name, sets: "4", reps: "5",
      load: "100", rpe: "RPE 7", tempo: "", rest: "2 min", logHint: "", focus: "",
      progression: "" }))) };
  const paths = {};
  const setup = () => {
    store.clear(); app.SETTINGS = { ...app.SET_DEFAULTS };
    app.loadProgram(twoProgram);
    app.openDate("2026-07-06"); app.applyClaim(1, twoDay);
    const k = logCardNode(); const i = setInputs(k);
    type(i[0], "123"); type(i[1], "7");
    return k;
  };
  const loads = () => app.buildSessionExport().entries[0].sets.map(r => r.load);
  setup(); endExercise(exCards()[0]);
  paths.finish = loads();
  setup(); app.stepFocus(1);
  paths.next = loads();
  setup(); app.openDate("2026-07-07");
  app.openDate("2026-07-06"); app.applyClaim(1, twoDay);
  paths.dateChange = loads();
  setup(); app.applyClaim(2, twoDay); app.applyClaim(1, twoDay);
  paths.weekChange = loads();
  setup(); app.setView("list");
  paths.viewChange = loads();
  is(paths, { finish: ["123"], next: ["123"], dateChange: ["123"], weekChange: ["123"],
    viewChange: ["123"] },
    "a typed-but-unlogged set reaches sets[] on Finish, Next, a date change, a week change and a view change");
}

console.log("\ncircuits keep all five kinds and three modes, in their own composition");
{
  /* Losing a mode would be a downgrade dressed as a simplification. */
  const kinds = {
    rounds: app.circuitOf({ sets: "4 rounds" }),
    amrap: app.circuitOf({ sets: "12 min AMRAP" }),
    emom: app.circuitOf({ sets: "10 min EMOM" }),
    fortime: app.circuitOf({ sets: "For time" }),
    ladder: app.circuitOf({ sets: "21-15-9" })
  };
  is(Object.keys(kinds).filter(k => kinds[k] && kinds[k].kind).length, 5,
    "all five circuit kinds are still recognised");
  is(kinds.rounds.kind, "rounds", "…rounds");
  is(kinds.amrap.kind, "amrap", "…AMRAP");
  is(kinds.emom.kind, "emom", "…EMOM");
  is(kinds.fortime.kind, "fortime", "…for time");
  /* "3 rounds for time" is deliberately still ROUNDS — it has a round count to tick off —
     but it defaults to the final-result mode, because the time is the answer. */
  const roundsForTime = app.circuitOf({ sets: "3 rounds for time" });
  is([roundsForTime.kind, roundsForTime.defaultMode, roundsForTime.target],
    ["rounds", "final", 3], "…and rounds-for-time is rounds with a final result");
  is(kinds.ladder.kind, "ladder", "…and a ladder");
  is([app.circuitModeName("quick"), app.circuitModeName("details"), app.circuitModeName("final")],
    ["Quick rounds", "Round details", "Final result"], "and all three modes are named");

  loadSynthetic([{ name: "MetCon", sets: "4 rounds",
    reps: "5 TnG power cleans + 15/12 cal bike", logHint: "Round splits" }]);
  const card = logCardNode();
  const counter = card.findAll(n => n.classList.contains("roundcount"))[0];
  assert(!!counter, "a circuit gets a large round counter, not a three-numeral readout");
  is(counter.findAll(n => n.classList.contains("rn-value"))[0].text, "0/4",
    "reading rounds done against rounds prescribed");
  assert(!card.findAll(n => n.classList.contains("setgrid")).length,
    "and none of the strength row's fields, two of which would be meaningless");
  const done = buttonOf(card, /Complete round|Complete final/);
  assert(!!done, "with one large tap per completed round");
  done.onclick();
  const after = exCards()[0].findAll(n => n.classList.contains("rn-value"))[0].text;
  is(after, "1/4", "and the counter follows");
  /* The rest clock is just as useful between rounds as between sets. */
  assert(!!exCards()[0].findAll(n => n.classList.contains("restclock"))[0],
    "a circuit still has the rest clock");
  assert(/^\d{4}/.test(app.getSession().lastSetAt), "which a completed round stamps");
}

console.log("\ntwo settings scopes: what follows the account, and what stays on the phone");
{
  /* Which optional fields you track and what you call them are about WHO YOU ARE, so
     they follow the account. Appearance is about WHERE YOU ARE STANDING, so it does not.
     Getting a key into the wrong scope is the quiet failure this guards. */
  is(app.ACCOUNT_KEYS.slice().sort(),
    ["bodyweight", "hrvNote", "painLabel", "painOnWaking", "painPerExercise", "readiness", "sleep"],
    "the tracked fields and the pain label follow the account");
  is(app.DEVICE_KEYS.slice().sort(), ["mode", "palette", "sv", "view"],
    "appearance and which view the app opens on stay on the device");
  app.DEVICE_KEYS.forEach(key =>
    assert(!app.accountScoped(key), `${key} is device-scoped`));
  app.ACCOUNT_KEYS.forEach(key =>
    assert(app.accountScoped(key), `${key} is account-scoped`));

  store.clear();
  app.SETTINGS = { ...app.SET_DEFAULTS };
  app.ACCOUNT_SETTINGS = { values: {}, at: {} };

  /* A device write goes to the device record only, with no timestamp — there is nothing
     to resolve, because it never leaves this phone. */
  app.setSetting("palette", "b");
  is(JSON.parse(store.get("tp_settings_v1")).palette, "b", "a device setting is stored locally");
  assert(!("palette" in JSON.parse(store.get("tp_account_settings_v1") || '{"values":{}}').values),
    "and never reaches the account record");

  /* An account write is stamped, because the conflict rule is per-field last-write-wins. */
  app.setSetting("painOnWaking", false);
  const account = JSON.parse(store.get("tp_account_settings_v1"));
  is(account.values.painOnWaking, false, "an account setting is stored in the account record");
  assert(/^\d{4}-\d{2}-\d{2}T/.test(account.at.painOnWaking),
    "with the timestamp last-write-wins needs");
  assert(!("painOnWaking" in JSON.parse(store.get("tp_settings_v1"))),
    "and is stripped from the device record, so a stale copy cannot confuse a reader");

  /* A reload rebuilds the one read model from both halves. */
  app.SETTINGS = { ...app.SET_DEFAULTS };
  app.loadSettings();
  is(app.SETTINGS.palette, "b", "a reload restores the device half");
  is(app.SETTINGS.painOnWaking, false, "…and the account half");
  is(app.SETTINGS.readiness, true, "with defaults for anything never set");

  /* An install that predates the split has its tracked fields in the DEVICE record.
     They move across with the athlete's real values rather than reverting to defaults. */
  store.clear();
  store.set("tp_settings_v1", JSON.stringify({ palette: "b", mode: "light", view: "focus",
    sv: 1, painOnWaking: false, painLabel: "Achilles", sleep: false }));
  app.SETTINGS = { ...app.SET_DEFAULTS };
  app.ACCOUNT_SETTINGS = { values: {}, at: {} };
  app.loadSettings();
  is([app.SETTINGS.painOnWaking, app.SETTINGS.painLabel, app.SETTINGS.sleep],
    [false, "Achilles", false], "an older install keeps its tracked-field choices");
  const moved = JSON.parse(store.get("tp_account_settings_v1"));
  is(moved.values.painLabel, "Achilles", "…by being moved into the account record");
  assert(/^\d{4}-\d{2}-\d{2}T/.test(moved.at.painLabel),
    "and stamped, because a migration is a write like any other");
  is([app.SETTINGS.palette, app.SETTINGS.mode], ["b", "light"],
    "while appearance stays exactly where it was");

  /* A merged record arriving from another device is adopted, not ignored. */
  app.adoptAccountSettings({ values: { painOnWaking: true, painLabel: "Knee" },
    at: { painOnWaking: "2030-01-01T00:00:00.000Z", painLabel: "2030-01-01T00:00:00.000Z" } });
  is([app.SETTINGS.painOnWaking, app.SETTINGS.painLabel], [true, "Knee"],
    "a record from another device reaches the read model");
  is(app.SETTINGS.palette, "b", "without disturbing this device's appearance");
  /* A field the incoming record does not mention falls back to its default rather than
     keeping a stale value from the record it replaced. */
  app.adoptAccountSettings({ values: {}, at: {} });
  is(app.SETTINGS.painLabel, app.SET_DEFAULTS.painLabel,
    "and a field the account has never set reads as its default");

  store.clear(); app.SETTINGS = { ...app.SET_DEFAULTS };
  app.ACCOUNT_SETTINGS = { values: {}, at: {} };
}

console.log("\nnothing renders a tracked field that is switched off");
{
  const today = app.todayISO();
  const wd = app.weekdayOf(today);
  const day = `Day 1 (${app.weekdayShort(wd)}) - Squat day`;
  store.clear(); app.SETTINGS = { ...app.SET_DEFAULTS };
  app.ACCOUNT_SETTINGS = { values: {}, at: {} };
  app.loadProgram({ meta: { schema: "tp-program-2", block: "Fields", athlete: "Sample",
    athleteId: "sample", weeks: 1, days: [day] },
    exercises: [{ id: "w1d1e1", week: 1, day, name: "Back squat", sets: "2", reps: "5",
      load: "100", rpe: "RPE 7", tempo: "", rest: "2 min",
      logHint: "Top load; knee pain during", focus: "", progression: "" }] });
  app.applyClaim(1, day);
  const s = app.getSession();
  s.session.amPainOnWaking = "5";
  app.saveSession(s);

  /* On: the check-in column, the logger's own 0–10 row, the calendar mark and its legend
     entry all exist, and every one of them uses the athlete's word for it. */
  app.setSetting("painLabel", "Achilles");
  /* The check-in only renders on the date view, so ask for it there — logCardNode()
     below switches to the logger. */
  app.setView("list");
  assert(labelsIn(checkinCard()).some(t => /Achilles pain on waking/.test(t)),
    "the check-in uses the athlete's own label");
  assert(labelsIn(logCardNode()).includes("Achilles"),
    "so does the logger's per-set row");
  assert(/achilles pain/.test(app.statusLine({}, { done: true, painDuring: "2",
    sets: [{ load: "100", reps: "5", rpe: "7", painDuring: "2", note: "" }] })),
    "and the Overview summary line");
  assert(/achilles/i.test(app.calendarLegend().text), "and the calendar legend");
  is(app.calendarPain(today), 5, "with a mark on the date it was read");

  /* Off: no column, no row, no mark, no legend entry — not a greyed one. */
  app.setSetting("painOnWaking", false);
  app.setView("list");
  assert(!labelsIn(checkinCard()).some(t => /on waking/.test(t)),
    "switching it off removes the check-in column entirely");
  is(app.calendarPain(today), 0, "and the calendar mark");
  assert(!/on waking/i.test(app.calendarLegend().text), "and its legend entry");
  is(app.getSession().session.amPainOnWaking, "5",
    "…while the reading already logged is never deleted");

  app.setSetting("painPerExercise", false);
  assert(!labelsIn(logCardNode()).includes("Achilles"),
    "switching off per-exercise pain removes the logger's row");
  const out = app.buildSessionExport();
  is([out.tracking.painOnWaking, out.tracking.painPerExercise], [false, false],
    "and the export says which fields this athlete does not collect");
  is(out.tracking.painLabel, "Achilles", "along with what they call them");

  app.setSetting("painOnWaking", true);
  app.setSetting("painPerExercise", true);
  app.setSetting("painLabel", "Knee");
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
