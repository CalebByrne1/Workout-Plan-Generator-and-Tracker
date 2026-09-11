/* ==========================================================================
   test/harness.js — the in-page half of the browser tests.

   Injected into index.html by test/browser.mjs, which reads the results back
   out of the dumped DOM. Plain ES5-ish script, same as the app.

   WAITING. Headless runs on virtual time: timers are fast-forwarded, but
   IndexedDB is real I/O and is not. A fixed gap between steps is therefore
   no gap at all as far as a snapshot is concerned — the first version of
   this file asserted on imports and resets before the snapshot guarding
   them had landed. So every vault call is tracked, and settle() waits for
   all of them (and anything their callbacks start) before a step moves on.
   A step may also return a promise, and the runner waits on that too.
   ========================================================================== */

(function(){
"use strict";

var out = [], pass = 0, fail = 0;

function ok(label, cond, extra){
  if(cond){ pass++; out.push("  ok   " + label); }
  else { fail++; out.push("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
function eq(label, a, b){ ok(label + " = " + b, String(a) === String(b), a); }
function head(name){ out.push(""); out.push("--- " + name + " ---"); }

function $(id){ return document.getElementById(id); }
function q(sel){ return document.querySelector(sel); }
function qa(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); }

function click(target){
  var el = typeof target === "string" ? q(target) : target;
  if(!el){ fail++; out.push("  FAIL nothing to click: " + target); return false; }
  el.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true }));
  return true;
}
function type(sel, value){
  var el = q(sel);
  if(!el){ fail++; out.push("  FAIL no field: " + sel); return; }
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles:true }));
}
function change(sel, value){
  var el = q(sel);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles:true }));
}

/* A movable clock, so the rest timer's deadline logic can be tested without
   waiting three real minutes. */
var realNow = Date.now;
var offset = 0;
Date.now = function(){ return realNow() + offset; };
function travel(seconds){ offset = seconds * 1000; }
function backToNow(){ offset = 0; }

window.confirm = function(){ return true; };
window.onerror = function(m, src, line){
  fail++;
  out.push("  FAIL js error: " + m + " @line " + line);
};

var IL = window.IL;

/* --------------------------------------------------------------------------
   Tracking the vault

   Every vault method is wrapped so its promise is remembered. The app looks
   IL.vault.x up at call time, so the wrapper sees its calls too. The app's
   own .then callbacks were attached first, so they run before ours — and if
   they start more vault work, the loop in settle() catches that as well.
   -------------------------------------------------------------------------- */
var pending = [];

Object.keys(IL.vault).forEach(function(k){
  var fn = IL.vault[k];
  if(typeof fn !== "function") return;
  IL.vault[k] = function(){
    var p = fn.apply(IL.vault, arguments);
    if(p && typeof p.then === "function") pending.push(p);
    return p;
  };
});

function settle(){
  if(!pending.length) return Promise.resolve();
  var batch = pending;
  pending = [];
  return Promise.all(batch.map(function(p){ return p.then(null, function(){}); }))
    .then(function(){ return settle(); });
}

var steps = [];
function step(fn){ steps.push(fn); }
var stash = {};

/* ------------------------------------------------------------------ boot */
step(function(){
  head("boot");
  ok("train view rendered", qa(".ex").length > 0, qa(".ex").length);
  eq("rail has four days", qa("#rail button").length, 4);
  ok("sets rendered", qa(".set").length > 0, qa(".set").length);
  ok("vault module present", !!IL.vault);
  return IL.vault.available().then(function(v){
    ok("IndexedDB is available over http", v === true, v);
  });
});

step(function(){
  head("storage status");
  return IL.vault.status().then(function(st){
    ok("reports a snapshot count", typeof st.snapshots === "number", st.snapshots);
    ok("persist() answered", st.persisted !== undefined, String(st.persisted));
    ok("estimate came back", !!st.estimate, JSON.stringify(st.estimate));
  });
});

/* ----------------------------------------------------------- rest timer */
step(function(){
  head("rest timer");
  click("#timer");
  eq("timer running", $("timer").dataset.run, "1");
  var shown = $("timerT").textContent;
  ok("starts at the full rest", shown === "3:00" || shown === "2:59", shown);

  /* Five seconds pass. The interval is irrelevant — the deadline is what
     the display is derived from. */
  travel(5);
  document.dispatchEvent(new Event("visibilitychange"));
  eq("five seconds later it reads 2:55", $("timerT").textContent, "2:55");
  eq("and it is still running", $("timer").dataset.run, "1");
});

