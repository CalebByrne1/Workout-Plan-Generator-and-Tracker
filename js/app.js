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
var view = "train";          /* "train" | "log" | "progress"                */
var openSession = null;      /* id of the expanded log entry, or null       */
var editing = -1;            /* exercise index open in the editor sheet     */
var editingSet = null;       /* { row, k } open in the set logger, or null  */
var builderFrom = null;      /* the picker mode the exercise builder came from */
var builderName = null;      /* library entry being edited, or null to create  */

/* --------------------------------------------------------------------------
   Small shared helpers
   -------------------------------------------------------------------------- */

/* Flip a row of toggle buttons by hand rather than re-rendering the sheet,
   so a half-typed field in the same sheet survives the tap. */
function toggleGroup(hit, attr){
  var all = $("sheetBody").querySelectorAll("[data-" + attr + "]");
  for(var i = 0; i < all.length; i++){
    all[i].setAttribute("aria-pressed", all[i] === hit);
  }
}

/* Which of those buttons is currently pressed. */
function pickedValue(attr){
  var el = $("sheetBody").querySelector('[data-' + attr + '][aria-pressed="true"]');
  return el ? el.dataset[attr] : "";
}

/* Open an exercise at the load your log says you have earned rather than at
   nothing. Trained it before — even years ago, even only in an import — and
   the first set is already the right weight. */
function seedFromLog(e){
  var seen = store.lastEntryFor(e.name);
  if(!seen) return e;

  var res = IL.plan.overload(e, seen);
  if(res.kind !== "open"){
    e.weight = res.weight;
    e.reps = res.reps;
    e.progress = { kind:res.kind, note:res.note };
  }
  return e;
}

/* Put a chosen exercise into the day — replacing the one being edited, or on
   the end. Shared by the library picker and by saving a brand-new exercise,
   which both finish the same way. */
function applyPick(name, mode){
  var day = store.currentDay();

  if(mode === "swap" && editing >= 0){
    var target = day.ex[editing];
    var fresh = store.newExercise(name);

    target.name = fresh.name;
    target.sets = fresh.sets;
    target.reps = fresh.reps;
    target.weight = 0;
    target.note = "";
    target.log = [];
    target.pin = false;
    target.rotAge = 0;
    target.progress = null;
    seedFromLog(target);

    store.save();
    ui.renderTrain();
    ui.exerciseSheet(editing);
    return;
  }

  day.ex.push(seedFromLog(store.newExercise(name)));
  store.save();
  ui.renderTrain();
  ui.closeSheet();
  ui.toast(name + " added to " + day.name + ".");
}

/* --------------------------------------------------------------------------
   Signing in to sync

   Two steps: an email, then the code that arrives in it. The form's state
   lives in ui.syncForm; these move it along and redraw.
   -------------------------------------------------------------------------- */

var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* What to say once the first sync after signing in has run. */
var SIGNED_IN = {
  created:   "Signed in — this device's data is now on your account.",
  pulled:    "Signed in — your account's data is on this device.",
  pushed:    "Signed in and synced.",
  unchanged: "Signed in — already up to date.",
  choose:    "",                 /* the question sheet is already on screen */
  offline:   "Signed in — it'll sync when you're back online.",
  error:     "Signed in, but the first sync didn't work — see Sync for why."
};

function sendSyncCode(again){
  var form = ui.syncForm;
  var email = again || ($("syEmail") ? $("syEmail").value.trim() : "");

  form.email = email;
  if(!EMAIL_RE.test(email)){
    form.error = "That doesn't look like an email address.";
    ui.paintSync();
    return;
  }

  form.error = "";
  form.busy = true;
  ui.paintSync();

  IL.sync.sendCode(email).then(function(){
    form.busy = false;
    form.step = "code";
    ui.paintSync();
    if($("syCode")) $("syCode").focus();
    if(again) ui.toast("New code sent.");
  }, function(err){
    form.busy = false;
    form.error = IL.sync.explain(err);
    ui.paintSync();
  });
}

