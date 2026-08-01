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
 *   - per-set rows round-trip into a tp-session-3 export
 *   - the flat summary fields are exported as logged, never recomputed
 *   - athleteId survives, including the v1 fallback
 *   - the programme revision is displayed and stamped on the export
 *   - the check-in renders into the drawer, not the training view
 *   - the focus view shows exactly one exercise, and paging it never loses data
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
    this._text = ""; this.value = "";
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
  /* Only selectors the app actually uses on an element: "details" and ".chips". */
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
    execCommand(){}
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
  FIELD_DEFS:   {get:()=>FIELD_DEFS}
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
  app.SETTINGS = { ...app.SET_DEFAULTS };
  const prog = JSON.parse(fs.readFileSync(path.join(ROOT, "samples", name), "utf8"));
  app.loadProgram(prog);
  return prog;
}
/* Render one day's cards without asserting anything about layout. */
function cards(){ const m = stubFor("#main"); m.children = []; app.renderMain(); return m.children.filter(n => n.nodeType === 1); }
/* Only the exercise cards — banners are element children of #main too. */
function exCards(){ return cards().filter(c => c.classList.contains("card")); }
/* The check-in lives in the drawer now, so it is rendered and read separately from the
   training view. renderCheckin() clears the host itself. */
function checkinCard(){ app.renderCheckin(); return stubFor("#checkinHost").children.find(c => c.nodeType === 1); }
function labelsIn(node){ return node ? node.findAll(n => n.classList.contains("lbl")).map(n => n.text) : []; }
function pips(){ return stubFor("#pips").children.filter(n => n.nodeType === 1); }

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
  assert(!app.isV2(), "isV2() false for tp-program-1");
  const byDay = app.PROGRAM.exercises.filter(e => e.day === app.STATE.day);
  app.STATE.week = 1;
  is(app.dayExercises().length, byDay.length, "week 1 shows every row for the day");
  app.STATE.week = 4;
  is(app.dayExercises().length, byDay.length, "week 4 still shows them — week is ignored in v1");
  const banner = cards().find(c => c.classList.contains("banner"));
  assert(!!banner && /Week-1 template/.test(banner.text), "progression banner shown past the authored week");
}

console.log("\nper-set logging round-trip");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises().find(e => /front squat/i.test(e.name)) || app.dayExercises()[1];
  const s = app.getSession();
  const e = (s.entries[ex.id] = { done: true, load: "80", reps: "3x4", rpe: "7",
                                  painDuring: "3", notes: "dropped after set 1", sets: [] });
  e.sets.push({ set: 1, load: "100", reps: "4", rpe: "9", painDuring: "3", note: "too heavy" });
  e.sets.push({ set: 2, load: "80",  reps: "4", rpe: "7", painDuring: "3", note: "" });
  e.sets.push({ set: 3, load: "80",  reps: "4", rpe: "7", painDuring: "2", note: "" });
  e.sets.push({ set: 4, load: "",    reps: "",  rpe: "",  painDuring: "",  note: "" });   // untouched
  app.saveSession(s);

  const out = app.buildSessionExport();
  is(out.schema, "tp-session-3", "schema is tp-session-3");
  is(out.athleteId, "fixture-slug", "athleteId taken from meta, not re-slugged from the name");
  const entry = out.entries.find(x => x.exercise === ex.name);
  is(entry.sets.length, 3, "the blank 4th row is dropped from the export");
  is(entry.sets.map(r => r.set), [1, 2, 3], "sets are renumbered contiguously");
  is(entry.sets[0], { set: 1, load: "100", reps: "4", rpe: "9", painDuring: "3", note: "too heavy" },
     "set 1 keeps every field");
  is([entry.load, entry.reps, entry.rpe], ["80", "3x4", "7"],
     "flat summary exported as logged, not recomputed from sets");
  assert(out.entries.every(x => Array.isArray(x.sets)), "every entry has a sets array");
  assert(out.entries.every(x => x.prescribed && "load" in x.prescribed), "prescribed denormalised into every entry");
  assert(out.entries.length === app.dayExercises().length, "untouched exercises are still exported");
  is(out.tracking.perSetLogging, true, "tracking records that per-set logging was available");
  const untouched = out.entries.find(x => x.exercise !== ex.name);
  is(untouched.sets, [], "an untouched exercise exports sets: []");
  is(app.summaryText(e), "100 → 80 → 80 · 3x4 · RPE 7 · knee pain 3/10", "summary shows the set shape");
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

