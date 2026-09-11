/* ==========================================================================
   test/logic.mjs — the rules, with no browser in the room.

     node test/logic.mjs

   data.js, vault.js, store.js and plan.js are loaded into a bare V8 context
   with a fake localStorage, which is enough for everything that is really
   just arithmetic on the save file: progression, rotation, the import
   parser, migrations.

   Anything that needs a DOM lives in test/browser.mjs instead.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = join(import.meta.dirname, "..");

/* A fresh app, with storage that works but starts empty. */
function boot() {
  const mem = {};
  const sandbox = {
    window: {},
    /* No indexedDB and no navigator.storage on purpose: this is the
       degraded case, and the app is supposed to be fine in it. */
    navigator: {},
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; }
    },
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const f of ["js/data.js", "js/vault.js", "js/store.js", "js/plan.js"]) {
    vm.runInContext(readFileSync(join(ROOT, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.window.IL;
}

const IL = boot();
const { store, plan, vault, data } = IL;

let pass = 0, fail = 0;
const failures = [];

function ok(label, cond, extra) {
  if (cond) { pass++; }
  else {
    fail++;
    failures.push(label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : ""));
    console.log("  FAIL " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : ""));
  }
}
function eq(label, a, b) {
  ok(label + " = " + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), a);
}
function group(name) { console.log("\n" + name); }

/* ---------------------------------------------------------------- library */
group("library");
eq("hack squat resolves from a loose name", store.libResolve("hack squat"), "Hack Squat Machine");
eq("exact resolve", store.libResolve("Leg Press"), "Leg Press");
eq("punctuation blind", store.libResolve("incline-smith press"), "Incline Smith Press");
eq("ambiguous matches nothing rather than guessing", store.libResolve("squat"), "");
eq("unknown matches nothing", store.libResolve("Zercher Carry"), "");
eq("v-squat pool includes the hack squat",
   store.poolFor("V-Squat Machine").includes("Hack Squat Machine"), true);
eq("pool is type-matched, so no fly in the press pool",
   store.poolFor("Incline Smith Press").includes("Chest Fly Machine"), false);
eq("blank pattern gives a pool of one", store.poolFor("Nothing At All").length, 1);
eq("library size matches data.js", store.libAll().length, data.LIB.length);

/* every slot in the stock program must have somewhere to rotate to */
group("stock program can actually rotate");
data.TEMPLATES.forEach((t) => {
  t.plan.forEach((p) => {
    ok(t.name + " / " + p[0] + " has a pool", store.poolFor(p[0]).length >= 2,
       store.poolFor(p[0]).length);
  });
});

/* ------------------------------------------------------ custom exercises */
group("custom exercises");
store.addCustomExercise({ name: "Reverse Hyper", group: "Legs", type: "support", sets: 3, reps: "12-15", pattern: "hinge" });
eq("custom joins the library", store.libAll().length, data.LIB.length + 1);
eq("custom is resolvable", store.libResolve("reverse hyper"), "Reverse Hyper");
eq("custom joins its pattern pool", store.poolFor("Good Morning").includes("Reverse Hyper"), true);
store.addCustomExercise({ name: "Calf Raise", group: "Legs", type: "small", sets: 5, reps: "20-25", pattern: "calf" });
eq("same name as a built-in replaces it", store.libAll().filter((x) => x.name === "Calf Raise").length, 1);
eq("the override wins", store.libLookup("Calf Raise").reps, "20-25");
store.removeCustomExercise("Calf Raise");
eq("removing it restores the built-in", store.libLookup("Calf Raise").reps, "12-15");

/* --------------------------------------------------------- import parser */
group("import parser");
const text = `
2026-08-04 Upper A
Incline Smith Press 135x8 135x8 145x6
Barbell Bent-Over Row 155 x 8 x 3
Pull-Ups BWx9 BWx7
Cable Crunch 60x15, 60x15
note: incline felt easy

8/6/26 Lower A
hack squat 250x8x4
Barbell RDL 185x8 185x8 195x6 195x6
Calf Raise 120x15x4
Plank 45 45 45

Aug 8 upper b
Flat DB Press 70x10 70x10 75x8
Some Machine I Made Up 100x12x3
185x5+155x3
`;
const parsed = plan.parseImport(text);
eq("three sessions", parsed.sessions.length, 3);
eq("unknown names surfaced", parsed.unknown, ["Some Machine I Made Up"]);
eq("one unreadable line", parsed.errors.length, 1);
eq("the unreadable line is the naked set", parsed.errors[0].text, "185x5+155x3");