function verifySyncCode(){
  var form = ui.syncForm;
  var code = $("syCode") ? $("syCode").value.replace(/\s+/g, "") : "";

  if(!/^\d{4,10}$/.test(code)){
    form.error = "Type the code from the email — just the digits.";
    ui.paintSync();
    if($("syCode")){ $("syCode").value = code; $("syCode").focus(); }
    return;
  }

  form.error = "";
  form.busy = true;
  ui.paintSync();
  if($("syCode")) $("syCode").value = code;

  IL.sync.verifyCode(form.email, code).then(function(result){
    ui.resetSyncForm();
    ui.paintSync();
    var said = SIGNED_IN.hasOwnProperty(result) ? SIGNED_IN[result] : "Signed in.";
    if(said) ui.toast(said);
  }, function(err){
    form.busy = false;
    form.error = IL.sync.explain(err);
    ui.paintSync();
    /* Put the code back so a typo can be fixed rather than retyped. */
    if($("syCode")){ $("syCode").value = code; $("syCode").focus(); }
  });
}

/* --------------------------------------------------------------------------
   Rest timer
   -------------------------------------------------------------------------- */

/* The deadline, not a count of ticks.

   A phone suspends timers behind a locked screen, so anything that counts
   down by decrementing on an interval is simply wrong when you come back —
   ninety seconds in your pocket might be ten ticks. Storing WHEN the rest
   ends and subtracting the clock makes the number right no matter what the
   browser did with the interval in between. */
var rest = { endsAt:0, id:null };

function restLeft(){
  if(!rest.endsAt) return 0;
  return Math.max(0, Math.ceil((rest.endsAt - Date.now()) / 1000));
}

function startRest(seconds){
  rest.endsAt = Date.now() + seconds * 1000;
  if(rest.id) clearInterval(rest.id);
  /* Twice a second, so the digit shown is never more than half a second
     behind the clock it is derived from. */
  rest.id = setInterval(tickRest, 500);
  paintTimer();
}

function stopRest(){
  if(rest.id) clearInterval(rest.id);
  rest.id = null;
  rest.endsAt = 0;
  paintTimer();
}

function endRest(){
  stopRest();
  ui.toast("Rest is up — next set.");
  if(navigator.vibrate) navigator.vibrate([90, 60, 90]);
}

function tickRest(){
  if(restLeft() > 0){
    paintTimer();
    return;
  }
  endRest();
}

/* Back from a locked screen or another app. The interval may not have run
   at all, so the state is recomputed here rather than trusted. */
document.addEventListener("visibilitychange", function(){
  if(document.hidden || !rest.id) return;

  if(restLeft() > 0){
    paintTimer();
    return;
  }

  /* It ran out while you were away. Say so if you have only just come back;
     a rest that ended ten minutes ago is not news, it's just noise. */
  if(Date.now() - rest.endsAt < 90000) endRest();
  else stopRest();
});

function paintTimer(){
  var running = rest.id !== null;
  var seconds = running ? restLeft() : store.state.prefs.restCompound;
  $("timerT").textContent = ui.formatClock(seconds);
  $("timerL").textContent = running ? "Tap to stop" : "Rest";
  $("timer").dataset.run = running ? "1" : "0";
}

/* --------------------------------------------------------------------------
   Views
   -------------------------------------------------------------------------- */

function render(){
  if(view === "train")         ui.renderTrain();
  else if(view === "progress") ui.renderProgress();
  else                         ui.renderLog(openSession);
  syncTabs();
}

function syncTabs(){
  $("tabTrain").setAttribute("aria-pressed", view === "train");
  $("tabLog").setAttribute("aria-pressed", view === "log");
  $("tabProgress").setAttribute("aria-pressed", view === "progress");
}

function showTrain(){
  view = "train";
  render();
}

function showLog(){
  view = "log";
  openSession = null;
  render();
}

function showProgress(){
  view = "progress";
  render();
}

/* --------------------------------------------------------------------------
   Getting data off the device

   Both routes are needed. An <a download> is the desktop answer and works in
   mobile browsers, but inside an iOS home-screen app it often lands nowhere
   you can find; the share sheet is the one that reliably reaches Mail, Files
   or a note. So: share when the platform offers it, download otherwise.
   -------------------------------------------------------------------------- */