step(function(){
  head("rest timer through a locked screen");
  /* The phone slept for four minutes and the interval never fired. A
     tick-counting timer would still be showing 2:55. */
  travel(245);
  document.dispatchEvent(new Event("visibilitychange"));
  eq("an expired rest stops rather than freezing", $("timer").dataset.run, "0");
  backToNow();

  click("#timer");
  eq("it can be started again", $("timer").dataset.run, "1");
  travel(10);
  document.dispatchEvent(new Event("visibilitychange"));
  eq("and it counts from the new deadline", $("timerT").textContent, "2:50");
  backToNow();
  click("#timer");
  eq("tapping again stops it", $("timer").dataset.run, "0");
});

/* -------------------------------------------------------------- logging */
step(function(){
  head("logging a set");
  var before = $("progCount").textContent;
  click(qa(".set")[0]);
  eq("set marks itself logged", qa(".set")[0].getAttribute("aria-pressed"), "true");
  ok("counter moved", $("progCount").textContent !== before,
     before + " -> " + $("progCount").textContent);
});

step(function(){
  head("set logger");
  click(qa(".set")[0]);
  eq("sheet mode", $("sheet").dataset.mode, "set");
  var field = q('[data-segval="r,0"]');
  var was = field.value;
  click('[data-seg="r,0,1"]');
  eq("stepper updates in place", q('[data-segval="r,0"]').value, String(Number(was) + 1));
  ok("without rebuilding the sheet", q('[data-segval="r,0"]') === field);
  click("#sheetClose");
});

/* ------------------------------------------------------------- library */
step(function(){
  head("library and builder");
  click(q("[data-edit]"));
  eq("editor open", $("sheet").dataset.mode, "edit");
  eq("pin toggle present", qa("[data-pin]").length, 2);
  click("#swapBtn");
});

step(function(){
  ok("library rows rendered", qa(".lib-row").length > 100, qa(".lib-row").length);
  ok("hack squat is there", qa(".lib-row").some(function(r){
    return /Hack Squat Machine/.test(r.textContent);
  }));
  type("#libSearch", "Zercher Squat");
  ok("unknown name offers a build", !!q("[data-newname]"));
  click("[data-newname]");
});

step(function(){
  eq("builder open", $("sheet").dataset.mode, "builder");
  eq("name pre-filled", $("nxName").value, "Zercher Squat");
  click('[data-nxtype="compound"]');
  $("nxGroup").value = "Legs";
  $("nxSets").value = "4";
  $("nxReps").value = "5-8";
  change("#nxPattern", "squat");
  click("#nxSave");
});

step(function(){
  head("builder result");
  var lib = IL.store.libLookup("Zercher Squat");
  ok("saved to the library", lib.pattern === "squat" && lib.type === "compound",
     JSON.stringify(lib));
  ok("joined the squat pool", IL.store.poolFor("V-Squat Machine").indexOf("Zercher Squat") >= 0);
  eq("and took the slot it was swapped into", IL.store.currentDay().ex[0].name, "Zercher Squat");
});

/* ----------------------------------------------------------- the import */
step(function(){
  head("import");
  click("#tabLog");
  ok("past-workouts button", !!$("addPast"));
  ok("variety control", qa("[data-var]").length === 4, qa("[data-var]").length);
  ok("re-seed button", !!$("reseedAll"));
  return settle();          /* the log view paints its snapshot list async */
});

step(function(){
  click("#addPast");
});

step(function(){
  eq("import sheet open", $("sheet").dataset.mode, "import");
  ok("run button starts disabled", $("impRun").disabled);
  type("#impText", [
    "2026-08-04 Upper A",
    "Incline Smith Press 135x8 135x8 145x6",
    "Barbell Bent-Over Row 155x8x3",
    "Pull-Ups BWx9 BWx7",
    "",
    "8/6/26 Lower A",
    "hack squat 250x8x4",
    "Nonsense Line With No Numbers"
  ].join("\n"));
  ok("preview counts the sessions", /2 sessions/.test($("impView").textContent),
     $("impView").textContent.slice(0, 60));
  ok("run button enabled", !$("impRun").disabled);
  ok("the bad line is reported", /1 line skipped/.test($("impView").textContent));

  eq("nothing is written until the snapshot lands", IL.store.state.history.length, 0);
  click("#impRun");
  return settle();
});