const s0 = parsed.sessions[0];
eq("day name kept", s0.dayName, "Upper A");
eq("note captured", s0.notes, "incline felt easy");
eq("three sets parsed", s0.entries[0].sets, [[{w:135,r:8}],[{w:135,r:8}],[{w:145,r:6}]]);
eq("spaced '155 x 8 x 3' expands to three sets", s0.entries[1].sets.length, 3);
eq("the expansion is identical each time", s0.entries[1].sets[2], [{w:155,r:8}]);
eq("BW is weight zero", s0.entries[2].sets[0], [{w:0,r:9}]);
eq("comma separated sets", s0.entries[3].sets.length, 2);

const s1 = parsed.sessions[1];
eq("loose name canonicalised on import", s1.entries[0].name, "Hack Squat Machine");
eq("x4 gives four sets", s1.entries[0].sets.length, 4);
eq("bare numbers are unloaded reps", s1.entries[3].sets,
   [[{w:0,r:45}],[{w:0,r:45}],[{w:0,r:45}]]);
eq("month-name date", new Date(parsed.sessions[2].at).getMonth(), 7);
eq("two-digit year", new Date(s1.at).getFullYear(), 2026);
eq("sessions come back in order",
   parsed.sessions.map((s) => s.at).every((v, i, a) => i === 0 || a[i-1] <= v), true);
ok("volume totalled for the preview", parsed.volume > 20000, parsed.volume);

group("import edge cases");
const dp = plan.parseImport("2026-08-04 Upper A\nFlat DB Press 185x5+155x3 185x5");
eq("a drop is one set of two segments", dp.sessions[0].entries[0].sets[0],
   [{w:185,r:5},{w:155,r:3}]);
eq("and it is still two sets", dp.sessions[0].entries[0].sets.length, 2);
eq("empty text", plan.parseImport("").sessions.length, 0);
eq("junk text", plan.parseImport("hello world\nnothing here").sessions.length, 0);
eq("junk is reported", plan.parseImport("hello world").errors.length, 1);
eq("a date with nothing under it is dropped", plan.parseImport("2026-01-01 Upper A").sessions.length, 0);
eq("'today'", new Date(plan.parseImport("today Upper A\nDips BWx8").sessions[0].at).toDateString(),
   new Date().toDateString());
eq("a future bare date rolls back a year",
   new Date(plan.parseImport("12/25 Upper A\nDips BWx8").sessions[0].at).getFullYear()
     <= new Date().getFullYear(), true);
eq("the x in 'Box Squat' survives tightening",
   plan.parseImport("2026-01-01 x\nBox Squat 200x5").sessions[0].entries[0].name, "Box Squat");
eq("lb suffix stripped",
   plan.parseImport("2026-01-01 x\nCurl 30lb x 12").sessions[0].entries[0].sets[0], [{w:30,r:12}]);
eq("@ as a separator",
   plan.parseImport("2026-01-01 x\nCurl 30 @ 12").sessions[0].entries[0].sets[0], [{w:30,r:12}]);
eq("unicode multiplication sign",
   plan.parseImport("2026-01-01 x\nCurl 30×12").sessions[0].entries[0].sets[0], [{w:30,r:12}]);

/* --------------------------------------------------------- commit + reseed */
group("committing an import, then re-seeding the plan from it");
const res = plan.commitImport(parsed);
eq("sessions committed", res.sessions, 3);
eq("the unknown name was learned", res.learned, 1);
eq("history length", store.state.history.length, 3);
eq("day matched to Upper A", store.state.history[0].dayId, "UA");
eq("history is sorted", store.state.history.map((h) => h.at).every((v,i,a) => i===0 || a[i-1]<=v), true);
ok("volume computed on import", store.state.history[0].volume > 3000, store.state.history[0].volume);