function saveFile(name, text, mime){
  var url = URL.createObjectURL(new Blob([text], { type:mime }));
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

function shareFiles(files){
  try{
    if(!navigator.canShare || !navigator.canShare({ files:files })) return false;
    navigator.share({
      files: files,
      title: "Iron Ledger",
      text: "Training log through " + ui.formatDay(Date.now())
    }).catch(function(){
      /* Cancelling the share sheet rejects; that isn't an error. */
    });
    return true;
  }catch(err){
    return false;
  }
}

function exportCSV(){
  saveFile(store.exportName("csv"), store.toCSV(), "text/csv");
  store.markExported();
  ui.toast("CSV saved.");
}

function exportBackup(){
  saveFile("iron-ledger-backup-" + store.dayKey(Date.now()) + ".json",
           store.toBackup(), "application/json");
  store.markExported();
  ui.toast("Backup saved.");
}

function exportShare(){
  var stamp = store.dayKey(Date.now());
  var files = [];

  try{
    files.push(new File([store.toCSV()], "iron-ledger-" + stamp + ".csv", { type:"text/csv" }));
    files.push(new File([store.toBackup()], "iron-ledger-backup-" + stamp + ".json",
      { type:"application/json" }));
  }catch(err){
    files = [];
  }

  /* Some targets refuse a multi-file share — fall back to the readable one,
     then to a plain download. */
  if(files.length && shareFiles(files)){ store.markExported(); return; }
  if(files.length && shareFiles([files[0]])){ store.markExported(); return; }
  exportCSV();
}

function copyCSV(){
  var text = store.toCSV();

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      store.markExported();
      ui.toast("CSV copied — paste it into a spreadsheet.");
    }, function(){
      ui.toast("Couldn't copy. Use the CSV button instead.");
    });
    return;
  }
  ui.toast("Couldn't copy. Use the CSV button instead.");
}

/* Every route that throws the current state away takes a snapshot first and
   WAITS for it to land. Fire-and-forget would be a race against the very
   thing the snapshot exists to undo. The `true` means "even if it's a copy
   of the last one" — see vault.snapshot(). */
function guard(reason, then){
  IL.vault.snapshot(store.toBackup(), reason, true).then(then, then);
}

function restoreFrom(file){
  var reader = new FileReader();

  reader.onload = function(){
    guard("before restoring a backup file", function(){
      try{
        store.restore(String(reader.result));
      }catch(err){
        ui.toast("That file isn't an Iron Ledger backup.");
        return;
      }
      openSession = null;
      stopRest();
      showLog();
      ui.toast("Backup restored.");
    });
  };

  reader.onerror = function(){ ui.toast("Couldn't read that file."); };
  reader.readAsText(file);
}

/* --------------------------------------------------------------------------
   Top bar and rotation rail
   -------------------------------------------------------------------------- */