step(function(){
  head("import result");
  eq("history has two sessions", IL.store.state.history.length, 2);
  var h = IL.store.state.history;
  eq("day matched", h[0] && h[0].dayName, "Upper A");
  eq("loose name canonicalised", h[1] && h[1].entries[0].name, "Hack Squat Machine");
  eq("the row earned its +5", IL.store.state.days[0].ex[1].weight, 160);

  return IL.vault.list().then(function(rows){
    head("snapshots");
    ok("importing took a snapshot first", rows.length >= 1, rows.length);
    var guard = rows.filter(function(r){ return /before importing/.test(r.reason); })[0];
    ok("and said what it was for", !!guard,
       rows.map(function(r){ return r.reason; }).join(" / "));
    ok("that snapshot is of the log BEFORE the import", guard && guard.sessions === 0,
       guard && guard.sessions);
    ok("it has a size", guard && guard.bytes > 0, guard && guard.bytes);
  });
});

step(function(){
  head("the data panel");
  return settle().then(function(){
    ok("snapshot rows rendered", qa(".snaprow").length >= 1, qa(".snaprow").length);
    ok("restore buttons present", qa("[data-snaprestore]").length >= 1);
    ok("storage status filled in", $("storeStat").textContent.indexOf("Checking") < 0,
       $("storeStat").textContent.slice(0, 70));
    ok("export nudge shown when nothing has left the device", !!q(".nudge"), "no nudge");
    ok("and it says so", /never taken a copy/.test(q(".nudge") ? q(".nudge").textContent : ""),
       q(".nudge") && q(".nudge").textContent.slice(0, 50));
  });
});

step(function(){
  head("the nudge goes away once a copy is taken");
  IL.store.markExported();
  IL.ui.renderLog(null);
  ok("nudge gone", !q(".nudge"));
  ok("and it reports the date instead", !!q(".hint.good"),
     q(".hint.good") && q(".hint.good").textContent);
  return settle();
});

step(function(){
  head("manual snapshot");
  click("#snapNow");
  return settle().then(function(){ return IL.vault.list(); }).then(function(rows){
    ok("a snapshot was added by hand",
       rows.some(function(r){ return r.reason === "saved by hand"; }),
       rows.map(function(r){ return r.reason; }).join(" / "));
  });
});

step(function(){
  head("an unchanged state is not snapshotted twice");
  return IL.vault.count().then(function(before){
    click("#snapNow");
    return settle().then(function(){ return IL.vault.count(); }).then(function(after){
      eq("count unchanged", after, before);
    });
  });
});

/* ------------------------------------------------- reset, and undoing it */
step(function(){
  head("reset is undoable");
  stash.sessionsBefore = IL.store.state.history.length;
  ok("there is something to lose", stash.sessionsBefore > 0, stash.sessionsBefore);
  click("#resetAll");
  return settle();
});

step(function(){
  eq("reset cleared the log", IL.store.state.history.length, 0);
  return IL.vault.list().then(function(rows){
    var guard = rows.filter(function(r){ return r.reason === "before reset"; })[0];
    ok("a snapshot was taken before the reset", !!guard,
       rows.map(function(r){ return r.reason; }).join(" / "));
    ok("and it holds the sessions that were lost",
       guard && guard.sessions === stash.sessionsBefore,
       guard && (guard.sessions + " vs " + stash.sessionsBefore));
    stash.guardId = guard && guard.id;
  });
});

step(function(){
  click("#tabLog");
  return settle();
});

step(function(){
  if(!stash.guardId){ ok("cannot test rollback without a snapshot", false); return; }
  click('[data-snaprestore="' + stash.guardId + '"]');
  return settle();
});

step(function(){
  eq("rolling back restored the log", IL.store.state.history.length, stash.sessionsBefore);
  ok("and the custom exercise came back too", IL.store.isCustom("Zercher Squat"));
  return IL.vault.list().then(function(rows){
    ok("the rollback itself was snapshotted first, so it is undoable too",
       rows.some(function(r){ return r.reason === "before rolling back"; }),
       rows.map(function(r){ return r.reason; }).join(" / "));
  });
});