console.log("\nview modes — all exercises vs one at a time");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const exs = app.dayExercises();
  assert(exs.length >= 3, `the day has ${exs.length} exercises to page through`);

  is(app.SETTINGS.view, "list", "all-exercises is the default — an existing install is unchanged");
  is(exCards().length, exs.length, "list view renders every exercise");
  is(pips().length, 0, "and no pips");

  app.setView("focus");
  is(exCards().length, 1, "focus view renders exactly one card");
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

  /* Marking done is the one thing that moves you without being asked, so it is the one
     most worth pinning down. */
  const doneBtn = () => exCards()[0].find(n => n.classList.contains("donebtn"));
  const isDone = i => !!(app.getSession().entries[exs[i].id] || {}).done;
  app.goFocus(0);
  if(isDone(0)) doneBtn().onclick();                     // start from a known state
  doneBtn().onclick();
  is(app.STATE.focus, 1, "marking done moves on to the next exercise");
  is(isDone(0), true, "and the one behind you stays logged");

  /* Un-marking is a correction, not progress. */
  app.goFocus(0);
  doneBtn().onclick();
  is(app.STATE.focus, 0, "un-marking never moves you — only completing does");
  is(isDone(0), false, "…and it really did un-mark");

  const lastIdx = exs.length - 1;
  app.goFocus(lastIdx);
  if(isDone(lastIdx)) doneBtn().onclick();
  doneBtn().onclick();
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

  /* The view is a per-device preference, and cosmetic — it must not reach a log file. */
  is(JSON.parse(store.get("tp_settings_v1")).view, "focus", "the choice is remembered");
  assert(!("view" in app.buildSessionExport().tracking), "but never exported in tracking");
  app.setView("list");
  is(exCards().length, app.dayExercises().length, "and switching back shows everything again");
}

console.log("\nper-set UI — the buttons an athlete actually taps");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  /* Prefer an exercise with several prescribed sets, so the multi-row path is real. */
  const ex = app.dayExercises()
    .filter(e => /^\s*\d+\s*$/.test(String(e.sets ?? "")))
    .sort((a, b) => app.prescribedSets(b) - app.prescribedSets(a))[0] || app.dayExercises()[1];
  const n = app.prescribedSets(ex);
  assert(n >= 3, `chose "${ex.name}" with ${n} prescribed sets`);

  /* Render ONCE and hold the card, the way a browser does. Re-rendering between taps
     would reset per-card UI state (the Clear-sets arming, for one) and quietly hide
     any bug that depends on state surviving across interactions. */
  const card = () => cards().find(c => c.find(x => x.text === ex.name));
  const setBtns = c => c.findAll(x => x.classList.contains("setbtn"));
  const rowsIn = c => c.findAll(x => x.classList.contains("setrow") && !x.classList.contains("head"));

  const C = card();
  const rows = () => rowsIn(C);
  const btns = () => setBtns(C);

  is(rows().length, 0, "no set rows before the athlete asks for them");
  const open = btns()[0];
  assert(/Log each set/.test(open.text), `the affordance reads "${open.text}"`);

  open.onclick();
  is(rows().length, n, `opening materialises the ${n} prescribed rows`);
  const stored = () => app.getSession().entries[ex.id].sets;
  is(stored().length, n, "rows are persisted immediately, not just rendered");

  /* THE "one tap" PROMISE. Type the load into set 1 only; every untouched row below
     must follow it, or opening a 7-set exercise costs seven loads of typing. */
  const inputs = r => r.findAll(x => x.tagName === "INPUT");
  const typeInto = (rowIdx, col, value) => {
    const inp = inputs(rows()[rowIdx])[col];
    inp.value = value; inp.oninput();
  };
  typeInto(0, 0, "100");
  is(stored().map(r => r.load), Array(n).fill("100"), "set 1's load flows into every untouched set");
  typeInto(0, 1, "5");
  is(stored().map(r => r.reps), Array(n).fill("5"), "so does reps — one tap per field, not per set");

  /* Now correct set 3 downwards, the actual drop-set case. Sets 1–2 must not move. */
  typeInto(2, 0, "80");
  is(stored().map(r => r.load), ["100", "100", ...Array(n - 2).fill("80")],
     "editing set 3 flows down but never back up");
  /* A row the athlete has touched stops following. */
  typeInto(4, 0, "70");
  typeInto(0, 0, "110");
  is(stored()[4].load, "70", "a set that was typed into is never overwritten by propagation");
  is(stored()[1].load, "110", "…while the rows above it that were untouched still follow");

  const add = btns().find(b => /Add set/.test(b.text));
  assert(!!add, "the button becomes “+ Add set” once rows exist");
  add.onclick();
  is(stored().length, n + 1, "adding appends one row");
  is(stored()[n].load, stored()[n - 1].load, "a new set copies the previous set's load");

  /* Remove set 1; the rest must renumber so the log never claims a set 1 was skipped. */
  const firstLoad = stored()[1].load;
  rows()[0].findAll(x => x.classList.contains("del"))[0].onclick();
  is(stored().length, n, "removing drops exactly one row");
  is(stored().map(r => r.set), Array.from({ length: n }, (_, i) => i + 1), "remaining sets renumber from 1");
  is(stored()[0].load, firstLoad, "removing set 1 does not disturb the values below it");

  /* Clearing is destructive, so it must take two taps — a mis-tap next to "+ Add set"
     cannot be allowed to wipe a logged exercise. */
  const clearBtn = () => btns().find(b => /[Cc]lear/.test(b.text));
  clearBtn().onclick();
  assert(stored().length === n, "one tap on Clear sets destroys nothing");
  assert(/Tap again/.test(clearBtn().text), "it arms and says so");
  clearBtn().onclick();
  is(stored().length, 0, "the second tap clears");
  is(app.buildSessionExport().entries.find(x => x.exercise === ex.name).sets, [],
     "and the export goes back to sets: []");

  /* Turning the feature off must hide the affordance without touching stored data. */
  app.SETTINGS.perSetLogging = false;
  assert(setBtns(card()).length === 0, "no per-set affordance when the setting is off");
  is(app.buildSessionExport().tracking.perSetLogging, false, "tracking records that it was off");
}