ok("re-seed touched some rows", plan.reseed() > 0);
const ua = store.state.days[0].ex;
eq("incline held at what was lifted (145x6 is short of the top)", ua[0].weight, 145);
eq("and it says hold", ua[0].progress.kind, "hold");
eq("the row earned +5", ua[1].weight, 160);
eq("and it says up", ua[1].progress.kind, "up");
ok("the note explains why", /all 3 sets hit 8/.test(ua[1].progress.note), ua[1].progress.note);

/* -------------------------------------------------------- overload rules */
group("progressive overload");
function last(target, sets, reps, w) {
  return {
    at: Date.now(), unit: "lb",
    entry: {
      name: "X", sets, target, completed: reps.length, topWeight: w,
      logged: reps.map((r, i) => ({ set: i + 1, segs: [{ w, r }] }))
    }
  };
}
const ex = { name: "Flat Smith Press", sets: 3, reps: "6-8", weight: 200 };
eq("every set at the top goes up a step", plan.overload(ex, last("6-8",3,[8,8,8],200)).weight, 205);
eq("inside the range holds at what you lifted", plan.overload(ex, last("6-8",3,[8,7,6],200)).weight, 200);
eq("and reports a hold", plan.overload(ex, last("6-8",3,[8,7,6],200)).kind, "hold");
eq("one set short still holds", plan.overload(ex, last("6-8",3,[8,7,4],200)).kind, "hold");
eq("two sets short backs off", plan.overload(ex, last("6-8",3,[8,4,3],200)).kind, "down");
eq("the deload lands on a step", plan.overload(ex, last("6-8",3,[8,4,3],200)).weight, 180);
eq("a short session holds, it never deloads", plan.overload(ex, last("6-8",4,[8,8],200)).kind, "hold");
eq("and it keeps the load", plan.overload(ex, last("6-8",4,[8,8],200)).weight, 200);
eq("one bad set in a short session holds", plan.overload(ex, last("6-8",4,[8,3],200)).kind, "hold");
eq("two bad sets deload even in a short session", plan.overload(ex, last("6-8",4,[3,3],200)).kind, "down");
eq("no history leaves the plan alone", plan.overload(ex, null).kind, "open");
eq("and keeps the weight", plan.overload(ex, null).weight, 200);

const bw = plan.overload({ name:"Pull-Ups", sets:3, reps:"6-10", weight:0 }, last("6-10",3,[10,10,10],0));
eq("bodyweight progresses on reps", bw.reps, "7-11");
eq("and stays unloaded", bw.weight, 0);
eq("and still counts as up", bw.kind, "up");

/* ------------------------------------------------------------- rotation */
group("rotation");
store.state.prefs.variety = "medium";
const laBefore = store.state.days[1].ex.map((e) => e.name);

for (let cycle = 0; cycle < 3; cycle++) {
  const day = store.state.days[1];
  day.ex.forEach((e) => {
    e.log = [];
    for (let i = 0; i < e.sets; i++) e.log[i] = [{ w: e.weight || 100, r: store.repTop(e.reps) }];
  });
  store.state.day = 1;
  const out = store.finishSession();
  const swaps = out.changes.filter((c) => c.kind === "swap");
  ok("visit " + (cycle + 1) + " respects the cap of 2", swaps.length <= 2,
     swaps.map((c) => c.from + " -> " + c.name));
  ok("visit " + (cycle + 1) + " changes at most one compound",
     swaps.filter((c) => store.typeOf(c.name) === "compound").length <= 1,
     swaps.map((c) => c.name));
}

const laAfter = store.state.days[1].ex.map((e) => e.name);
ok("the day changed over three visits", laAfter.join() !== laBefore.join());
eq("and kept all six slots", laAfter.length, 6);

const all = [];
store.state.days.forEach((d) => d.ex.forEach((e) => all.push(e.name)));
eq("no exercise appears in two days at once", all.filter((n, i) => all.indexOf(n) !== i), []);