/* ------------------------------------------------ finishing a session */
step(function(){
  head("finishing a session snapshots it");
  click("#tabTrain");
  var day = IL.store.currentDay();
  stash.dayName = day.name;
  day.ex.forEach(function(e){
    e.log = [];
    for(var i = 0; i < e.sets; i++) e.log[i] = [{ w:e.weight || 100, r:IL.store.repTop(e.reps) }];
  });
  IL.ui.renderTrain();
  click("#finish");
  return settle().then(function(){ return IL.vault.list(); }).then(function(rows){
    ok("newest snapshot is the finished session",
       rows[0] && rows[0].reason === "after " + stash.dayName,
       rows[0] && rows[0].reason);
  });
});

/* ------------------------------------------------------------ nutrition */
function dayAgo(n){
  var d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return IL.store.dayKey(d.getTime());
}

step(function(){
  head("nutrition: first look");
  click("#tabProgress");
  ok("nutrition card present", !!$("logFood"));
  eq("no target yet, so the button offers to set one", $("editGoal").textContent, "Set target");
  ok("the over/under chart explains itself when empty", !!q("#chFood .chart-empty"),
     $("chFood").textContent.slice(0, 60));
  ok("a legend names both directions", qa(".chart-key .sw[data-dir]").length === 2,
     qa(".chart-key .sw[data-dir]").length);
});

step(function(){
  head("nutrition: logging yesterday, from today's sheet");
  click("#logFood");
  eq("food sheet open", $("sheet").dataset.mode, "food");
  eq("it opens on today", $("fdDate").value, dayAgo(0));
  type("#fdKcal", "1900");
  type("#fdProt", "150");
  /* "Oh — that was yesterday." The typing should survive the date change. */
  change("#fdDate", dayAgo(1));
  eq("typed calories survive moving to an empty day", $("fdKcal").value, "1900");
  eq("and so does protein", $("fdProt").value, "150");
  click("#saveFood");
  var y = IL.store.nutritionOn(dayAgo(1));
  eq("saved against yesterday", y && y.kcal, 1900);
  eq("fiber left blank is not logged", y && String(y.fiber), "null");
  eq("today untouched", IL.store.nutritionOn(dayAgo(0)), null);
});

step(function(){
  head("nutrition: logging today, protein but no fiber");
  click("#logFood");
  type("#fdKcal", "2350");
  type("#fdProt", "180");
  click("#saveFood");
  eq("today saved", IL.store.nutritionOn(dayAgo(0)).kcal, 2350);
  ok("fiber shows as not logged, not zero",
     qa(".macro").some(function(m){ return /Fiber/.test(m.textContent) && /not logged/.test(m.textContent); }));
});

step(function(){
  head("nutrition: the first target reaches back");
  click("#editGoal");
  eq("goal sheet open", $("sheet").dataset.mode, "goal");
  eq("the first target starts at the earliest logged day", $("gFrom").value, dayAgo(1));
  type("#gKcal", "2200");
  click('[data-gphase="cut"]');
  eq("phase toggles", q('[data-gphase="cut"]').getAttribute("aria-pressed"), "true");
  click("#saveGoal");
  eq("target saved", IL.store.currentGoal().kcal, 2200);
  eq("with its phase", IL.store.currentGoal().phase, "cut");
  eq("and it covers yesterday", IL.store.goalOn(dayAgo(1)).kcal, 2200);
});

step(function(){
  head("nutrition: today against the target");
  ok("today reads 150 over", /150 over/.test(q(".food-diff").textContent), q(".food-diff").textContent);
  ok("the diff text is ink, the colour is on a swatch", !!q(".food-diff .sw[data-dir=over]"));
  ok("the meter shows a run past the target", !!q(".meter .meter-over"));
  ok("with the target marked", !!q(".meter .meter-mark"));
  ok("the phase is named", /Cut/.test(q(".food-goal").textContent));
  eq("one bar over", qa('#chFood .c-bar[data-dir="over"]').length, 1);
  eq("one bar under", qa('#chFood .c-bar[data-dir="under"]').length, 1);
  ok("the zero line is drawn", !!q("#chFood .c-zero"));
  eq("both days in the list", qa(".food-row").length, 2);
  ok("the list carries the signed difference", /\+150/.test(qa(".food-row")[0].textContent),
     qa(".food-row")[0].textContent);
});

