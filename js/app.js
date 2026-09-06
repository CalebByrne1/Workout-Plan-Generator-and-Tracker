/* ==========================================================================
   app.js — event wiring, the rest timer, and boot.

   All clicks are handled by delegation on four containers (rail, view,
   sheet body, action bar) so re-rendering never leaves dead listeners behind.

   Logging a set has two speeds:
     tap an empty set   logs it at the working weight and the top of the rep
                        target, and starts the rest timer. One tap, done.
     tap a logged set   opens the set logger, where the reps can be corrected
                        and drops added.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var store = IL.store;
var ui = IL.ui;

function $(id){ return document.getElementById(id); }

/* View state that isn't worth persisting. */
var view = "train";          /* "train" | "log"                            */
var openSession = -1;        /* index of the expanded log entry, -1 none    */
var editing = -1;            /* exercise index open in the editor sheet     */
var editingSet = null;       /* { row, k } open in the set logger, or null  */

/* --------------------------------------------------------------------------
   Rest timer
   -------------------------------------------------------------------------- */

var rest = { left:0, id:null };

function startRest(seconds){
  rest.left = seconds;
  if(rest.id) clearInterval(rest.id);
  rest.id = setInterval(tickRest, 1000);
  paintTimer();
}

function stopRest(){
  if(rest.id) clearInterval(rest.id);
  rest.id = null;
  rest.left = 0;
  paintTimer();
}

function tickRest(){
  rest.left--;
  if(rest.left <= 0){
    stopRest();
    ui.toast("Rest is up — next set.");
    if(navigator.vibrate) navigator.vibrate([90, 60, 90]);
    return;
  }
  paintTimer();
}

function paintTimer(){
  var running = rest.id !== null;
  var seconds = running ? rest.left : store.state.prefs.restCompound;
  $("timerT").textContent = ui.formatClock(seconds);
  $("timerL").textContent = running ? "Tap to stop" : "Rest";
  $("timer").dataset.run = running ? "1" : "0";
}

/* --------------------------------------------------------------------------
   Views
   -------------------------------------------------------------------------- */

function render(){
  if(view === "train") ui.renderTrain();
  else ui.renderLog(openSession);
  syncTabs();
}

function syncTabs(){
  $("tabTrain").setAttribute("aria-pressed", view === "train");
  $("tabLog").setAttribute("aria-pressed", view === "log");
}

function showTrain(){
  view = "train";
  render();
}

function showLog(){
  view = "log";
  openSession = -1;
  render();
}

/* --------------------------------------------------------------------------
   Top bar and rotation rail
   -------------------------------------------------------------------------- */

$("tabTrain").addEventListener("click", showTrain);
$("tabLog").addEventListener("click", showLog);

$("rail").addEventListener("click", function(ev){
  var btn = ev.target.closest("button[data-day]");
  if(!btn) return;
  store.state.day = parseInt(btn.dataset.day, 10);
  store.save();
  showTrain();
  window.scrollTo({ top:0, behavior:"smooth" });
});

/* --------------------------------------------------------------------------
   Main view
   -------------------------------------------------------------------------- */

$("view").addEventListener("click", function(ev){
  var t = ev.target;
  var hit;

  hit = t.closest("[data-set]");
  if(hit){
    var parts = hit.dataset.set.split(",");
    var row = parseInt(parts[0], 10);
    var k = parseInt(parts[1], 10);
    var e = store.currentDay().ex[row];

    if(store.isLogged(e, k)){
      /* Already logged — go correct the reps or add a drop. */
      editingSet = { row:row, k:k };
      ui.setSheet(row, k);
      return;
    }

    store.quickLog(e, k);
    if(store.state.prefs.autoRest) startRest(store.restFor(e.name));
    store.save();
    ui.patchExercise(row);
    return;
  }

  hit = t.closest("[data-edit]");
  if(hit){
    editing = parseInt(hit.dataset.edit, 10);
    ui.exerciseSheet(editing);
    return;
  }

  if(t.closest("#addEx")){
    editing = -1;
    ui.librarySheet("add");
    return;
  }

  /* --- log view --- */

  hit = t.closest("[data-open]");
  if(hit){
    var i = parseInt(hit.dataset.open, 10);
    openSession = (openSession === i) ? -1 : i;
    ui.renderLog(openSession);
    return;
  }

  hit = t.closest("[data-del]");
  if(hit){
    store.state.history.splice(parseInt(hit.dataset.del, 10), 1);
    openSession = -1;
    store.save();
    ui.renderLog(openSession);
    ui.toast("Session deleted.");
    return;
  }

  hit = t.closest("[data-unit]");
  if(hit){
    store.state.prefs.unit = hit.dataset.unit;
    store.save();
    ui.renderLog(openSession);
    return;
  }

  hit = t.closest("[data-step]");
  if(hit){
    store.state.prefs.step = parseFloat(hit.dataset.step);
    store.save();
    ui.renderLog(openSession);
    return;
  }

  hit = t.closest("[data-auto]");
  if(hit){
    store.state.prefs.autoRest = hit.dataset.auto === "1";
    store.save();
    ui.renderLog(openSession);
    return;
  }

  if(t.closest("#resetAll")){
    if(confirm("Reset everything? Your plan, history and settings will be erased.")){
      store.reset();
      openSession = -1;
      stopRest();
      showTrain();
      ui.toast("Back to the starting plan.");
    }
  }
});