group("variety off, and pinning");
store.state.prefs.variety = "off";
const ubBefore = store.state.days[2].ex.map((e) => e.name).join();
store.state.day = 2;
store.state.days[2].ex.forEach((e) => {
  e.log = [];
  for (let i = 0; i < e.sets; i++) e.log[i] = [{ w: e.weight || 50, r: store.repTop(e.reps) }];
});
store.finishSession();
eq("nothing rotates when variety is off", store.state.days[2].ex.map((e) => e.name).join(), ubBefore);
eq("but loads still progress", store.state.days[2].ex[0].progress.kind, "up");

store.state.prefs.autoProgress = false;
store.state.day = 2;
store.state.days[2].ex.forEach((e) => {
  e.log = [];
  for (let i = 0; i < e.sets; i++) e.log[i] = [{ w: e.weight || 50, r: store.repTop(e.reps) }];
});
store.finishSession();
eq("progression off clears the advice rather than freezing it",
   store.state.days[2].ex[0].progress, null);
store.state.prefs.autoProgress = true;

store.state.prefs.variety = "high";
const la = store.state.days[1];
la.ex.forEach((e) => { e.pin = true; e.rotAge = 99; });
const pinned = la.ex.map((e) => e.name).join();
store.state.day = 1;
la.ex.forEach((e) => {
  e.log = [];
  for (let i = 0; i < e.sets; i++) e.log[i] = [{ w: e.weight || 100, r: store.repTop(e.reps) }];
});
store.finishSession();
eq("pinned slots never move", la.ex.map((e) => e.name).join(), pinned);

/* ------------------------------------------------------------ round trip */
group("backup, restore and migration");
const backup = store.toBackup();
store.reset();
eq("reset clears history", store.state.history.length, 0);
eq("reset clears custom exercises", store.state.custom.length, 0);
store.restore(backup);
eq("restore brings history back", store.state.history.length > 3, true);
eq("restore brings custom exercises back", store.state.custom.length > 0, true);
/* Compared against a fresh seed, so a schema bump doesn't mean editing tests. */
const CURRENT = store.seed().schema;
eq("schema is current", store.state.schema, CURRENT);
ok("CSV still generates", store.toCSV().split("\n").length > 5);

const old = JSON.parse(backup);
old.schema = 3;
delete old.custom;
delete old.prefs.autoProgress;
delete old.prefs.variety;
delete old.prefs.lastExport;
delete old.nutrition;
old.days.forEach((d) => d.ex.forEach((e) => { delete e.pin; delete e.rotAge; delete e.progress; }));
store.restore(JSON.stringify(old));
eq("a schema 3 save migrates all the way", store.state.schema, CURRENT);
eq("nutrition created empty", store.state.nutrition, { days:{}, goals:[] });
eq("custom list created", Array.isArray(store.state.custom), true);
eq("pin defaulted", store.state.days[0].ex[0].pin, false);
eq("rotAge defaulted", store.state.days[0].ex[0].rotAge, 0);
eq("progression defaults on", store.state.prefs.autoProgress, true);
eq("variety defaults to medium", store.state.prefs.variety, "medium");
eq("lastExport defaults to never", store.state.prefs.lastExport, 0);

group("export tracking");
eq("never exported reads as null", store.daysSinceExport(), null);
store.markExported();
eq("exporting today reads as zero days", store.daysSinceExport(), 0);

/* ------------------------------------------------------------ nutrition */
group("nutrition: every field optional");

/* Keys relative to today, so the suite passes on any date. */
function keyAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return store.dayKey(d.getTime());
}
const today = keyAgo(0);

eq("all three stored", store.setNutrition(today, { kcal: "2150", protein: "182.5", fiber: "31" }),
   { kcal: 2150, protein: 182.5, fiber: 31 });
eq("calories only leaves the others unlogged", store.setNutrition(keyAgo(1), { kcal: 2400 }),
   { kcal: 2400, protein: null, fiber: null });
eq("blank fields are unlogged, not zero",
   store.setNutrition(keyAgo(2), { kcal: "", protein: "150", fiber: "  " }),
   { kcal: null, protein: 150, fiber: null });