step(function(){
  head("nutrition: switching to a bulk never re-grades the cut");
  click("#editGoal");
  eq("a change of target starts today", $("gFrom").value, dayAgo(0));
  ok("the previous phase is listed", qa("[data-goaldel]").length === 1);
  type("#gKcal", "3000");
  click('[data-gphase="bulk"]');
  click("#saveGoal");
  var series = IL.store.nutritionSeries(14);
  eq("today is now judged against the bulk", series[13].diff, -650);
  eq("yesterday is still judged against the cut", series[12].diff, 1900 - 2200);
  eq("so both bars now hang under", qa('#chFood .c-bar[data-dir="under"]').length, 2);
  ok("and the card says so", /650 under/.test(q(".food-diff").textContent),
     q(".food-diff").textContent);
});

step(function(){
  head("nutrition: editing a past day from the list");
  click('[data-food="' + dayAgo(1) + '"]');
  eq("opens on that day", $("fdDate").value, dayAgo(1));
  eq("with its numbers", $("fdKcal").value, "1900");
  ok("and a way to clear it", !!$("clearFood"));

  /* Moving to a day that HAS an entry loads it rather than carrying the draft. */
  type("#fdKcal", "1");
  change("#fdDate", dayAgo(0));
  eq("moving to a logged day loads that day", $("fdKcal").value, "2350");

  change("#fdDate", dayAgo(1));
  click("#clearFood");
  eq("the day is gone", IL.store.nutritionOn(dayAgo(1)), null);
  eq("and off the list", qa(".food-row").length, 1);
});

step(function(){
  head("nutrition: an empty save clears, and says so");
  click('[data-food="' + dayAgo(0) + '"]');
  type("#fdKcal", "");
  type("#fdProt", "");
  click("#saveFood");
  eq("today is cleared", IL.store.nutritionOn(dayAgo(0)), null);
  ok("and the toast says cleared, not saved", /Cleared/.test($("toast").textContent),
     $("toast").textContent);
});

step(function(){
  head("nutrition: a long list folds");
  for(var n = 0; n < 10; n++) IL.store.setNutrition(dayAgo(n), { kcal: 2000 + n * 10 });
  IL.ui.renderProgress();
  var visible = qa(".food-row").filter(function(r){ return !r.hidden; });
  eq("seven days showing", visible.length, 7);
  ok("with a way to see the rest", !!$("foodMore"), "no button");
  click("#foodMore");
  eq("all ten after unfolding", qa(".food-row").filter(function(r){ return !r.hidden; }).length, 10);
  ok("and the button goes away", !$("foodMore"));
  ok("averages are whole grams or blank, never a decimal",
     qa(".food-avg-tile b").every(function(b){ return !/\.\d/.test(b.textContent); }),
     qa(".food-avg-tile b").map(function(b){ return b.textContent; }).join(" | "));
});

step(function(){
  head("nutrition: removing a phase");
  click("#editGoal");
  var before = IL.store.state.nutrition.goals.length;
  click(q("[data-goaldel]"));
  eq("one phase fewer", IL.store.state.nutrition.goals.length, before - 1);
  click("#sheetClose");
});

/* ---------------------------------------------- weight trend, maintenance */
function tile(label){
  return qa(".stat").filter(function(s){ return s.textContent.indexOf(label) >= 0; })[0];
}

step(function(){
  head("weight: the 7-day average leads");
  IL.store.state.body = [];
  IL.store.addBodyweight(184, dayAgo(9));
  IL.store.addBodyweight(182, dayAgo(2));
  IL.store.addBodyweight(181, dayAgo(1));
  IL.store.addBodyweight(183, dayAgo(0));
  IL.ui.renderProgress();

  var t = tile("7-day avg");
  ok("the tile is the weekly average", !!t, qa(".stat .k").map(function(k){ return k.textContent; }).join(" | "));
  ok("of this week's three readings, not today's single one", t && /182\.0/.test(t.textContent),
     t && t.textContent);
  ok("compared with last week's average", t && /−2\.0 vs last week/.test(t.textContent),
     t && t.textContent);

  eq("every reading is a faint dot under the line", qa("#chBody .c-raw").length, 4);
  ok("the line has no dots of its own to compete with them",
     qa("#chBody .c-dot").length === 1, qa("#chBody .c-dot").length);
  ok("the readout gives the average and the reading",
     /182\.0 lb avg · weighed 183\.0/.test(q("#chBody .chart-read b").textContent),
     q("#chBody .chart-read b").textContent);
  ok("the legend names both", qa("#chBody").length && /7-day average/.test(q("#chBody").parentNode.textContent));
});