$("tabTrain").addEventListener("click", showTrain);
$("tabLog").addEventListener("click", showLog);
$("tabProgress").addEventListener("click", showProgress);

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
    var id = hit.dataset.open;
    openSession = (openSession === id) ? null : id;
    ui.renderLog(openSession);
    return;
  }

  hit = t.closest("[data-del]");
  if(hit){
    store.removeEntry(hit.dataset.del);
    openSession = null;
    ui.renderLog(openSession);
    ui.toast("Deleted.");
    return;
  }

  if(t.closest("#addSkip")){
    ui.skipSheet();
    return;
  }

  if(t.closest("#addPast")){
    ui.importSheet();
    return;
  }

  if(t.closest("#expCSV")){   exportCSV();     return; }
  if(t.closest("#expJSON")){  exportBackup();  return; }
  if(t.closest("#expShare")){ exportShare();   return; }
  if(t.closest("#expCopy")){  copyCSV();       return; }

  if(t.closest("#impPick")){
    $("impFile").click();
    return;
  }

  /* --- progress view --- */

  hit = t.closest("[data-rel]");
  if(hit){
    ui.progress.relative = hit.dataset.rel === "1";
    ui.renderProgress();
    return;
  }

  if(t.closest("#logWeight")){
    ui.weightSheet();
    return;
  }

  if(t.closest("#logFood")){
    ui.foodSheet();
    return;
  }

  /* Unfolded in place rather than re-rendered, so the page doesn't jump. */
  hit = t.closest("#foodMore");
  if(hit){
    var more = document.querySelectorAll(".food-row[data-more]");
    for(var m = 0; m < more.length; m++) more[m].hidden = false;
    hit.remove();
    return;
  }

  /* A row in the recent-days list — straight into editing that day. */
  hit = t.closest("[data-food]");
  if(hit){
    ui.foodSheet(hit.dataset.food);
    return;
  }

  if(t.closest("#editGoal")){
    ui.goalSheet();
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

  hit = t.closest("[data-prog]");
  if(hit){
    store.state.prefs.autoProgress = hit.dataset.prog === "1";
    store.save();
    ui.renderLog(openSession);
    return;
  }

  hit = t.closest("[data-var]");
  if(hit){
    store.state.prefs.variety = hit.dataset["var"];
    store.save();
    ui.renderLog(openSession);
    return;
  }

  if(t.closest("#reseedAll")){
    var seeded = IL.plan.reseed();
    ui.toast(seeded
      ? seeded + " working weights set from your log."
      : "Nothing in the log to read yet — import or finish a session first.");
    return;
  }

  if(t.closest("#resetAll")){
    if(confirm("Reset everything? Your plan, history and settings will be erased.\n\n" +
               "A snapshot is taken first, so this can be undone from Snapshots " +
               "further down this tab.")){
      guard("before reset", function(){
        store.reset();
        openSession = null;
        stopRest();
        showTrain();
        ui.toast("Back to the starting plan — undo it from Snapshots.");
      });
    }
    return;
  }

  /* --- sync ------------------------------------------------------------- */

  if(t.closest("#sySend")){ sendSyncCode(); return; }
  if(t.closest("#syResend")){ sendSyncCode(ui.syncForm.email); return; }
  if(t.closest("#syVerify")){ verifySyncCode(); return; }

  if(t.closest("#syBack")){
    ui.resetSyncForm();
    ui.paintSync();
    return;
  }

  if(t.closest("#syNow")){
    IL.sync.syncNow("button").then(function(result){
      if(result === "unchanged") ui.toast("Already up to date.");
      if(view === "log") ui.paintSync();
    });
    return;
  }

  if(t.closest("#syOut")){
    if(confirm("Sign out of sync? Everything stays on this device — it just stops " +
               "syncing until you sign back in.")){
      IL.sync.signOut();
      ui.resetSyncForm();
      ui.paintSync();
      ui.toast("Signed out. Your data is all still here.");
    }
    return;
  }

  if(t.closest("#syChoose")){
    var choice = IL.sync.pendingChoice();
    if(choice) ui.syncChoiceSheet(choice);
    return;
  }

  /* --- snapshots -------------------------------------------------------- */

  if(t.closest("#snapNow")){
    IL.vault.snapshot(store.toBackup(), "saved by hand").then(function(id){
      ui.toast(id ? "Snapshot saved." : "Nothing changed since the last one.");
      ui.paintDataPanel();
    });
    return;
  }

  hit = t.closest("[data-snaprestore]");
  if(hit){
    var snapId = parseInt(hit.dataset.snaprestore, 10);
    if(!confirm("Roll back to this snapshot? Everything in the app now is " +
                "replaced by what it held.\n\nThe current state is snapshotted " +
                "first, so this is reversible too.")){
      return;
    }

    guard("before rolling back", function(){
      IL.vault.read(snapId).then(function(json){
        if(!json){
          ui.toast("That snapshot couldn't be read.");
          return;
        }
        try{
          store.restore(json);
        }catch(err){
          ui.toast("That snapshot is unreadable.");
          return;
        }
        openSession = null;
        stopRest();
        showLog();
        ui.toast("Rolled back.");
      });
    });
    return;
  }

  hit = t.closest("[data-snapdel]");
  if(hit){
    IL.vault.remove(parseInt(hit.dataset.snapdel, 10)).then(function(){
      ui.paintDataPanel();
    });
    return;
  }
});