console.log("\nper-set helpers");
{
  is(app.prescribedSets({ sets: "4" }), 4, "numeric prescribed sets are used");
  is(app.prescribedSets({ sets: "3-4" }), 1, "a range falls back to one row");
  is(app.prescribedSets({ sets: "AMRAP" }), 1, "prose falls back to one row");
  is(app.prescribedSets({ sets: "99" }), 12, "absurd counts are capped");
  is(app.prescribedSets({}), 1, "missing sets falls back to one row");
  const e = { load: "100", rpe: "8", painDuring: "2", sets: [] };
  is(app.newSet(e, 0), { set: 1, load: "100", reps: "", rpe: "8", painDuring: "2", note: "", auto: true },
     "first set seeds from the flat fields and is marked auto");
  e.sets.push(app.newSet(e, 0));
  e.sets[0].load = "90";
  is(app.newSet(e, 1).load, "90", "a later set copies the previous one");

  /* `auto` is local bookkeeping and must never reach a log file. */
  is(app.exportSets({ sets: [{ set: 1, load: "90", reps: "", rpe: "", painDuring: "", note: "", auto: true }] }),
     [{ set: 1, load: "90", reps: "", rpe: "", painDuring: "", note: "" }],
     "the auto flag is stripped from the export");
}

console.log("\nrobustness — bad or legacy stored data must not break the gym");
{
  loadFixture("program.v2.sample.json");
  app.STATE.week = 1;
  const ex = app.dayExercises()[1];

  /* A session written by an older build: no `sets`, no `tracking`, missing session keys. */
  store.set(app.sessionKey(), JSON.stringify({
    block: "old", athlete: "old", week: 1, day: app.STATE.day, date: app.STATE.date,
    session: { overall: "written by an older build" },
    entries: { [ex.id]: { done: true, load: "60", reps: "3x5", rpe: "7", notes: "" } }
  }));
  const s = app.getSession();
  is(s.session.readiness, "", "a missing check-in key is normalised to \"\" on read");
  assert(cards().length > 0, "the day still renders");
  const out = app.buildSessionExport();
  is(Object.keys(out.session).sort(),
     ["amPainOnWaking", "bodyweightKg", "hrvNote", "overall", "readiness", "sleep"],
     "the export still carries every session key");
  is(out.entries.find(x => x.exercise === ex.name).sets, [], "a legacy entry exports sets: []");
  is(out.entries.find(x => x.exercise === ex.name).load, "60", "and keeps what was logged");

  /* A session missing `session`/`entries` entirely must not blank the app. */
  store.set(app.sessionKey(), JSON.stringify({ week: 1, day: app.STATE.day }));
  assert(cards().length > 0, "a session with no session/entries keys still renders");

  /* Non-string values in a set row must not make Export do nothing. */
  const s2 = app.getSession();
  s2.entries[ex.id] = { done: true, load: "", reps: "", rpe: "", painDuring: "", notes: "",
                        sets: [{ set: 1, load: 100, reps: 4, rpe: null, painDuring: undefined, note: "" }] };
  app.saveSession(s2);
  is(app.buildSessionExport().entries.find(x => x.exercise === ex.name).sets,
     [{ set: 1, load: "100", reps: "4", rpe: "", painDuring: "", note: "" }],
     "numbers and nulls in a set row are coerced, not thrown on");
  is(app.summaryText(s2.entries[ex.id]), "100 · 4",
     "and an exercise logged only per-set never reads as “nothing logged”");
}

console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