step(function(){
  head("maintenance: honest about not being ready");
  var card = qa(".card").filter(function(c){ return /Maintenance/.test(c.textContent); })[0];
  ok("the card is there", !!card);
  ok("with no number yet", card && /not enough to go on/.test(card.textContent));
  ok("and a list of exactly what's missing", card && card.querySelectorAll(".tdee-need li").length >= 1,
     card && card.querySelector(".tdee-need") && card.querySelector(".tdee-need").textContent);
  click("#editGoal");
  ok("the target sheet offers no suggestions it can't back up", !q("[data-suggest]"));
  click("#sheetClose");
});

step(function(){
  head("maintenance: three weeks in");
  IL.store.state.body = [];
  IL.store.state.nutrition.days = {};
  IL.store.state.nutrition.goals = [];
  for(var d = 21; d >= 1; d--){
    IL.store.setNutrition(dayAgo(d), { kcal: 2300 });
    IL.store.addBodyweight(185 - (21 - d) * 0.5 / 7, dayAgo(d));
  }
  IL.store.setGoal({ kcal: 2100, phase: "cut", from: dayAgo(21) });
  IL.ui.renderProgress();

  var card = qa(".card").filter(function(c){ return /Maintenance/.test(c.textContent); })[0];
  var n = card && card.querySelector(".tdee-num b").textContent.replace(/,/g, "");
  ok("a number, near the truth of 2,550", Math.abs(Number(n) - 2550) <= 20, n);
  ok("with its margin", card && /±/.test(card.querySelector(".tdee-band").textContent));
  ok("and what it's made of", card && /Averaging 2,300 kcal/.test(card.textContent) &&
     /losing 0\.5 lb a week/.test(card.textContent), card && card.querySelector(".tdee-why").textContent);
  ok("and what it means for the target", card && /2,100 target is/.test(card.textContent) &&
     /below/.test(card.textContent), card && card.querySelector(".tdee-goal") && card.querySelector(".tdee-goal").textContent);
});

step(function(){
  head("maintenance: suggestions in the target sheet");
  click("#editGoal");
  eq("three starting points", qa("[data-suggest]").length, 3);
  var est = IL.store.tdee().now.tdee;
  var cut = q('[data-suggest][data-sphase="cut"]');
  click(cut);
  eq("Cut fills maintenance minus 500", $("gKcal").value, String(est - 500));
  eq("and picks the Cut phase", q('[data-gphase="cut"]').getAttribute("aria-pressed"), "true");
  eq("nothing is saved until you press Save", IL.store.currentGoal().kcal, 2100);
  click('[data-suggest][data-sphase="bulk"]');
  eq("Bulk fills maintenance plus 250", $("gKcal").value, String(est + 250));
  eq("and moves the phase with it", q('[data-gphase="bulk"]').getAttribute("aria-pressed"), "true");
  click("#sheetClose");
});

/* ------------------------------------------------------------- progress */
step(function(){
  head("progress tab");
  click("#tabProgress");
  ok("progress rendered", /Strength trend/.test($("view").textContent));
  ok("charts drawn", qa(".chart").length >= 1, qa(".chart").length);
  ok("calendar drawn", qa(".cal-c").length > 60, qa(".cal-c").length);
});

/* --------------------------------------------------------------- mobile */
step(function(){
  head("mobile");
  var root = getComputedStyle(document.documentElement);
  eq("double-tap zoom is off", root.touchAction, "manipulation");

  click("#tabTrain");
  var btn = q(".set");
  eq("buttons too", getComputedStyle(btn).touchAction, "manipulation");
  eq("and are not selectable", getComputedStyle(btn).webkitUserSelect, "none");

  var ev = new MouseEvent("dblclick", { bubbles:true, cancelable:true });
  document.body.dispatchEvent(ev);
  ok("double-click is cancelled", ev.defaultPrevented);
  ok("pinch zoom left alone",
     !/user-scalable=no|maximum-scale/.test(q('meta[name=viewport]').content),
     q('meta[name=viewport]').content);
});