$("view").addEventListener("input", function(ev){
  if(ev.target.id === "dayNotes"){
    store.currentDay().notes = ev.target.value;
    store.save();
  }
});

/* --------------------------------------------------------------------------
   Bottom sheet
   -------------------------------------------------------------------------- */

$("sheetClose").addEventListener("click", ui.closeSheet);
$("scrim").addEventListener("click", ui.closeSheet);

document.addEventListener("keydown", function(ev){
  if(ev.key === "Escape" && !$("sheet").hidden) ui.closeSheet();
});

/* --- the set logger --------------------------------------------------- */

function setSheetClick(t){
  var e = store.currentDay().ex[editingSet.row];
  var k = editingSet.k;
  var hit;

  /* Stepper: data-seg is "w|r, segment index, delta". */
  hit = t.closest("[data-seg]");
  if(hit){
    var parts = hit.dataset.seg.split(",");
    var index = parseInt(parts[1], 10);
    var delta = parseFloat(parts[2]);
    var seg = e.log[k][index];

    if(parts[0] === "w") store.setSegmentWeight(e, k, index, (seg.w || 0) + delta);
    else store.setSegmentReps(e, k, index, (seg.r || 0) + delta);

    store.save();
    ui.patchExercise(editingSet.row);
    ui.setSheet(editingSet.row, k);
    return true;
  }

  hit = t.closest("[data-repquick]");
  if(hit){
    store.setSegmentReps(e, k, 0, hit.dataset.repquick);
    store.save();
    ui.patchExercise(editingSet.row);
    ui.setSheet(editingSet.row, k);
    return true;
  }

  hit = t.closest("[data-segdel]");
  if(hit){
    store.removeSegment(e, k, parseInt(hit.dataset.segdel, 10));
    store.save();
    ui.patchExercise(editingSet.row);
    ui.setSheet(editingSet.row, k);
    return true;
  }

  if(t.closest("#addDrop")){
    store.addSegment(e, k);
    store.save();
    ui.patchExercise(editingSet.row);
    ui.setSheet(editingSet.row, k);
    return true;
  }

  if(t.closest("#clearSet")){
    store.clearSet(e, k);
    store.save();
    ui.patchExercise(editingSet.row);
    editingSet = null;
    ui.closeSheet();
    ui.toast("Set cleared.");
    return true;
  }

  return false;
}

/* --- the exercise editor and the library picker ----------------------- */