eq("a typed zero is kept as zero", store.setNutrition(keyAgo(3), { kcal: 1800, fiber: "0" }).fiber, 0);
eq("negative is treated as blank", store.setNutrition(keyAgo(3), { kcal: -5, fiber: 0 }).kcal, null);
eq("calories round to whole numbers", store.setNutrition(keyAgo(4), { kcal: "2099.6" }).kcal, 2100);
eq("clearing every field removes the day", store.setNutrition(keyAgo(4), { kcal: "" }), null);
eq("and it is gone", store.nutritionOn(keyAgo(4)), null);
eq("newest first", store.nutritionKeys()[0], today);

group("nutrition: targets are phases, judged per day");
eq("no target yet", store.currentGoal(), null);
eq("so there is no over/under", store.nutritionSeries(1)[0].diff, null);

store.setGoal({ from: keyAgo(40), kcal: 3000, phase: "bulk" });
store.setGoal({ from: keyAgo(10), kcal: 2200, phase: "cut" });
eq("the bulk applied 20 days ago", store.goalOn(keyAgo(20)).kcal, 3000);
eq("the cut applies from its start day", store.goalOn(keyAgo(10)).kcal, 2200);
eq("and today", store.currentGoal().phase, "cut");
eq("before the first target there is none", store.goalOn(keyAgo(41)), null);

store.setNutrition(keyAgo(20), { kcal: 3100 });
store.setNutrition(keyAgo(5), { kcal: 2000 });
const month = store.nutritionSeries(30);
const bulkDay = month.find((r) => r.key === keyAgo(20));
const cutDay = month.find((r) => r.key === keyAgo(5));
eq("a bulk day is judged against the bulk target", bulkDay.diff, 100);
eq("not re-graded against today's cut", bulkDay.target, 3000);
eq("a cut day is judged against the cut target", cutDay.diff, -200);
eq("each day carries its phase", [bulkDay.phase, cutDay.phase].join(), "bulk,cut");

store.setGoal({ from: keyAgo(10), kcal: 2300, phase: "cut" });
eq("a second target on the same start day corrects the first",
   store.state.nutrition.goals.filter((g) => g.from === keyAgo(10)).length, 1);
eq("with the new number", store.goalOn(keyAgo(5)).kcal, 2300);
eq("a phase name that isn't one is dropped", store.setGoal({ kcal: 2000, phase: "yolo", from: keyAgo(2) }).phase, "");
eq("a target needs a number", store.setGoal({ kcal: "", from: keyAgo(1) }), null);
store.removeGoal(keyAgo(2));
eq("removing a phase hands the days back to the one before", store.goalOn(keyAgo(1)).kcal, 2300);

group("nutrition: series and averages");
const two = store.nutritionSeries(14);
eq("the window is exactly as long as asked", two.length, 14);
eq("it ends today", two[13].key, today);
eq("it runs oldest first", two[0].key, keyAgo(13));
ok("unlogged days are present as gaps", two.some((r) => r.kcal === null && r.protein === null));

/* In the last 7 days: today 2150/182.5/31, 1 ago 2400/-/-, 2 ago -/150/-,
   3 ago -/-/0, 5 ago 2000/-/-. */
const week = store.nutritionAverages(7);
eq("calorie average is over the three days with calories", week.kcal.days, 3);
eq("and is their mean", Math.round(week.kcal.value), Math.round((2150 + 2400 + 2000) / 3));
eq("protein averages over its own two days", week.protein.days, 2);
eq("so a skipped day doesn't drag it down", week.protein.value, (182.5 + 150) / 2);
eq("a logged zero counts toward fibre", week.fiber.days, 2);
eq("over/under averages only days with a target and calories", week.diff.days, 3);

group("nutrition: in the CSV and through a backup");
const csv = store.toCSV().split("\r\n");
const cols = csv[0].split(",");
eq("four new columns", cols.slice(-4).join(), "calories,calorie_target,protein_g,fiber_g");
ok("every row is padded to the header", csv.every((line) => line.split(",").length >= cols.length));
const bulkRow = csv.find((line) => line.startsWith(keyAgo(20) + ",") && line.includes("nutrition"));
ok("a nutrition row carries the target in force THAT day", bulkRow && bulkRow.endsWith(",3100,3000,,"),
   bulkRow);