step(function(){
  head("no field is small enough to zoom iOS on focus");
  click("#tabLog");
  return settle();
});

step(function(){
  click("#addPast");
});

step(function(){
  var small = [];
  qa("input, textarea, select").forEach(function(el){
    var size = parseFloat(getComputedStyle(el).fontSize);
    if(el.type !== "file" && el.type !== "hidden" && size < 16){
      small.push((el.id || el.type) + "@" + size + "px");
    }
  });
  eq("every visible field is 16px or more", small.join(",") || "none", "none");
  click("#sheetClose");
});

/* ----------------------------------------------------------------- sync

   Driven through the real screens, against test/fake-supabase.js standing in
   for Supabase inside the page. Last in the run, so live syncing can't
   disturb anything above. */

var fake = new window.FakeSupabase({ url: IL.sync.config.url, key: IL.sync.config.key });
var realFetch = window.fetch.bind(window);
window.fetch = function(u, init){
  return String(u).indexOf(fake.url) === 0 ? fake.fetch(u, init) : realFetch(u, init);
};
IL.sync.config.pushDelay = 30;
IL.sync.config.checkEvery = 0;

var EMAIL = "caleb@example.com";
function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function uidOf(email){ return fake.userId(email); }

step(function(){
  head("sync: signed out");
  click("#tabLog");
  ok("the sync box is on the Log tab", !!$("syncBox"));
  ok("asking for an email", !!$("syEmail") && !!$("sySend"));
  ok("the email field is 16px, so focusing it can't zoom the phone",
     parseFloat(getComputedStyle($("syEmail")).fontSize) >= 16, getComputedStyle($("syEmail")).fontSize);
  ok("the old 'nowhere to upload it to' promise is gone", !/nowhere/.test($("view").textContent));
});

step(function(){
  head("sync: sending a code");
  $("syEmail").value = "not an email";
  click("#sySend");
  ok("a bad address is caught before sending", /doesn't look like an email/.test($("syErr").textContent),
     $("syErr") && $("syErr").textContent);
  eq("and nothing was sent", fake.requests.length, 0);

  $("syEmail").value = EMAIL;
  click("#sySend");
  return wait(80).then(function(){
    ok("a code was requested", !!fake.codeFor(EMAIL));
    ok("the form moved on to the code", !!$("syCode"));
    ok("naming where it went", $("syncBox").textContent.indexOf(EMAIL) >= 0);
    eq("the code field hints the phone to offer the code from the email",
       $("syCode").getAttribute("autocomplete"), "one-time-code");
  });
});

step(function(){
  head("sync: a wrong code");
  $("syCode").value = "000000";
  click("#syVerify");
  return wait(120).then(function(){
    ok("refused in plain words", /didn't work/.test(($("syErr") || {}).textContent || ""),
       $("syErr") && $("syErr").textContent);
    eq("the code is left in place to fix", $("syCode").value, "000000");
    eq("still signed out", IL.sync.info().signedIn, false);
  });
});

step(function(){
  head("sync: signing in");
  $("syCode").value = fake.codeFor(EMAIL);
  click("#syVerify");
  return wait(300).then(function(){
    ok("signed in", IL.sync.info().signedIn);
    ok("the box shows who", !!q(".syncrow") && q(".syncrow").textContent.indexOf(EMAIL) >= 0);
    ok("and says it synced", /Synced/.test($("syStatus").textContent), $("syStatus").textContent);
    ok("the toast says what happened", /Signed in/.test($("toast").textContent), $("toast").textContent);
    var row = fake.row(uidOf(EMAIL));
    ok("this device's data became the account's", !!row && IL.sync.sameData(row.data, IL.store.state));
    ok("a synced account counts as a copy off the device",
       !!q(".hint.good") && /Synced to your account/.test(q(".hint.good").textContent),
       q(".hint.good") && q(".hint.good").textContent);
    ok("so there's no nag to export", !q(".nudge"));
  });
});

step(function(){
  head("sync: a change goes up on its own");
  var rev = fake.row(uidOf(EMAIL)).rev;
  IL.store.addBodyweight(171.3, dayAgo(40));
  return wait(250).then(function(){
    eq("the account moved on", fake.row(uidOf(EMAIL)).rev, rev + 1);
    ok("carrying the change", fake.row(uidOf(EMAIL)).data.body.some(function(b){ return b.w === 171.3; }));
  });
});