$("sheetBody").addEventListener("click", function(ev){
  var t = ev.target;
  var day = store.currentDay();
  var hit;

  if(ui.sheetMode() === "set" && editingSet){
    if(setSheetClick(t)) return;
  }

  /* Picked something out of the library — either a swap or an addition. */
  hit = t.closest("[data-pick]");
  if(hit){
    var name = hit.dataset.pick;
    if(ui.sheetMode() === "swap" && editing >= 0){
      var target = day.ex[editing];
      var fresh = store.newExercise(name);
      target.name = fresh.name;
      target.sets = fresh.sets;
      target.reps = fresh.reps;
      target.weight = 0;
      target.log = [];
      store.save();
      ui.renderTrain();
      ui.exerciseSheet(editing);
    }else{
      day.ex.push(store.newExercise(name));
      store.save();
      ui.renderTrain();
      ui.closeSheet();
      ui.toast(name + " added to " + day.name + ".");
    }
    return;
  }

  if(t.closest("#swapBtn")){
    ui.librarySheet("swap");
    return;
  }

  if(editing < 0 || ui.sheetMode() !== "edit") return;
  var e = day.ex[editing];

  hit = t.closest("[data-w]");
  if(hit){
    $("fW").value = store.addWeight(e, parseFloat(hit.dataset.w)) || "";
    store.save();
    ui.patchExercise(editing);
    return;
  }

  hit = t.closest("[data-s]");
  if(hit){
    $("fS").value = store.setSets(e, e.sets + parseInt(hit.dataset.s, 10));
    store.save();
    ui.renderTrain();          /* set count changes the row's shape */
    return;
  }

  hit = t.closest("[data-r]");
  if(hit){
    e.reps = hit.dataset.r;
    $("fR").value = e.reps;
    store.save();
    ui.patchExercise(editing);
    return;
  }

  hit = t.closest("[data-move]");
  if(hit){
    var to = editing + parseInt(hit.dataset.move, 10);
    if(!store.moveExercise(day, editing, to)){
      ui.toast("Already at the " + (to < 0 ? "top" : "bottom") + ".");
      return;
    }
    editing = to;
    store.save();
    ui.renderTrain();
    ui.toast("Moved to position " + (to + 1) + ".");
    return;
  }

  if(t.closest("[data-remove]")){
    var gone = day.ex.splice(editing, 1)[0];
    editing = -1;
    store.save();
    ui.renderTrain();
    ui.closeSheet();
    ui.toast(gone.name + " removed.");
  }
});

/* Typed input. The sheet is never re-rendered here, or the field being
   typed into would lose focus mid-number. */
$("sheetBody").addEventListener("input", function(ev){
  var t = ev.target;
  var mode = ui.sheetMode();

  if(mode === "set" && editingSet && t.dataset.segval){
    var parts = t.dataset.segval.split(",");
    var index = parseInt(parts[1], 10);
    var e = store.currentDay().ex[editingSet.row];

    if(parts[0] === "w") store.setSegmentWeight(e, editingSet.k, index, parseFloat(t.value) || 0);
    else store.setSegmentReps(e, editingSet.k, index, t.value);

    store.save();
    ui.patchExercise(editingSet.row);
    ui.refreshSetTotal(editingSet.row, editingSet.k);
    return;
  }

  if(mode !== "edit" || editing < 0) return;
  var ex = store.currentDay().ex[editing];

  if(t.id === "fW")      ex.weight = Math.max(0, parseFloat(t.value) || 0);
  else if(t.id === "fR") ex.reps = t.value;
  else if(t.id === "fN") ex.note = t.value;
  else return;

  store.save();
  ui.patchExercise(editing);
});

$("sheetBody").addEventListener("change", function(ev){
  if(ui.sheetMode() !== "edit" || editing < 0) return;
  var e = store.currentDay().ex[editing];

  if(ev.target.id === "fS"){
    ev.target.value = store.setSets(e, ev.target.value);
    store.save();
    ui.renderTrain();
  }else if(ev.target.id === "fR" && !ev.target.value.trim()){
    /* Don't let the target be left blank. */
    e.reps = "8-10";
    ev.target.value = e.reps;
    store.save();
    ui.patchExercise(editing);
  }
});

/* --------------------------------------------------------------------------
   Action bar
   -------------------------------------------------------------------------- */

$("timer").addEventListener("click", function(){
  if(rest.id) stopRest();
  else startRest(store.state.prefs.restCompound);
});

$("finish").addEventListener("click", function(){
  var day = store.currentDay();

  /* Finishing an empty session is almost always a mispress — ask once. */
  if(store.dayProgress(day).done === 0 && this.dataset.armed !== "1"){
    ui.setFinishLabel(true);
    setTimeout(function(){
      if($("finish").dataset.armed === "1") ui.setFinishLabel(false);
    }, 4000);
    return;
  }

  var finished = store.finishSession();
  editingSet = null;
  editing = -1;
  stopRest();
  render();
  window.scrollTo({ top:0, behavior:"smooth" });
  ui.toast(finished.name + " logged · " + store.currentDay().name + " is up next.");
});

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

ui.init();
store.onSaveError = function(){
  ui.toast("Couldn't save — device storage is full or blocked.");
};
paintTimer();
render();

/* Offline support. Only meaningful over http(s); skipped when the file is
   opened straight off the disk. */
if("serviceWorker" in navigator && location.protocol.indexOf("http") === 0){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("sw.js").catch(function(){
      /* Offline is a bonus, not a requirement — a failure here is silent. */
    });
  });
}

})(window.IL);