const withFood = store.toBackup();
store.reset();
eq("reset clears nutrition", store.state.nutrition, { days:{}, goals:[] });
store.restore(withFood);
eq("restore brings the days back", store.nutritionOn(today).protein, 182.5);
eq("and the phases", store.state.nutrition.goals.length, 2);

const mangled = JSON.parse(withFood);
mangled.nutrition = { days: [1, 2, 3], goals: "nope" };
store.restore(JSON.stringify(mangled));
eq("a mangled nutrition block normalises instead of crashing", store.state.nutrition,
   { days:{}, goals:[] });

/* ---------------------------------------------------------- weight trend */
group("weight: the 7-day average leads");
store.reset();
store.addBodyweight(180, keyAgo(0));
store.addBodyweight(181, keyAgo(1));
store.addBodyweight(182, keyAgo(2));
store.addBodyweight(190, keyAgo(8));         /* last week, outside this window */

eq("this week's average", store.weekAverage(today).value, 181);
eq("made of three readings", store.weekAverage(today).count, 3);
eq("a reading 8 days back stays out of it", store.weekAverage(today).from, keyAgo(6));
const wt = store.weightTrend();
eq("last week's average", wt.prev.value, 190);
eq("the change is average against average", wt.change, -9);
eq("the latest single reading is still available", wt.latest.w, 180);

const trend = store.bodyTrendSeries();
eq("the chart line is the average", trend[trend.length - 1].y, 181);
eq("with the reading alongside", trend[trend.length - 1].raw, 180);
eq("a lone reading averages to itself", trend[0].y, 190);

eq("×bodyweight uses the average", store.trendWeightAt(store.fromDayKey(today)), 181);
eq("and falls back to the nearest reading when the week is empty",
   store.trendWeightAt(store.fromDayKey(keyAgo(30))), 190);

eq("no readings this week gives no average", (store.reset(), store.weightTrend().now), null);

eq("shiftKey walks into DST cleanly", store.shiftKey("2026-03-07", 2), "2026-03-09");
eq("and out of it", store.shiftKey("2026-11-02", -2), "2026-10-31");
eq("and across a month end", store.shiftKey("2026-08-30", 3), "2026-09-02");

/* -------------------------------------------------------------- the TDEE */