step(function(){
  head("sync: a change from another device comes in");
  var copy = JSON.parse(JSON.stringify(fake.row(uidOf(EMAIL)).data));
  copy.body.push({ at: IL.store.fromDayKey(dayAgo(45)), w: 172.2 });
  fake.writeAs(uidOf(EMAIL), copy, "iPhone");
  document.dispatchEvent(new Event("visibilitychange"));      /* coming back to the app */
  return wait(300).then(function(){
    ok("it arrived", IL.store.state.body.some(function(b){ return b.w === 172.2; }));
    ok("and the app said where from", /Updated from iPhone/.test($("toast").textContent), $("toast").textContent);
    return IL.vault.list();
  }).then(function(rows){
    ok("with a snapshot taken first", rows.some(function(r){ return /before taking changes from iPhone/.test(r.reason); }),
       rows.slice(0, 3).map(function(r){ return r.reason; }).join(" / "));
  });
});

step(function(){
  head("sync: a second account with its own data asks first");
  click("#tabLog");
  click("#syOut");
  ok("signed out", !IL.sync.info().signedIn);
  ok("with the data all still here", IL.store.state.body.length > 0);

  /* An account that already holds different training. */
  var other = JSON.parse(IL.store.toBackup());
  other.body = [{ at: IL.store.fromDayKey(dayAgo(90)), w: 150 }];
  other.history = [];
  fake.users["second@example.com"] = { id: "user-second", email: "second@example.com" };
  fake.rows["user-second"] = {
    user_id: "user-second", data: other, rev: 4, device: "iPad",
    updated_at: new Date().toISOString()
  };

  $("syEmail").value = "second@example.com";
  click("#sySend");
  return wait(80).then(function(){
    $("syCode").value = fake.codeFor("second@example.com");
    click("#syVerify");
    return wait(300);
  }).then(function(){
    eq("it asks", $("sheet").dataset.mode, "syncchoice");
    eq("showing both sides", qa(".choice").length, 2);
    ok("naming the other device", /iPad/.test(q(".choices").textContent));
    eq("with a button for each", qa("[data-keep]").length, 2);
    eq("the account is untouched while it waits", fake.row("user-second").rev, 4);
    click('[data-keep="local"]');
    return wait(250);
  }).then(function(){
    ok("keeping this device's pushed it", fake.row("user-second").rev === 5 &&
       IL.sync.sameData(fake.row("user-second").data, IL.store.state));
    ok("and said the other copy is kept", /kept in Snapshots/.test($("toast").textContent), $("toast").textContent);
    return IL.vault.list();
  }).then(function(rows){
    ok("in a snapshot", rows.some(function(r){ return /account data from iPad/.test(r.reason); }),
       rows.slice(0, 3).map(function(r){ return r.reason; }).join(" / "));
  });
});

step(function(){
  head("sync: signing out");
  click("#tabLog");
  var before = IL.store.state.body.length;
  click("#syOut");
  ok("back to the email form", !!$("syEmail"));
  eq("nothing on this device was touched", IL.store.state.body.length, before);
});

/* ------------------------------------------------------------------ run */

/* Each step may return a promise; the runner waits for it, then gives the
   sheet animations a moment before the next one. A step that never settles
   would hang the run, so browser.mjs's budget is the backstop for that. */
var i = 0;
function report(){
  out.push("");
  out.push(pass + " passed, " + fail + " failed");
  var box = document.createElement("pre");
  box.id = "testout";
  box.textContent = "@@RESULTS@@\n" + out.join("\n") + "\n@@END@@";
  document.body.appendChild(box);
}

function next(){
  if(i >= steps.length){ report(); return; }
  var fn = steps[i++];
  var result;
  try{
    result = fn();
  }catch(err){
    fail++;
    out.push("  FAIL step " + i + " threw: " + err.message);
  }
  Promise.resolve(result).then(null, function(err){
    fail++;
    out.push("  FAIL step " + i + " rejected: " + (err && err.message));
  }).then(function(){
    setTimeout(next, 260);
  });
}

/* Let the app's own boot finish, including its persist() request. */
setTimeout(next, 300);

})();