/* The phone keyboard's Go / Enter submits the step you're on. */
$("view").addEventListener("keydown", function(ev){
  if(ev.key !== "Enter") return;
  if(ev.target.id === "syEmail"){ ev.preventDefault(); sendSyncCode(); }
  else if(ev.target.id === "syCode"){ ev.preventDefault(); verifySyncCode(); }
});

$("view").addEventListener("input", function(ev){
  if(ev.target.id === "dayNotes"){
    store.currentDay().notes = ev.target.value;
    store.save();
  }
});

/* Selects, date fields and the file picker all report on "change" — they
   have no useful half-typed state the way a text box does. */
$("view").addEventListener("change", function(ev){
  var t = ev.target;

  if(t.dataset.date){
    if(!t.value){                    /* cleared the field — put it back */
      ui.renderLog(openSession);
      return;
    }
    store.setEntryDate(t.dataset.date, t.value);
    ui.renderLog(openSession);
    ui.toast("Moved to " + ui.formatDay(store.fromDayKey(t.value)) + ".");
    return;
  }

  if(t.id === "exPick"){
    ui.progress.ex = t.value;
    ui.renderProgress();
    return;
  }

  if(t.id === "impFile" && t.files && t.files[0]){
    var file = t.files[0];
    t.value = "";                    /* so picking the same file again fires */
    if(confirm("Restore this backup? Everything in the app now — plan, log and " +
               "settings — is replaced by what's in the file.")){
      restoreFrom(file);
    }
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

/* The rep chips mirror the first segment's reps, so they have to follow a
   stepper tap that no longer rebuilds the sheet. */
function syncRepChips(e, k){
  var segs = e.log[k];
  var chips = $("sheetBody").querySelectorAll("[data-repquick]");

  for(var i = 0; i < chips.length; i++){
    chips[i].setAttribute("aria-pressed",
      !!segs && parseInt(chips[i].dataset.repquick, 10) === segs[0].r);
  }
}

function setSheetClick(t){
  var e = store.currentDay().ex[editingSet.row];
  var k = editingSet.k;
  var hit;

  /* Stepper: data-seg is "w|r, segment index, delta".

     The field and the running total are updated in place rather than by
     rebuilding the sheet. Rebuilding on every tap is what made a quick
     +5 +5 +5 feel like it was fighting you, and it threw away the caret. */
  hit = t.closest("[data-seg]");
  if(hit){
    var parts = hit.dataset.seg.split(",");
    var index = parseInt(parts[1], 10);
    var delta = parseFloat(parts[2]);
    var seg = e.log[k][index];
    var value;

    if(parts[0] === "w") value = store.setSegmentWeight(e, k, index, (seg.w || 0) + delta);
    else value = store.setSegmentReps(e, k, index, (seg.r || 0) + delta);

    var field = $("sheetBody").querySelector('[data-segval="' + parts[0] + ',' + index + '"]');
    if(field) field.value = value || "";

    syncRepChips(e, k);
    store.save();
    ui.patchExercise(editingSet.row);
    ui.refreshSetTotal(editingSet.row, k);
    return true;
  }

  hit = t.closest("[data-repquick]");
  if(hit){
    var reps = store.setSegmentReps(e, k, 0, hit.dataset.repquick);
    var box = $("sheetBody").querySelector('[data-segval="r,0"]');
    if(box) box.value = reps || "";

    syncRepChips(e, k);
    store.save();
    ui.patchExercise(editingSet.row);
    ui.refreshSetTotal(editingSet.row, k);
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

  /* --- marking a day off ------------------------------------------------ */

  if(ui.sheetMode() === "skip"){
    hit = t.closest("[data-skiptype]");
    if(hit){
      toggleGroup(hit, "skiptype");
      return;
    }

    if(t.closest("#saveSkip")){
      var when = $("skDate").value;
      if(!when){
        ui.toast("Pick a date first.");
        return;
      }
      var picked = $("sheetBody").querySelector('[data-skiptype][aria-pressed="true"]');
      var added = store.addSkip(
        when,
        picked ? picked.dataset.skiptype : "missed",
        parseInt($("skDay").value, 10),
        $("skNote").value
      );
      ui.closeSheet();
      showLog();
      ui.toast((added.skipType === "rest" ? "Rest day" : "Missed day") +
               " logged for " + ui.formatDay(added.at) + ".");
    }
    return;
  }

  /* --- weigh-in --------------------------------------------------------- */

  if(ui.sheetMode() === "weight"){
    hit = t.closest("[data-bwdel]");
    if(hit){
      store.removeBodyweight(parseInt(hit.dataset.bwdel, 10));
      if(view === "progress") ui.renderProgress();
      ui.weightSheet();
      return;
    }

    if(t.closest("#saveWeight")){
      var pounds = parseFloat($("bwVal").value);
      if(!pounds || pounds <= 0){
        ui.toast("Enter a weight first.");
        return;
      }
      store.addBodyweight(pounds, $("bwDate").value);
      ui.closeSheet();
      if(view === "progress") ui.renderProgress();
      ui.toast("Weigh-in saved.");
    }
    return;
  }

  /* --- which data to keep, on first sync -------------------------------- */

  if(ui.sheetMode() === "syncchoice"){
    hit = t.closest("[data-keep]");
    if(hit){
      var keep = hit.dataset.keep;
      ui.closeSheet();
      IL.sync.resolveChoice(keep).then(function(){
        if(view === "log") ui.paintSync();
        ui.toast(keep === "remote"
          ? "Using your account's data. This device's is kept in Snapshots."
          : "Using this device's data. The account's old copy is kept in Snapshots.");
      });
    }
    return;
  }

  /* --- food ------------------------------------------------------------- */

  if(ui.sheetMode() === "food"){
    var foodDay = $("fdDate").value;

    if(t.closest("#saveFood")){
      if(!foodDay){
        ui.toast("Pick a date first.");
        return;
      }
      var had = !!store.nutritionOn(foodDay);
      var kept = store.setNutrition(foodDay, readFood());
      ui.closeSheet();
      if(view === "progress") ui.renderProgress();

      /* Saving an empty form is how a day gets cleared, so say which of the
         two just happened rather than claiming a save of nothing. */
      if(kept) ui.toast("Saved for " + ui.formatDay(store.fromDayKey(foodDay)) + ".");
      else ui.toast(had ? "Cleared " + ui.formatDay(store.fromDayKey(foodDay)) + "."
                        : "Nothing entered, so nothing saved.");
      return;
    }

    if(t.closest("#clearFood")){
      store.clearNutrition(foodDay);
      ui.closeSheet();
      if(view === "progress") ui.renderProgress();
      ui.toast("Cleared " + ui.formatDay(store.fromDayKey(foodDay)) + ".");
    }
    return;
  }

  /* --- the calorie target ----------------------------------------------- */

  if(ui.sheetMode() === "goal"){
    hit = t.closest("[data-gphase]");
    if(hit){
      toggleGroup(hit, "gphase");
      return;
    }

    /* A suggestion fills the number and picks the phase — nothing is saved
       until you press Save, so it's a starting point you can still edit. */
    hit = t.closest("[data-suggest]");
    if(hit){
      $("gKcal").value = hit.dataset.suggest;
      var phaseBtn = $("sheetBody").querySelector('[data-gphase="' + hit.dataset.sphase + '"]');
      if(phaseBtn) toggleGroup(phaseBtn, "gphase");
      toggleGroup(hit, "suggest");
      return;
    }

    hit = t.closest("[data-goaldel]");
    if(hit){
      if(confirm("Remove this target? The days it covered go back to being " +
                 "judged against the one before it, or against none.")){
        store.removeGoal(hit.dataset.goaldel);
        if(view === "progress") ui.renderProgress();
        ui.goalSheet();
      }
      return;
    }

    if(t.closest("#saveGoal")){
      var goal = store.setGoal({
        kcal: $("gKcal").value,
        phase: pickedValue("gphase"),
        from: $("gFrom").value || store.dayKey(Date.now())
      });
      if(!goal){
        ui.toast("Enter a calorie target first.");
        return;
      }
      ui.closeSheet();
      if(view === "progress") ui.renderProgress();

      var starts = goal.from === store.dayKey(Date.now())
        ? "from today"
        : "from " + ui.formatDay(store.fromDayKey(goal.from));
      ui.toast("Target set: " + goal.kcal.toLocaleString() + " kcal " + starts + ".");
    }
    return;
  }

  /* --- adding training you already did ---------------------------------- */

  if(ui.sheetMode() === "import"){
    if(t.closest("#impRun")){
      var parsed = ui.lastImport;
      if(!parsed || !parsed.sessions.length){
        ui.toast("Nothing to add yet.");
        return;
      }

      guard("before importing " + parsed.sessions.length + " sessions", function(){
        var added = IL.plan.commitImport(parsed);
        /* The whole reason for importing: the plan now opens at the loads
           your own history says you have earned. */
        var reseeded = IL.plan.reseed();

        ui.closeSheet();
        showLog();
        ui.toast(added.sessions + " session" + (added.sessions === 1 ? "" : "s") +
                 " added" +
                 (reseeded ? " · " + reseeded + " working weights updated" : "") + ".");
      });
    }
    return;
  }

  /* --- building an exercise the library doesn't have --------------------- */

  if(ui.sheetMode() === "builder"){
    hit = t.closest("[data-nxtype]");
    if(hit){ toggleGroup(hit, "nxtype"); return; }

    hit = t.closest("[data-nxbw]");
    if(hit){ toggleGroup(hit, "nxbw"); return; }

    hit = t.closest("[data-nxdel]");
    if(hit){
      var goner = hit.dataset.nxdel;
      if(confirm("Remove " + goner + " from your library? Sessions already " +
                 "logged against it are untouched.")){
        store.removeCustomExercise(goner);
        builderName = null;
        ui.librarySheet(builderFrom || "add");
        ui.toast(goner + " removed from the library.");
      }
      return;
    }

    if(t.closest("#nxSave")) saveBuilder();
    return;
  }

  /* --- the library picker ----------------------------------------------- */

  hit = t.closest("[data-libedit]");
  if(hit){
    builderFrom = ui.sheetMode();
    builderName = hit.dataset.libedit;
    ui.builderSheet(null, store.libLookup(builderName));
    return;
  }

  hit = t.closest("[data-newname]");
  if(hit){
    builderFrom = ui.sheetMode();
    builderName = null;
    ui.builderSheet(hit.dataset.newname);
    return;
  }

  if(t.closest("#libNew")){
    builderFrom = ui.sheetMode();
    builderName = null;
    ui.builderSheet("");
    return;
  }

  /* Picked something out of the library — either a swap or an addition. */
  hit = t.closest("[data-pick]");
  if(hit){
    applyPick(hit.dataset.pick, ui.sheetMode());
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

  hit = t.closest("[data-pin]");
  if(hit){
    e.pin = hit.dataset.pin === "1";
    store.save();
    ui.exerciseSheet(editing);
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

/* What the food sheet currently holds, as typed. */
function readFood(){
  return { kcal:$("fdKcal").value, protein:$("fdProt").value, fiber:$("fdFib").value };
}

$("sheetBody").addEventListener("change", function(ev){
  /* Moving the food sheet to another date. If that day already has an entry
     you're now editing it, so its numbers load; if it doesn't, whatever you'd
     typed comes with you — "oh, that was yesterday" shouldn't cost a retype. */
  if(ui.sheetMode() === "food" && ev.target.id === "fdDate"){
    var key = ev.target.value;
    if(!key) return;
    ui.foodSheet(key, store.nutritionOn(key) ? null : readFood());
    return;
  }

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

/* Save what the builder is holding. Creating ends by putting the exercise
   straight into the day — the button says "save and use it" and means it.
   Editing ends back at the library, because you were managing a list. */
function saveBuilder(){
  var typed = $("nxName").value.trim();
  if(!typed){
    ui.toast("Give it a name first.");
    return;
  }

  var saved = store.addCustomExercise({
    name: typed,
    group: $("nxGroup").value,
    type: pickedValue("nxtype"),
    sets: $("nxSets").value,
    reps: $("nxReps").value,
    pattern: $("nxPattern").value,
    bw: pickedValue("nxbw") === "1"
  });

  /* Renaming leaves the entry it came from behind. */
  if(builderName && builderName !== saved.name) store.removeCustomExercise(builderName);

  if(builderName){
    builderName = null;
    ui.librarySheet(builderFrom || "add");
    ui.toast(saved.name + " saved to your library.");
    return;
  }

  applyPick(saved.name, builderFrom);
}

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

  var out = store.finishSession();
  editingSet = null;
  editing = -1;
  stopRest();
  render();

  /* The one moment there is definitely something new worth keeping. */
  IL.vault.snapshot(store.toBackup(), "after " + out.day.name);
  window.scrollTo({ top:0, behavior:"smooth" });

  /* Say what the finish decided, not just that it happened — the plan for
     next time changed, and finding that out by surprise is worse. */
  var ups = 0, swaps = 0;
  out.changes.forEach(function(c){
    if(c.kind === "up") ups++;
    else if(c.kind === "swap") swaps++;
  });

  ui.toast(out.day.name + " logged" +
    (ups ? " · " + ups + " load" + (ups === 1 ? "" : "s") + " up" : "") +
    (swaps ? " · " + swaps + " new next time" : "") +
    " · " + store.currentDay().name + " is up next.");
});

/* --------------------------------------------------------------------------
   Mobile

   Tapping + twice quickly means ten pounds, not "zoom in". The real fix is
   touch-action:manipulation in the stylesheet, which turns double-tap zoom
   off for the whole document; this is the belt to that pair of braces, for
   engines that still synthesise a dblclick before honouring it.

   Pinch-zoom is deliberately left alone. It is the only way back for anyone
   who needs the text bigger, and nobody pinches by accident.
   -------------------------------------------------------------------------- */
document.addEventListener("dblclick", function(ev){
  ev.preventDefault();
}, { passive:false });

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

/* The charts are drawn to the pixel width they were measured at, so a
   rotation or a resized window has to redraw them. Debounced, because a
   desktop drag fires this continuously. */
var repaintTimer;
window.addEventListener("resize", function(){
  if(view !== "progress") return;
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(ui.paintCharts, 150);
});

ui.init();
store.onSaveError = function(){
  ui.toast("Couldn't save — device storage is full or blocked.");
};
paintTimer();
render();

/* Ask the browser to treat this origin's storage as persistent rather than
   as a cache it may reclaim. The browser decides — an installed app is the
   likeliest to get a yes. Either way it is one call and it costs nothing,
   and the answer is reported in the Data panel rather than in a popup. */
IL.vault.persist();

/* --------------------------------------------------------------------------
   Sync
   -------------------------------------------------------------------------- */

/* The account's copy just replaced this device's. Anything open was pointing
   at the old data, so it's closed and the view redrawn from the new. A pull
   only ever happens when this device had nothing unsaved, so nothing typed
   is lost by it. */
IL.sync.hooks.applied = function(row){
  editing = -1;
  editingSet = null;
  if(!$("sheet").hidden && ui.sheetMode() !== "syncchoice") ui.closeSheet();
  render();
  ui.toast("Updated from " + (row.device || "another device") + ".");
};

IL.sync.hooks.choose = function(choice){
  ui.syncChoiceSheet(choice);
  if(view === "log") ui.paintSync();
};

IL.sync.hooks.conflict = function(c){
  ui.toast(c.kept === "remote"
    ? "Both devices had changes — kept the newer copy from " + (c.device || "the other device") +
      ". This device's is kept in Snapshots."
    : "Both devices had changes — kept this device's newer copy. The account's is kept in Snapshots.");
};

IL.sync.hooks.signedOut = function(){
  if(view === "log") ui.paintSync();
  ui.toast("Signed out of sync — sign in again from the Log tab to keep syncing.");
};

IL.sync.onChange(function(){
  if(view === "log" && IL.sync.info().signedIn) ui.paintSync();
});

IL.sync.init();

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