/* A controlled month: steady intake, weight moving at a known rate. */
function scenario({ days = 21, kcal = 2300, perWeek = -0.5, start = 185,
                    noise = null, weighEvery = 1, kcalOn = null, weighOn = null } = {}) {
  store.reset();
  for (let d = days; d >= 1; d--) {
    const elapsed = days - d;
    if (!kcalOn || kcalOn(d)) store.setNutrition(keyAgo(d), { kcal });
    const weigh = weighOn ? weighOn(d) : elapsed % weighEvery === 0;
    if (weigh) {
      store.addBodyweight(start + elapsed * perWeek / 7 + (noise ? noise(elapsed) : 0), keyAgo(d));
    }
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

group("maintenance: the arithmetic");
scenario();
let est = store.tdee().now;
ok("ready with three clean weeks", est.ready, est.need);
ok("2,300 in and losing 0.5 lb a week is ~2,550 out", near(est.tdee, 2550, 20), est.tdee);
eq("average intake reported", est.intake, 2300);
ok("the weekly rate is recovered", near(est.perWeek, -0.5, 0.02), est.perWeek);
ok("a clean line has a tight margin", est.band <= 30, est.band);
eq("it used all 21 days of food", est.kcalDays, 21);

store.setNutrition(keyAgo(0), { kcal: 400 });
eq("today's half-logged breakfast doesn't move it", store.tdee().now.tdee, est.tdee);

scenario({ perWeek: +0.5 });
est = store.tdee().now;
ok("gaining on 2,300 means maintenance is below 2,300", near(est.tdee, 2050, 20), est.tdee);

scenario({ perWeek: 0 });
ok("a flat scale means maintenance is what you ate", near(store.tdee().now.tdee, 2300, 10),
   store.tdee().now.tdee);

scenario();
store.state.prefs.unit = "kg";
ok("in kg the same slope is worth 7,700 a unit", near(store.tdee().now.tdee, 2300 + 7700 * 0.5 / 7, 30),
   store.tdee().now.tdee);
store.state.prefs.unit = "lb";

group("maintenance: noise widens the margin, not the answer");
const wobble = (e) => (((e * 7919) % 11) - 5) / 5;          /* deterministic ±1 lb */
scenario({ noise: wobble });
est = store.tdee().now;
ok("still lands near the truth", near(est.tdee, 2550, 200), est.tdee);
ok("and admits it's less sure", est.band > 30 && est.band < 250, est.band);

scenario({ noise: wobble, weighEvery: 3 });
const sparse = store.tdee().now;
ok("fewer weigh-ins, wider margin", sparse.band > est.band, sparse.band + " vs " + est.band);

group("maintenance: says what it's missing instead of guessing");
scenario({ kcalOn: (d) => d <= 9 });
est = store.tdee().now;
eq("nine days of food isn't enough", est.ready, false);
eq("it needs one more", est.need.kcalDays, 1);

scenario({ weighEvery: 5 });
est = store.tdee().now;
eq("five weigh-ins isn't enough", est.need.weighIns, 1);

scenario({ weighEvery: 4 });
ok("six weigh-ins spread over 20 days is", store.tdee().now.ready);

scenario({ weighOn: (d) => d <= 6 });
est = store.tdee().now;
eq("six weigh-ins bunched into one week isn't", est.ready, false);
eq("they need spreading over five more days", est.need.span, 5);

store.reset();
est = store.tdee().now;
eq("an empty log needs everything", [est.need.kcalDays, est.need.weighIns, est.need.span].join(),
   [store.TDEE_NEEDS.kcalDays, store.TDEE_NEEDS.weighIns, store.TDEE_NEEDS.span].join());

group("maintenance: it moves when you do");
scenario({ days: 28 });
let both = store.tdee();
ok("a steady month is steady week to week", both.change !== null && Math.abs(both.change) <= 20,
   both.change);

/* Three weeks at 2,300 holding, then a week of the same food while losing a
   pound a week — a new job on your feet. The estimate should rise. */
store.reset();
for (let d = 28; d >= 1; d--) {
  store.setNutrition(keyAgo(d), { kcal: 2300 });
  store.addBodyweight(d > 7 ? 185 : 185 - (7 - d + 1) / 7, keyAgo(d));
}
both = store.tdee();
ok("more activity shows up as a higher maintenance", both.change > 100,
   both.weekAgo && both.weekAgo.tdee + " -> " + both.now.tdee);

/* ------------------------------------------ the vault, with no IndexedDB */
group("vault degrades quietly with no IndexedDB");
const results = await Promise.all([
  vault.available(),
  vault.snapshot(store.toBackup(), "test"),
  vault.list(),
  vault.count(),
  vault.read(1),
  vault.remove(1),
  vault.prune(),
  vault.persist(),
  vault.estimate(),
  vault.status()
]);
eq("available() says no", results[0], false);
eq("snapshot() resolves to nothing", results[1], null);
eq("list() is empty", results[2], []);
eq("count() is zero", results[3], 0);
eq("read() is null", results[4], null);
eq("remove() is false", results[5], false);
eq("prune() removed nothing", results[6], 0);
eq("persist() has no opinion", results[7], null);
eq("estimate() is null", results[8], null);
eq("status() still answers", results[9], { persisted:null, estimate:null, snapshots:0 });

eq("describe reads a snapshot's contents", vault.describe(store.toBackup()).sessions,
   store.sessionsOnly().length);
eq("describe survives garbage", vault.describe("not json"),
   { sessions:0, entries:0, weighIns:0, cycle:1 });

/* ------------------------------------------------------------------ done */
console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) {
  console.log("\nfailures:\n  " + failures.join("\n  "));
  process.exit(1);
}
