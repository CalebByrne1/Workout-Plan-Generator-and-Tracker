/* ==========================================================================
   ui.js — everything that produces markup.

   Rendering is split two ways on purpose:
     renderTrain()      rebuilds the whole day; used for structural changes
                        (add, remove, reorder, set count, switching days)
     patchExercise(i)   swaps one row and updates the counter; used for the
                        hot path of logging sets, so typing in the notes box
                        or scrolling is never interrupted.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var data = IL.data;
var store = IL.store;

function $(id){ return document.getElementById(id); }

var viewEl, sheetEl, scrimEl, toastEl;

/* -------------------------------------------------------------------------- */

function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[c];
  });
}

function unit(){ return store.state.prefs.unit; }

function formatWeight(w, name){
  if(w) return String(w);
  return (name && store.isBodyweight(name)) ? "BW" : "—";
}

function formatLoad(e){
  if(!e.weight) return store.isBodyweight(e.name) ? "BW" : "— " + unit();
  return e.weight + " " + unit();
}

function formatClock(secs){
  return Math.floor(secs / 60) + ":" + ("0" + (secs % 60)).slice(-2);
}

function formatDate(ts){
  var d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" }) + " · " +
         d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
}

/* Date without the clock — for skipped days, which have no time of day, and
   for chart axes. The year only appears once it isn't this one. */
function formatDay(ts){
  var d = new Date(ts);
  var opts = { month:"short", day:"numeric" };
  if(d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

function formatWeekday(ts){
  return new Date(ts).toLocaleDateString(undefined, {
    weekday:"short", month:"short", day:"numeric"
  });
}

/* "8, 8, 5+3" — a set with drops shows its segments joined by a plus. */
function repsSummary(logged){
  if(!logged || !logged.length) return "";
  return logged.map(function(item){
    return item.segs.map(function(s){ return s.r; }).join("+");
  }).join(", ");
}

/* "185×5 → 155×3" — the full story of one set. */
function segsDetail(segs, name){
  return segs.map(function(s){
    return formatWeight(s.w, name) + "×" + s.r;
  }).join(" → ");
}

/* -------------------------------------------------------------------------- */

var toastTimer;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 2800);
}

/* --------------------------------------------------------------------------
   What the last session decided

   Every exercise carries the note the progression rule left on it — why it
   is at this weight today. Showing it is most of the point: a number that
   moved on its own is unnerving until you can see the reason.
   -------------------------------------------------------------------------- */

/* The rules write their notes as "decision — because", so the decision can
   be bold and the reasoning can be quiet. */
function planLine(e){
  if(!e.progress || !e.progress.note) return "";

  var bits = String(e.progress.note).split(" — ");
  return '<p class="ex-plan" data-kind="' + esc(e.progress.kind) + '">' +
    '<b>' + esc(bits[0]) + '</b>' +
    (bits.length > 1 ? '<span>' + esc(bits.slice(1).join(" — ")) + '</span>' : '') +
  '</p>';
}

/* One line above the day, so the changes are visible before you scroll. */
function planBanner(day){
  var n = { up:0, down:0, swap:0, hold:0 };

  day.ex.forEach(function(e){
    if(e.progress && n[e.progress.kind] !== undefined) n[e.progress.kind]++;
  });
  if(!n.up && !n.down && !n.swap) return "";

  var parts = [];
  if(n.up)   parts.push(n.up + " load" + (n.up === 1 ? "" : "s") + " up");
  if(n.down) parts.push(n.down + " backed off");
  if(n.swap) parts.push(n.swap + " new exercise" + (n.swap === 1 ? "" : "s"));

  return '<div class="planbar">' +
    '<span class="k">Since last time</span>' +
    '<b>' + esc(parts.join(" · ")) + '</b>' +
  '</div>';
}

/* --------------------------------------------------------------------------
   Rotation rail
   -------------------------------------------------------------------------- */

function renderRail(activeView){
  var s = store.state;
  var lastLoggedId = s.history.length ? s.history[s.history.length - 1].dayId : null;

  $("rail").innerHTML = s.days.map(function(d, i){
    return '<button data-day="' + i + '"' +
             ' aria-current="' + (i === s.day && activeView === "train") + '"' +
             ' data-logged="' + (d.id === lastLoggedId ? "1" : "0") + '">' +
             '<span class="n">' + (i + 1) + '</span>' + esc(d.name) +
           '</button>';
  }).join("");

  $("cycleLabel").textContent = "Cycle " + s.cycle;
}

/* --------------------------------------------------------------------------
   Training day
   -------------------------------------------------------------------------- */

/* Unlogged: "Set 2" over the rep target.
   Logged:   the weight over the reps you actually got, with a ▾ when the set
             had drops in it. */
function setButton(e, row, k){
  var segs = e.log[k];
  var logged = store.isLogged(e, k);
  var top, big, label;

  if(logged){
    top = formatWeight(store.topWeight(segs), e.name) + (segs.length > 1 ? " ▾" : "");
    big = store.totalReps(segs);
    label = "Set " + (k + 1) + ", " + segsDetail(segs, e.name) + ". Edit.";
  }else{
    top = "Set " + (k + 1);
    big = e.reps;
    label = "Log set " + (k + 1) + " of " + e.name;
  }

  return '<button class="set" data-set="' + row + ',' + k + '"' +
           ' aria-pressed="' + (logged ? "true" : "false") + '"' +
           ' aria-label="' + esc(label) + '">' +
           '<span class="s">' + esc(top) + '</span>' +
           '<span class="r">' + esc(big) + '</span>' +
         '</button>';
}

function exerciseRow(e, i, last){
  var completed = store.doneCount(e);
  var pct = e.sets ? Math.round(completed / e.sets * 100) : 0;

  var sets = "";
  for(var k = 0; k < e.sets; k++) sets += setButton(e, i, k);

  var lastLine = (last && last.logged.length)
    ? '<span class="last">last ' + formatWeight(last.topWeight, e.name) + " " + esc(last.unit) +
      ' · ' + esc(repsSummary(last.logged)) + '</span>'
    : '';

  return '<article class="ex" data-row="' + i + '"' +
           ' data-complete="' + (e.sets > 0 && completed === e.sets ? "1" : "0") + '">' +
    '<div class="ex-stripe"><i style="--p:' + pct + '%"></i></div>' +
    '<div class="ex-body">' +
      '<div class="ex-head">' +
        '<h3>' + esc(e.name) + '</h3>' +
        '<button class="edit" data-edit="' + i + '">Edit</button>' +
      '</div>' +
      '<div class="ex-meta">' +
        '<span class="chip">' + e.sets + ' × ' + esc(e.reps) + '</span>' +
        '<span class="chip load">' + esc(formatLoad(e)) + '</span>' +
        lastLine +
      '</div>' +
      planLine(e) +
      (e.note ? '<p class="ex-note">' + esc(e.note) + '</p>' : '') +
      '<div class="sets">' + sets + '</div>' +
    '</div>' +
  '</article>';
}

function renderTrain(){
  var day = store.currentDay();
  var last = store.lastPerformed();
  var progress = store.dayProgress(day);

  var rows = day.ex.map(function(e, i){ return exerciseRow(e, i, last[e.name]); }).join("");

  viewEl.innerHTML =
    '<div class="session-head">' +
      '<div>' +
        '<h2>' + esc(day.name) + '</h2>' +
        /* The cycle badge in the top bar has no room on a narrow phone once
           there are three tabs, so the number lives here too. */
        '<p class="sub">' + esc(day.tag) + ' · Cycle ' + store.state.cycle + '</p>' +
      '</div>' +
      '<div class="prog">' +
        '<div class="big" id="progCount">' + progress.done + '/' + progress.total + '</div>' +
        '<div class="cap">Sets in</div>' +
      '</div>' +
    '</div>' +
    planBanner(day) +
    '<div class="ledger" id="ledger">' + rows + '</div>' +
    '<div class="addrow"><button class="add-btn" id="addEx">+ Add exercise</button></div>' +
    '<div class="notes">' +
      '<label class="lab" for="dayNotes">Session notes</label>' +
      '<textarea id="dayNotes" placeholder="Incline felt strong, add 5 next time. Left shoulder tight.">' +
        esc(day.notes) +
      '</textarea>' +
    '</div>';

  $("actionbar").hidden = false;
  setFinishLabel();
  renderRail("train");
}

/* Replace a single row in place — no full rebuild, no lost focus. */
function patchExercise(i){
  var day = store.currentDay();
  var el = document.querySelector('.ex[data-row="' + i + '"]');
  if(!el){ renderTrain(); return; }

  var last = store.lastPerformed()[day.ex[i].name];
  el.outerHTML = exerciseRow(day.ex[i], i, last);

  var progress = store.dayProgress(day);
  $("progCount").textContent = progress.done + "/" + progress.total;
}

function setFinishLabel(armed){
  var btn = $("finish");
  btn.dataset.armed = armed ? "1" : "0";
  btn.textContent = armed
    ? "No sets logged — finish anyway?"
    : "Finish " + store.currentDay().name;
}

/* --------------------------------------------------------------------------
   Training log
   -------------------------------------------------------------------------- */

/* The date row inside an open card. It's a real <input type="date"> so the
   phone's own picker does the work — and so a session logged the morning
   after can be moved back to the day you actually trained. */
function dateRow(h){
  return '<div class="sess-date">' +
    '<label class="lab" for="d-' + esc(h.id) + '">Date</label>' +
    '<input id="d-' + esc(h.id) + '" type="date" data-date="' + esc(h.id) + '"' +
      ' value="' + esc(store.dayKey(h.at)) + '">' +
  '</div>';
}

function sessionCard(h, isOpen){
  var u = h.unit || "lb";

  var lines = h.entries.map(function(en){
    var summary = repsSummary(en.logged);
    var head =
      '<div class="sess-line">' +
        '<div>' + esc(en.name) + '</div>' +
        '<span>' + (en.topWeight ? en.topWeight + " " + esc(u) : "BW") +
          (summary ? ' · ' + esc(summary) : ' · not done') +
        '</span>' +
      '</div>';

    /* Spell out any set that had drops in it — the summary can't show
       which weight went with which reps. */
    var drops = (en.logged || []).filter(function(item){ return item.segs.length > 1; });
    if(drops.length){
      head += '<div class="sess-drops">' + drops.map(function(item){
        return 'Set ' + item.set + ': ' + esc(segsDetail(item.segs, en.name));
      }).join("<br>") + '</div>';
    }
    return head;
  }).join("");

  return '<div class="sess">' +
    '<button class="sess-top" data-open="' + esc(h.id) + '" aria-expanded="' + isOpen + '">' +
      '<span class="sess-tag">' + esc(h.dayId) + '</span>' +
      '<span class="sess-when"><b>' + esc(h.dayName) + '</b><small>' + formatDate(h.at) + '</small></span>' +
      '<span class="sess-vol"><b>' + h.volume.toLocaleString() + '</b><small>' + esc(u) + ' volume</small></span>' +
    '</button>' +
    (isOpen ?
      '<div class="sess-detail">' + lines +
        (h.notes ? '<p class="sess-note">' + esc(h.notes) + '</p>' : '') +
        dateRow(h) +
        '<button class="sess-del" data-del="' + esc(h.id) + '">Delete this session</button>' +
      '</div>' : '') +
  '</div>';
}

/* A day you didn't train. Same card shape as a session so the log reads as
   one timeline, but struck through and without a volume to report. */
function skipCard(h, isOpen){
  var missed = h.skipType === "missed";

  return '<div class="sess is-skip" data-skip="' + (missed ? "missed" : "rest") + '">' +
    '<button class="sess-top" data-open="' + esc(h.id) + '" aria-expanded="' + isOpen + '">' +
      '<span class="sess-tag">' + esc(missed ? "—" : "R") + '</span>' +
      '<span class="sess-when"><b>' + esc(missed ? "Missed" : "Rest day") + '</b>' +
        '<small>' + formatWeekday(h.at) + ' · ' + esc(h.dayName) + '</small></span>' +
      '<span class="sess-vol"><b>' + (missed ? "✕" : "·") + '</b><small>' +
        esc(missed ? "not trained" : "planned") + '</small></span>' +
    '</button>' +
    (isOpen ?
      '<div class="sess-detail">' +
        (h.notes ? '<p class="sess-note">' + esc(h.notes) + '</p>' : '') +
        dateRow(h) +
        '<button class="sess-del" data-del="' + esc(h.id) + '">Delete this entry</button>' +
      '</div>' : '') +
  '</div>';
}

function settingsPanel(){
  var p = store.state.prefs;
  return '<div class="settings">' +
    '<div class="setrow">' +
      '<div class="k">Units<small>Applies to every load</small></div>' +
      '<div class="seg">' +
        '<button data-unit="lb" aria-pressed="' + (p.unit === "lb") + '">lb</button>' +
        '<button data-unit="kg" aria-pressed="' + (p.unit === "kg") + '">kg</button>' +
      '</div>' +
    '</div>' +
    '<div class="setrow">' +
      '<div class="k">Weight step<small>Size of the plus and minus buttons</small></div>' +
      '<div class="seg">' + [2.5, 5, 10].map(function(v){
        return '<button data-step="' + v + '" aria-pressed="' + (p.step === v) + '">' + v + '</button>';
      }).join("") + '</div>' +
    '</div>' +
    '<div class="setrow">' +
      '<div class="k">Auto rest timer<small>Starts when you log a set</small></div>' +
      '<div class="seg">' +
        '<button data-auto="1" aria-pressed="' + (p.autoRest === true) + '">On</button>' +
        '<button data-auto="0" aria-pressed="' + (p.autoRest === false) + '">Off</button>' +
      '</div>' +
    '</div>' +
    '<div class="setrow">' +
      '<div class="k">Progressive overload<small>Moves each load on what you actually hit</small></div>' +
      '<div class="seg">' +
        '<button data-prog="1" aria-pressed="' + (p.autoProgress === true) + '">On</button>' +
        '<button data-prog="0" aria-pressed="' + (p.autoProgress === false) + '">Off</button>' +
      '</div>' +
    '</div>' +
    '<div class="setrow stack">' +
      '<div class="k">Variety<small>How readily an exercise hands its slot to another one that does the same job</small></div>' +
      '<div class="seg wide">' + ["off","low","medium","high"].map(function(v){
        return '<button data-var="' + v + '" aria-pressed="' + (p.variety === v) + '">' +
                 esc(data.VARIETY[v].label) + '</button>';
      }).join("") + '</div>' +
    '</div>' +
    '<div class="setrow">' +
      '<div class="k">Re-seed from the log<small>Sets every working weight from your own history</small></div>' +
      '<button class="edit" id="reseedAll">Re-seed</button>' +
    '</div>' +
    '<div class="setrow">' +
      '<div class="k">Start over<small>Erases the plan, history and settings</small></div>' +
      '<button class="edit danger" id="resetAll">Reset</button>' +
    '</div>' +
  '</div>';
}

/* Getting the log off the phone. Everything here is generated on the device
   and handed to you — nothing is uploaded anywhere, because there is nowhere
   to upload it to. */
/* How long since a copy actually left the device. Snapshots don't count —
   they sit in the same origin as the thing they're backing up, so a wiped
   phone takes both. */
function exportAge(){
  var history = store.state.history.length;
  if(!history) return null;

  var days = store.daysSinceExport();
  if(days === null){
    return { stale:true, text:"You have never taken a copy off this device." };
  }
  if(days >= 30){
    return { stale:true, text:"Last copy off this device: " + days + " days ago." };
  }
  return {
    stale: false,
    text: days === 0 ? "Copied off this device today."
        : days === 1 ? "Copied off this device yesterday."
        : "Copied off this device " + days + " days ago."
  };
}

function dataPanel(){
  var canShare = !!(navigator.share && navigator.canShare);
  var age = exportAge();

  return '<div class="settings">' +
    '<h3 class="set-title">Your data</h3>' +
    '<p class="hint">' + store.state.history.length + ' entries and ' +
      store.state.body.length + ' weigh-ins, saved on this device.</p>' +

    (age
      ? (age.stale
          ? '<p class="nudge">' + esc(age.text) + ' Clearing your browser data ' +
              'or losing the phone would take all of it. Send yourself a backup.</p>'
          : '<p class="hint good">' + esc(age.text) + '</p>')
      : '') +

    '<div class="datarow">' +
      '<button class="add-btn" id="expCSV">Spreadsheet (CSV)</button>' +
      '<button class="add-btn" id="expJSON">Full backup</button>' +
    '</div>' +
    (canShare
      ? '<button class="add-btn" id="expShare">Send it to myself…</button>'
      : '') +
    '<div class="datarow">' +
      '<button class="add-btn" id="expCopy">Copy CSV</button>' +
      '<button class="add-btn" id="impPick">Restore a backup</button>' +
    '</div>' +
    '<input id="impFile" type="file" accept=".json,application/json" hidden>' +
    '<p class="hint">The CSV has one row per weight you lifted, so a drop set ' +
      'stays two rows. The backup restores everything exactly, on any device.</p>' +

    '<h3 class="set-title">Snapshots</h3>' +
    '<p class="hint" id="storeStat">Checking storage…</p>' +
    '<div id="snapList"></div>' +
    '<button class="add-btn" id="snapNow">+ Snapshot right now</button>' +
    '<p class="hint">Taken automatically after every session and before ' +
      'anything that overwrites your log, so a mistaken reset or a bad import ' +
      'is one tap to undo. They live on this device — they are an undo button, ' +
      'not a backup.</p>' +
  '</div>';
}

/* --------------------------------------------------------------------------
   The asynchronous half of the Data panel

   Snapshots and the storage estimate both come from promises, so they are
   filled in after the panel is on screen rather than holding up the render.
   -------------------------------------------------------------------------- */

/* Non-breaking space between number and unit, so "13 kB" never wraps into
   "13" on one line and "kB" on the next. */
function formatBytes(n){
  var MB = 1024 * 1024;
  if(!n) return "0 kB";
  if(n < MB) return Math.max(1, Math.round(n / 1024)) + " kB";
  if(n < 1024 * MB) return (n / MB).toFixed(1).replace(/\.0$/, "") + " MB";
  return Math.round(n / 1024 / MB) + " GB";
}

function formatStamp(ts){
  var d = new Date(ts);
  return formatDay(ts) + " · " +
         d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
}

function snapshotRow(row){
  return '<div class="snaprow">' +
    '<div class="snapwhen">' +
      '<b>' + esc(row.reason) + '</b>' +
      '<small>' + esc(formatStamp(row.at)) + ' · ' + row.sessions +
        ' session' + (row.sessions === 1 ? "" : "s") +
        ' · ' + esc(formatBytes(row.bytes)) + '</small>' +
    '</div>' +
    '<button class="snapgo" data-snaprestore="' + row.id + '">Restore</button>' +
    '<button class="segdel" data-snapdel="' + row.id + '">Delete</button>' +
  '</div>';
}

function paintDataPanel(){
  var listEl = $("snapList");
  var statEl = $("storeStat");
  if(!listEl || !statEl || !IL.vault) return;

  IL.vault.status().then(function(st){
    if(!$("storeStat")) return;

    var bits = [];
    if(st.persisted === true)       bits.push("Storage is marked persistent — the browser won't evict it to reclaim space.");
    else if(st.persisted === false) bits.push("The browser has this as best-effort storage, so it could be evicted under pressure. Keep exporting.");
    else                            bits.push("This browser doesn't say whether it will keep the data. Keep exporting.");

    if(st.estimate && st.estimate.usage){
      bits.push("Using " + formatBytes(st.estimate.usage) +
                (st.estimate.quota ? " of " + formatBytes(st.estimate.quota) : "") + ".");
    }
    $("storeStat").textContent = bits.join(" ");
  });

  IL.vault.list().then(function(rows){
    if(!$("snapList")) return;

    $("snapList").innerHTML = rows.length
      ? rows.map(snapshotRow).join("")
      : '<p class="hint">No snapshots yet. One is taken the next time you ' +
        'finish a session.</p>';
  });
}

function renderLog(openId){
  var history = store.state.history;
  var sessions = store.sessionsOnly().length;
  var skips = store.skipsOnly().length;
  var body;

  if(!history.length){
    body = '<p class="empty">No sessions logged yet. Finish a workout and it lands here with every rep you did.</p>';
  }else{
    var cards = [];
    for(var i = history.length - 1; i >= 0; i--){
      var h = history[i];
      cards.push(store.isSkip(h) ? skipCard(h, openId === h.id) : sessionCard(h, openId === h.id));
    }
    body = cards.join("");
  }

  viewEl.innerHTML =
    '<div class="session-head">' +
      '<div>' +
        '<h2>Training log</h2>' +
        '<p class="sub">' + sessions + ' session' + (sessions === 1 ? "" : "s") +
          (skips ? ' · ' + skips + ' day' + (skips === 1 ? "" : "s") + ' off' : '') +
        '</p>' +
      '</div>' +
    '</div>' +
    '<div class="hist">' +
      '<div class="datarow">' +
        '<button class="add-btn" id="addPast">+ Past workouts</button>' +
        '<button class="add-btn" id="addSkip">+ Missed or rest day</button>' +
      '</div>' +
      body + settingsPanel() + dataPanel() +
    '</div>';

  $("actionbar").hidden = true;
  renderRail("log");
  paintDataPanel();
}

/* --------------------------------------------------------------------------
   Progress

   Three questions, three charts: is the weight on the bar going up, is my
   own weight moving under it, and am I actually showing up. The picked
   exercise and the ×bodyweight toggle live here rather than in app.js
   because a resize has to repaint the same charts without app.js involved.
   -------------------------------------------------------------------------- */

var progress = { ex:null, relative:false };

function compact(v){
  return v >= 10000 ? Math.round(v / 1000) + "k" : Math.round(v).toLocaleString();
}

/* The series behind the strength chart, plus how to write its numbers. */
function strengthView(){
  var names = store.loggedExercises();
  if(!names.length) return null;

  if(names.indexOf(progress.ex) < 0) progress.ex = names[0];

  var series = store.exerciseSeries(progress.ex);
  var relative = progress.relative && series.metric === "load";
  var shown = relative ? store.relativeSeries(series) : series;

  return {
    names: names,
    series: shown,
    metric: series.metric,
    relative: relative,
    canRelate: series.metric === "load" && store.state.body.length > 0,
    fmtV: relative
      ? function(v){ return v.toFixed(2) + "× bodyweight"; }
      : (series.metric === "load"
          ? function(v){ return Math.round(v).toLocaleString() + " " + unit(); }
          : function(v){ return Math.round(v) + " reps"; }),
    fmtY: relative
      ? function(v){ return v.toFixed(2); }
      : function(v){ return compact(v); }
  };
}

function statTile(label, value, sub){
  return '<div class="stat">' +
    '<span class="k">' + esc(label) + '</span>' +
    '<b>' + esc(value) + '</b>' +
    (sub ? '<small>' + esc(sub) + '</small>' : '') +
  '</div>';
}

/* Ten weeks of days, Sunday-first so the columns are weeks. Trained days
   carry three steps of one hue (more volume, darker); missed and rest are
   their own states and are named in the legend, never colour alone. */
function calendarHTML(){
  var cells = store.calendar(10);
  var names = { trained:"trained", missed:"missed", rest:"rest day", none:"nothing logged" };

  var head = ["S","M","T","W","T","F","S"].map(function(d){
    return '<span class="cal-h">' + d + '</span>';
  }).join("");

  var grid = cells.map(function(c){
    var label = formatWeekday(c.at) + " — " + names[c.state] +
      (c.entry && !store.isSkip(c.entry) ? " · " + c.entry.dayName : "");
    return '<i class="cal-c" data-state="' + c.state + '" data-level="' + c.level +
             '" title="' + esc(label) + '"></i>';
  }).join("");

  return '<div class="cal">' +
      '<div class="cal-head">' + head + '</div>' +
      '<div class="cal-grid">' + grid + '</div>' +
    '</div>' +
    '<div class="cal-key">' +
      '<span><i class="cal-c" data-state="trained" data-level="2"></i>Trained</span>' +
      '<span><i class="cal-c" data-state="rest" data-level="0"></i>Rest day</span>' +
      '<span><i class="cal-c" data-state="missed" data-level="0"></i>Missed</span>' +
    '</div>';
}

/* --------------------------------------------------------------------------
   Nutrition

   Over and under are a DIRECTION, never a verdict: over is the goal on a
   bulk and the thing to avoid on a cut, so the colours stay put whatever
   the phase and the words carry the meaning. Text is always ink; the colour
   lives on a swatch or a mark beside it.
   -------------------------------------------------------------------------- */

var FOOD_WINDOW = 14;         /* days on the over/under chart */
var FOOD_AVG = 7;             /* days behind the averages */

function kcal(n){ return Math.round(n).toLocaleString(); }

/* Grams keep a decimal only when there is one. */
function grams(n){ return (Math.round(n * 10) / 10).toLocaleString() + " g"; }

/* A real minus sign, not a hyphen — it lines up with the plus. */
function signed(n){
  if(n > 0) return "+" + kcal(n);
  if(n < 0) return "−" + kcal(-n);
  return "0";
}

function diffWords(d){
  if(d === null || d === undefined) return "";
  if(d === 0) return "right on target";
  return kcal(Math.abs(d)) + (d > 0 ? " over" : " under");
}

function dirOf(d){ return d > 0 ? "over" : d < 0 ? "under" : "on"; }

function swatch(d){
  return d === null || d === 0 ? "" : '<i class="sw" data-dir="' + dirOf(d) + '"></i>';
}

function phaseBadge(phase){
  return store.PHASES[phase]
    ? '<span class="phase">' + esc(store.PHASES[phase]) + '</span>'
    : "";
}

/* Today against the target, as a meter.

   One bar, split at the target. Everything up to the target is the under
   colour on a lighter track of the same hue; anything past it runs on in
   the over colour. The scale stretches to fit a day that went over, so going
   over reads as a bar that ran long rather than as a bar that's merely full. */
function meterHTML(eaten, target){
  var scale = Math.max(target, eaten) || 1;
  var toTarget = Math.min(eaten, target) / scale * 100;
  var mark = target / scale * 100;
  var past = eaten > target ? (eaten - target) / scale * 100 : 0;

  return '<div class="meter" role="img" aria-label="' +
      esc(kcal(eaten) + " of " + kcal(target) + " kilocalories") + '">' +
    '<i class="meter-in" style="width:' + toTarget.toFixed(2) + '%"></i>' +
    (past
      ? '<i class="meter-over" style="left:' + mark.toFixed(2) + '%;width:' + past.toFixed(2) + '%"></i>' +
        '<i class="meter-mark" style="left:' + mark.toFixed(2) + '%"></i>'
      : '') +
  '</div>';
}

function macro(label, v){
  return '<div class="macro">' +
    '<span class="lab">' + esc(label) + '</span>' +
    (v === null || v === undefined ? '<i>not logged</i>' : '<b>' + esc(grams(v)) + '</b>') +
  '</div>';
}

/* The card you use every day: what today looks like, and what you're aiming at. */
function nutritionCard(){
  var today = store.dayKey(Date.now());
  var food = store.nutritionOn(today);
  var goal = store.currentGoal();
  var eaten = food ? food.kcal : null;
  var top;

  if(eaten !== null && goal){
    var d = eaten - goal.kcal;
    top =
      '<div class="food-today">' +
        '<div class="food-num"><b>' + kcal(eaten) + '</b>' +
          '<span>of ' + kcal(goal.kcal) + ' kcal today</span></div>' +
        '<span class="food-diff">' + swatch(d) + esc(diffWords(d)) + '</span>' +
      '</div>' +
      meterHTML(eaten, goal.kcal);
  }else if(eaten !== null){
    top =
      '<div class="food-today">' +
        '<div class="food-num"><b>' + kcal(eaten) + '</b><span>kcal today</span></div>' +
      '</div>';
  }else{
    top = '<p class="hint food-none">Nothing logged today' +
      (goal ? ' — ' + kcal(goal.kcal) + ' kcal to work with.' : '.') + '</p>';
  }

  var goalRow = goal
    ? '<div class="food-goal">' +
        '<div class="k">' +
          '<span class="lab">Daily target</span>' +
          '<b>' + kcal(goal.kcal) + ' kcal</b>' + phaseBadge(goal.phase) +
          '<small>since ' + esc(formatDay(store.fromDayKey(goal.from))) + '</small>' +
        '</div>' +
        '<button class="edit" id="editGoal">Change</button>' +
      '</div>'
    : '<div class="food-goal">' +
        '<div class="k">' +
          '<span class="lab">Daily target</span>' +
          '<small>Set one and every day shows how far over or under it you were.</small>' +
        '</div>' +
        '<button class="edit" id="editGoal">Set target</button>' +
      '</div>';

  return '<section class="card">' +
    '<div class="card-head">' +
      '<h3>Nutrition</h3>' +
      '<button class="edit" id="logFood">' + (food ? "Edit today" : "Log food") + '</button>' +
    '</div>' +
    top +
    (food ? '<div class="food-macros">' + macro("Protein", food.protein) + macro("Fiber", food.fiber) + '</div>' : '') +
    goalRow +
  '</section>';
}

/* An average and how many days it's made of — "172 g" means something
   different over seven days than over two. `note` is an optional line above
   the day count, for the calorie tile's over/under. */
function avgTile(label, a, fmt, note){
  return '<div class="food-avg-tile">' +
    '<span class="lab">' + esc(label) + '</span>' +
    (a.days ? '<b>' + esc(fmt(a.value)) + '</b>' : '<b class="none">—</b>') +
    (note ? '<small>' + esc(note) + '</small>' : '') +
    '<small>' + esc(a.days ? a.days + " of " + FOOD_AVG + " days" : "not logged") + '</small>' +
  '</div>';
}

/* An average is an estimate, and "165.2 g" claims a precision it hasn't got. */
function wholeGrams(n){ return Math.round(n).toLocaleString() + " g"; }

/* How many recent days the list shows before "show all". The rest are one
   tap away, and any older day is reachable from the date field in the food
   sheet — the list is for glancing, not archaeology. */
var FOOD_LIST = 7;

/* The history: the chart for the shape, the averages for the gist, and the
   list of days — the exact numbers, and the way into editing a past day. */
function calorieCard(){
  var avg = store.nutritionAverages(FOOD_AVG);
  var keys = store.nutritionKeys().slice(0, FOOD_WINDOW);

  var kcalNote = avg.diff.days ? diffWords(Math.round(avg.diff.value)) : "";

  var rows = keys.map(function(key, n){
    var food = store.nutritionOn(key);
    var goal = store.goalOn(key);
    var d = (food.kcal !== null && goal) ? food.kcal - goal.kcal : null;
    var bits = [];
    if(food.protein !== null) bits.push("P " + grams(food.protein));
    if(food.fiber !== null) bits.push("F " + grams(food.fiber));

    return '<button class="food-row" data-food="' + esc(key) + '"' +
             (n >= FOOD_LIST ? ' data-more hidden' : '') + '>' +
      '<span class="d">' + esc(formatWeekday(store.fromDayKey(key))) + '</span>' +
      '<b>' + (food.kcal !== null ? kcal(food.kcal) : "—") + '</b>' +
      '<span class="diff">' + (d !== null ? swatch(d) + esc(signed(d)) : "") + '</span>' +
      '<small>' + esc(bits.join(" · ")) + '</small>' +
    '</button>';
  }).join("");

  return '<section class="card">' +
    '<h3>Calories vs target</h3>' +
    '<div class="chart-key">' +
      '<span><i class="sw" data-dir="over"></i>Over target</span>' +
      '<span><i class="sw" data-dir="under"></i>Under target</span>' +
    '</div>' +
    '<div class="chart-host" id="chFood"></div>' +
    '<span class="lab food-avg-head">Last ' + FOOD_AVG + ' days, averaged</span>' +
    '<div class="food-avg">' +
      avgTile("Calories", avg.kcal, function(v){ return kcal(v); }, kcalNote) +
      avgTile("Protein", avg.protein, wholeGrams) +
      avgTile("Fiber", avg.fiber, wholeGrams) +
    '</div>' +
    (rows
      ? '<div class="food-list"><span class="lab">Recent days — tap one to edit it</span>' + rows +
          (keys.length > FOOD_LIST
            ? '<button class="add-btn" id="foodMore">Show all ' + keys.length + ' days</button>'
            : '') +
        '</div>'
      : '') +
  '</section>';
}

/* --------------------------------------------------------------------------
   Weight: the 7-day average leads, the single reading is the footnote
   -------------------------------------------------------------------------- */

function weightFmt(n){ return (Math.round(n * 10) / 10).toFixed(1); }

function signedWeight(n){
  if(n > 0) return "+" + weightFmt(n);
  if(n < 0) return "−" + weightFmt(-n);
  return "0.0";
}

/* The tile. Three honest states: an average this week; no weigh-in this
   week, so the last reading with its date; nothing at all. */
function weightTile(){
  var t = store.weightTrend();

  if(t.now){
    var sub = t.change === null
      ? t.now.count + (t.now.count === 1 ? " weigh-in" : " weigh-ins") + " this week"
      : t.change === 0
        ? "level with last week"
        : signedWeight(t.change) + " vs last week";
    return statTile("Weight · 7-day avg", weightFmt(t.now.value) + " " + unit(), sub);
  }
  if(t.latest){
    return statTile("Bodyweight", weightFmt(t.latest.w) + " " + unit(),
                    "none this week · last " + formatDay(t.latest.at));
  }
  return statTile("Bodyweight", "—", "add a weigh-in");
}

/* --------------------------------------------------------------------------
   Maintenance

   The estimate, what it's made of, and what it means for the target you've
   set. Before there's enough to go on it says exactly what's missing rather
   than showing a number it can't stand behind.
   -------------------------------------------------------------------------- */

function rateWords(perWeek){
  if(Math.abs(perWeek) < 0.05) return "holding steady";
  return (perWeek < 0 ? "losing " : "gaining ") + Math.abs(perWeek).toFixed(1) +
         " " + unit() + " a week";
}

function maintenanceCard(){
  var t = store.tdee();
  var est = t.now;
  var head = '<div class="card-head"><h3>Maintenance</h3><span class="tag">estimated</span></div>';

  if(!est.ready){
    var need = [];
    if(est.need.kcalDays) need.push(est.need.kcalDays + " more day" + (est.need.kcalDays === 1 ? "" : "s") + " with calories logged");
    if(est.need.weighIns) need.push(est.need.weighIns + " more weigh-in" + (est.need.weighIns === 1 ? "" : "s"));
    if(est.need.span)     need.push("weigh-ins spread over " + est.need.span + " more day" + (est.need.span === 1 ? "" : "s"));

    return '<section class="card">' + head +
      '<div class="tdee"><div class="tdee-num"><b class="none">—</b><span>not enough to go on yet</span></div></div>' +
      '<p class="tdee-why">Worked out from your own intake and weight trend over three weeks. Still to go:</p>' +
      '<ul class="tdee-need">' + need.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join("") + '</ul>' +
      '<p class="hint">It looks at the ' + est.window + ' days through yesterday and needs at least ' +
        store.TDEE_NEEDS.kcalDays + ' of them with calories and ' + store.TDEE_NEEDS.weighIns +
        ' weigh-ins across ' + store.TDEE_NEEDS.span + '+ days. Until then an online calculator is the better guess.</p>' +
    '</section>';
  }

  var goal = store.currentGoal();
  var goalLine = "";
  if(goal){
    var gap = goal.kcal - est.tdee;
    var weekly = gap * 7 / store.energyPerUnit();
    goalLine = '<p class="tdee-goal">Your ' + kcal(goal.kcal) + ' target is ' +
      (gap === 0 ? 'right at maintenance' :
        '<b>' + kcal(Math.abs(gap)) + (gap < 0 ? ' below' : ' above') + '</b> it — roughly ' +
        rateWords(weekly) + ' if you hit it') + '.</p>';
  }

  return '<section class="card">' + head +
    '<div class="tdee">' +
      '<div class="tdee-num"><b>' + kcal(est.tdee) + '</b><span>kcal a day</span></div>' +
      '<span class="tdee-band">± ' + kcal(est.band) + '</span>' +
    '</div>' +
    '<p class="tdee-why">Averaging <b>' + kcal(est.intake) + ' kcal</b> while ' +
      '<b>' + esc(rateWords(est.perWeek)) + '</b>.' +
      (t.change !== null && Math.abs(t.change) >= 10
        ? ' ' + (t.change > 0 ? 'Up ' : 'Down ') + kcal(Math.abs(t.change)) + ' from a week ago.'
        : '') +
    '</p>' +
    goalLine +
    '<p class="hint">From ' + est.kcalDays + ' of the last ' + est.window + ' days of food and ' +
      est.weighIns + ' weigh-ins, through ' + esc(formatDay(store.fromDayKey(est.to))) + '. ' +
      'The ± is how far the scale wanders from its trend; it narrows the more you weigh in. ' +
      'A consistent miscount of your food cancels out — the answer comes back in your own counting.</p>' +
  '</section>';
}

function renderProgress(){
  var s = store.summary();
  var view = strengthView();

  var sub = s.since
    ? "Week " + s.weeks + " · training since " + formatDay(s.since)
    : "Nothing logged yet";

  var picker = view
    ? '<select id="exPick" aria-label="Which exercise to chart">' +
        view.names.map(function(n){
          return '<option value="' + esc(n) + '"' +
                 (n === progress.ex ? " selected" : "") + '>' + esc(n) + '</option>';
        }).join("") +
      '</select>'
    : "";

  var toggle = (view && view.canRelate)
    ? '<div class="seg">' +
        '<button data-rel="0" aria-pressed="' + (!view.relative) + '">Load</button>' +
        '<button data-rel="1" aria-pressed="' + (view.relative) + '">× body</button>' +
      '</div>'
    : "";

  var strengthNote = !view ? "" :
    (view.relative
      ? "Estimated one-rep max divided by what you weighed that week. It rises only when you get stronger faster than you get heavier."
      : view.metric === "load"
        ? "Estimated one-rep max (Epley) from your best set that day" +
          (store.isBodyweight(progress.ex) ? ", with your bodyweight added in" : "") + "."
        : "This one has never been logged with a load, so it charts your best set's reps instead.");

  viewEl.innerHTML =
    '<div class="session-head">' +
      '<div>' +
        '<h2>Progress</h2>' +
        '<p class="sub">' + esc(sub) + '</p>' +
      '</div>' +
    '</div>' +

    '<div class="prog-wrap">' +
      '<div class="stats">' +
        statTile("Sessions", String(s.sessions), s.weeks ? s.weeks + " weeks in" : "") +
        statTile("Last 30 days", String(s.last30), s.missed30 ? s.missed30 + " missed" : "none missed") +
        statTile("Total volume", compact(s.volume) + " " + unit(), "everything lifted") +
        weightTile() +
      '</div>' +

      /* Near the top on purpose: it's the one card on this tab you'll touch
         every day, not just read. Maintenance sits between today and the
         history because it's what the target should be set from. */
      nutritionCard() +
      maintenanceCard() +
      calorieCard() +

      '<section class="card">' +
        '<div class="card-head">' +
          '<h3>Strength trend</h3>' + toggle +
        '</div>' +
        picker +
        '<div class="chart-host hero" id="chStrength"></div>' +
        (strengthNote ? '<p class="hint">' + esc(strengthNote) + '</p>' : '') +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head">' +
          '<h3>Bodyweight</h3>' +
          '<button class="edit" id="logWeight">Log weight</button>' +
        '</div>' +
        '<div class="chart-key">' +
          '<span><i class="sw line"></i>7-day average</span>' +
          '<span><i class="sw raw"></i>Daily weigh-in</span>' +
        '</div>' +
        '<div class="chart-host" id="chBody"></div>' +
        (store.state.body.length > 1
          ? '<p class="hint">Water moves a single reading by a pound or three — ' +
              'the line is what’s actually changing.</p>'
          : '') +
      '</section>' +

      '<section class="card">' +
        '<h3>Volume per session</h3>' +
        '<div class="chart-host" id="chVolume"></div>' +
        '<p class="hint">Every rep of every set multiplied by the weight on it. ' +
          'It climbs as you add load, reps or sets.</p>' +
      '</section>' +

      '<section class="card">' +
        '<h3>Consistency</h3>' +
        calendarHTML() +
      '</section>' +
    '</div>';

  $("actionbar").hidden = true;
  renderRail("progress");
  paintCharts();
}

/* Charts are measured from their host, so they can only be drawn once the
   markup is in the document — and have to be redrawn when it resizes. */
function paintCharts(){
  if(!$("chStrength")) return;

  var view = strengthView();

  IL.chart.draw($("chStrength"), {
    kind: "line",
    points: view ? view.series.points : [],
    fmtY: view ? view.fmtY : compact,
    fmtV: view ? view.fmtV : compact,
    fmtX: formatDay,
    label: view ? view.series.name + " over time" : "strength trend",
    empty: "Log the same exercise on two different days and its trend line appears here."
  });

  /* The line is the 7-day average as of each weigh-in; the readings sit
     underneath as faint dots, so the noise is visible but can't steal the eye. */
  var body = store.bodyTrendSeries();
  IL.chart.draw($("chBody"), {
    kind: "line",
    points: body,
    raw: body.map(function(p){ return { x:p.x, y:p.raw }; }),
    fmtY: function(v){ return Math.round(v); },
    fmtV: function(v, p){
      return weightFmt(v) + " " + unit() + " avg · weighed " + weightFmt(p.raw);
    },
    fmtX: formatDay,
    label: "bodyweight, seven-day average over time",
    empty: "Two weigh-ins draw a line. Log the first one with the button above."
  });

  IL.chart.draw($("chVolume"), {
    kind: "column",
    points: store.volumeSeries().slice(-18),
    fmtY: compact,
    fmtV: function(v){ return Math.round(v).toLocaleString() + " " + unit(); },
    fmtX: formatDay,
    label: "volume per session",
    empty: "Finish a session and its volume lands here."
  });

  /* Every one of the last fortnight's days gets a slot, logged or not, so a
     gap in the chart is a gap in the diary. Each bar is measured against the
     target in force that day, which is why a phase change moves the zero
     line's meaning but never redraws the past. */
  IL.chart.draw($("chFood"), {
    kind: "diverging",
    points: store.nutritionSeries(FOOD_WINDOW).map(function(r){
      return { x:r.at, y:r.diff, row:r };
    }),
    fmtY: signed,
    fmtV: function(v, p){
      var r = p.row;
      if(r.kcal === null) return "Not logged";
      if(r.target === null) return kcal(r.kcal) + " kcal · no target";
      return diffWords(v) + " · " + kcal(r.kcal) + " of " + kcal(r.target);
    },
    fmtX: formatDay,
    label: "calories over or under target, last " + FOOD_WINDOW + " days",
    empty: store.currentGoal() || store.state.nutrition.goals.length
      ? "Log a day's calories and it shows up here against your target."
      : "Set a daily target and every day you log shows up here as over or under it."
  });
}

/* --------------------------------------------------------------------------
   Bottom sheet
   -------------------------------------------------------------------------- */

function openSheet(title, html, mode){
  $("sheetTitle").textContent = title;
  $("sheetBody").innerHTML = html;
  sheetEl.dataset.mode = mode;
  sheetEl.hidden = false;
  scrimEl.hidden = false;
  requestAnimationFrame(function(){
    sheetEl.classList.add("open");
    scrimEl.classList.add("open");
  });
}

function closeSheet(){
  sheetEl.classList.remove("open");
  scrimEl.classList.remove("open");
  setTimeout(function(){
    sheetEl.hidden = true;
    scrimEl.hidden = true;
  }, 220);
}

function sheetMode(){ return sheetEl.dataset.mode; }

/* --------------------------------------------------------------------------
   Set logger — one set, one or more weights
   -------------------------------------------------------------------------- */

/* An empty box, not a zero. A pre-filled 0 has to be selected and deleted
   before you can type, which is three actions for what should be one — so
   zero shows as the placeholder and the field starts blank. */
function stepper(kind, index, value, step, min){
  return '<div class="stepper mini">' +
    '<button data-seg="' + kind + ',' + index + ',' + (-step) + '" aria-label="Less">−</button>' +
    '<input type="number" inputmode="' + (kind === "w" ? "decimal" : "numeric") + '"' +
      ' step="any" min="' + min + '" data-segval="' + kind + ',' + index + '"' +
      ' placeholder="0" value="' + (value || "") + '">' +
    '<button data-seg="' + kind + ',' + index + ',' + step + '" aria-label="More">+</button>' +
  '</div>';
}

function segmentBlock(seg, index, isDrop, repChips){
  return '<div class="segblock' + (isDrop ? " is-drop" : "") + '">' +
    '<div class="segblock-head">' +
      '<span class="seglabel">' + (isDrop ? "Drop " + index : "Top set") + '</span>' +
      (isDrop ? '<button class="segdel" data-segdel="' + index + '">Remove</button>' : '') +
    '</div>' +
    '<div class="seggrid">' +
      '<div class="field">' +
        '<span class="lab">Weight (' + esc(unit()) + ')</span>' +
        stepper("w", index, seg.w, store.state.prefs.step, 0) +
      '</div>' +
      '<div class="field">' +
        '<span class="lab">Reps</span>' +
        stepper("r", index, seg.r, 1, 0) +
      '</div>' +
    '</div>' +
    (repChips || "") +
  '</div>';
}

function setTotalHTML(segs){
  return '<span>' + segs.length + (segs.length === 1 ? " weight" : " weights") + '</span>' +
    '<b>' + store.totalReps(segs) + ' reps · ' +
      Math.round(store.segmentVolume(segs)).toLocaleString() + ' ' + esc(unit()) + '</b>';
}

/* Update just the running total, so typing in a field isn't interrupted. */
function refreshSetTotal(row, k){
  var el = $("setTotal");
  if(!el) return;
  var segs = store.currentDay().ex[row].log[k];
  if(segs) el.innerHTML = setTotalHTML(segs);
}

function setSheet(row, k){
  var e = store.currentDay().ex[row];
  var segs = e.log[k] || store.quickLog(e, k);

  var chips = store.repChoices(e.reps);
  var chipHTML = chips.length
    ? '<div class="quick reps">' + chips.map(function(n){
        return '<button data-repquick="' + n + '"' +
               (segs[0].r === n ? ' aria-pressed="true"' : '') + '>' + n + '</button>';
      }).join("") + '</div>'
    : "";

  var blocks = segs.map(function(seg, i){
    return segmentBlock(seg, i, i > 0, i === 0 ? chipHTML : "");
  }).join("");

  openSheet("Set " + (k + 1),
    '<p class="sheet-sub">' + esc(e.name) + ' · target ' + esc(e.reps) + '</p>' +
    blocks +
    '<button class="add-btn" id="addDrop">+ Add a drop</button>' +
    '<div class="settotal" id="setTotal">' + setTotalHTML(segs) + '</div>' +
    '<div class="rowbtns one">' +
      '<button class="danger" id="clearSet">Clear this set</button>' +
    '</div>',
  "set");
}

/* --------------------------------------------------------------------------
   Exercise editor
   -------------------------------------------------------------------------- */

function exerciseSheet(i){
  var e = store.currentDay().ex[i];
  var step = store.state.prefs.step;

  var nextUp = IL.plan.preview(e);

  openSheet("Edit exercise",
    '<button class="swapname" id="swapBtn">' +
      '<strong>' + esc(e.name) + '</strong><span>Swap ›</span>' +
    '</button>' +

    (e.progress && e.progress.note ? planLine(e) : '') +

    '<div class="setrow stack">' +
      '<div class="k">This slot<small>' +
        (e.pin
          ? "Held — it will not rotate"
          : nextUp
            ? "Next in line: " + esc(nextUp)
            : "Nothing else in the library does this job, so it stays put") +
      '</small></div>' +
      '<div class="seg wide">' +
        '<button data-pin="0" aria-pressed="' + (e.pin !== true) + '">Rotate</button>' +
        '<button data-pin="1" aria-pressed="' + (e.pin === true) + '">Keep</button>' +
      '</div>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="fW">Working weight (' + esc(unit()) + ')</label>' +
      '<div class="stepper">' +
        '<button data-w="' + (-step) + '" aria-label="Decrease weight">−</button>' +
        '<input id="fW" type="number" inputmode="decimal" step="any" value="' + (e.weight || "") +
          '" placeholder="' + (store.isBodyweight(e.name) ? "BW" : "0") + '">' +
        '<button data-w="' + step + '" aria-label="Increase weight">+</button>' +
      '</div>' +
      '<p class="hint">The starting point for each set. Change a single set from the set itself.</p>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="fS">Sets</label>' +
      '<div class="stepper">' +
        '<button data-s="-1" aria-label="One fewer set">−</button>' +
        '<input id="fS" type="number" inputmode="numeric" min="1" max="' + store.MAX_SETS + '" value="' + e.sets + '">' +
        '<button data-s="1" aria-label="One more set">+</button>' +
      '</div>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="fR">Target reps</label>' +
      '<input id="fR" type="text" value="' + esc(e.reps) + '" placeholder="6-8">' +
      '<div class="quick">' + ["6-8","8-10","10-12","12-15"].map(function(r){
        return '<button data-r="' + r + '">' + r + '</button>';
      }).join("") + '</div>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="fN">Exercise notes</label>' +
      '<textarea id="fN" placeholder="Seat on 4, pins at 7. Pause at the bottom.">' + esc(e.note) + '</textarea>' +
    '</div>' +

    '<div class="rowbtns">' +
      '<button data-move="-1">Move up</button>' +
      '<button data-move="1">Move down</button>' +
      '<button class="danger" data-remove="1">Remove</button>' +
    '</div>',
  "edit");
}

/* --------------------------------------------------------------------------
   Marking a day off
   -------------------------------------------------------------------------- */

function skipSheet(){
  var today = store.dayKey(Date.now());

  openSheet("Day off",
    '<p class="sheet-sub">Put the gap in the log on purpose, so a quiet week ' +
      'reads as a quiet week and not as missing data.</p>' +

    '<div class="field">' +
      '<label class="lab" for="skDate">Date</label>' +
      '<input id="skDate" type="date" value="' + today + '" max="' + today + '">' +
    '</div>' +

    '<div class="field">' +
      '<span class="lab">What kind of day</span>' +
      '<div class="seg wide">' +
        '<button data-skiptype="missed" aria-pressed="true">Missed</button>' +
        '<button data-skiptype="rest" aria-pressed="false">Rest day</button>' +
      '</div>' +
      '<p class="hint">Missed is one you owe; a rest day was the plan. Either way ' +
        'the rotation stays put — the workout you skipped is still the next one up.</p>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="skDay">Which workout it would have been</label>' +
      '<select id="skDay">' +
        store.state.days.map(function(d, i){
          return '<option value="' + i + '"' + (i === store.state.day ? " selected" : "") + '>' +
                   esc(d.name) + '</option>';
        }).join("") +
      '</select>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="skNote">Note</label>' +
      '<textarea id="skNote" placeholder="Sick. Travelling. Gym shut."></textarea>' +
    '</div>' +

    '<div class="rowbtns one">' +
      '<button class="primary" id="saveSkip">Add to the log</button>' +
    '</div>',
  "skip");
}

/* --------------------------------------------------------------------------
   Weigh-in
   -------------------------------------------------------------------------- */

function weightSheet(){
  var today = store.dayKey(Date.now());
  var last = store.latestBodyweight();
  var recent = store.state.body.slice(-6).reverse();

  openSheet("Weigh-in",
    '<p class="sheet-sub">One reading per day — weighing in twice on a Tuesday ' +
      'replaces the first rather than making two points.</p>' +

    '<div class="field">' +
      '<label class="lab" for="bwDate">Date</label>' +
      '<input id="bwDate" type="date" value="' + today + '" max="' + today + '">' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="bwVal">Weight (' + esc(unit()) + ')</label>' +
      '<input id="bwVal" type="number" inputmode="decimal" step="any" min="0"' +
        ' placeholder="' + (last ? last.w : "0") + '">' +
      '<p class="hint">Your bodyweight is what makes the strength chart mean ' +
        'something — a lift going up while you get heavier is a different story ' +
        'from one going up while you don’t.</p>' +
    '</div>' +

    (recent.length
      ? '<div class="field">' +
          '<span class="lab">Recent</span>' +
          '<div class="bwlist">' + recent.map(function(b){
            return '<div class="bwrow">' +
              '<span>' + esc(formatWeekday(b.at)) + '</span>' +
              '<b>' + b.w + ' ' + esc(unit()) + '</b>' +
              '<button class="segdel" data-bwdel="' + b.at + '">Remove</button>' +
            '</div>';
          }).join("") + '</div>' +
        '</div>'
      : "") +

    '<div class="rowbtns one">' +
      '<button class="primary" id="saveWeight">Save</button>' +
    '</div>',
  "weight");
}

/* --------------------------------------------------------------------------
   Logging food

   Daily totals, not meals — the number you'd read off at the end of the day.
   `draft` carries half-typed values across a change of date, so noticing
   "this was yesterday's" after typing doesn't cost you the typing.
   -------------------------------------------------------------------------- */

function goalHint(key){
  var goal = store.goalOn(key);
  if(!goal) return "No target set for this day.";
  return "Target this day: " + kcal(goal.kcal) + " kcal" +
    (store.PHASES[goal.phase] ? " · " + store.PHASES[goal.phase] : "") + ".";
}

function numField(id, label, value, placeholder, mode){
  return '<div class="field">' +
    '<label class="lab" for="' + id + '">' + esc(label) + '</label>' +
    '<input id="' + id + '" type="number" inputmode="' + mode + '" min="0" step="any"' +
      ' value="' + (value === null || value === undefined ? "" : value) + '"' +
      ' placeholder="' + esc(placeholder) + '">' +
  '</div>';
}

function foodSheet(key, draft){
  var today = store.dayKey(Date.now());
  var day = key || today;
  var saved = store.nutritionOn(day);
  var vals = saved || draft || {};

  openSheet("Food",
    '<p class="sheet-sub">Daily totals. Fill in whatever you tracked — every field is optional.</p>' +

    '<div class="field">' +
      '<label class="lab" for="fdDate">Date</label>' +
      '<input id="fdDate" type="date" value="' + esc(day) + '" max="' + today + '">' +
    '</div>' +

    numField("fdKcal", "Calories", vals.kcal, "kcal", "numeric") +
    '<p class="hint" id="fdGoal">' + esc(goalHint(day)) + '</p>' +

    '<div class="seggrid">' +
      numField("fdProt", "Protein (g)", vals.protein, "optional", "decimal") +
      numField("fdFib", "Fiber (g)", vals.fiber, "optional", "decimal") +
    '</div>' +

    '<div class="rowbtns ' + (saved ? "two" : "one") + '">' +
      '<button class="primary" id="saveFood">Save</button>' +
      (saved ? '<button class="danger" id="clearFood">Clear this day</button>' : '') +
    '</div>',
  "food");
}

/* --------------------------------------------------------------------------
   The calorie target

   Set once per phase, with a start date. Starting today leaves every earlier
   day judged against what it was judged against before; backdating the start
   is how you say "the cut actually began last Monday".
   -------------------------------------------------------------------------- */

/* Starting points worked out from your own maintenance, when there is one.

   −500 a day is the classic steady cut and +250 a slow, lean gain. They're
   suggestions and nothing more: a tap fills the field and picks the phase,
   and the number is yours to change before saving. */
var CUT = 500;
var BULK = 250;

function suggestionsHTML(){
  var est = store.tdee().now;
  if(!est.ready) return "";

  var perUnit = store.energyPerUnit();
  var cutRate = (Math.round(CUT * 7 / perUnit * 10) / 10) + " " + unit();
  var bulkRate = (Math.round(BULK * 7 / perUnit * 10) / 10) + " " + unit();
  var opts = [
    ["cut", "Cut", est.tdee - CUT, "−" + CUT],
    ["maintain", "Maintain", est.tdee, "±0"],
    ["bulk", "Bulk", est.tdee + BULK, "+" + BULK]
  ];

  return '<div class="field">' +
    '<span class="lab">From your maintenance, ≈' + kcal(est.tdee) + '</span>' +
    '<div class="suggest">' + opts.map(function(o){
      return '<button data-suggest="' + o[2] + '" data-sphase="' + o[0] + '">' +
        '<span>' + esc(o[1]) + '</span>' +
        '<b>' + kcal(o[2]) + '</b>' +
        '<small>' + esc(o[3]) + '</small>' +
      '</button>';
    }).join("") + '</div>' +
    '<p class="hint">Starting points: −' + CUT + ' a day is about ' + cutRate +
      ' a week down, +' + BULK + ' about ' + bulkRate + ' a week up. Tap one, then adjust.</p>' +
  '</div>';
}

function goalSheet(){
  var today = store.dayKey(Date.now());
  var goal = store.currentGoal();
  var phase = goal ? goal.phase : "";
  var past = store.state.nutrition.goals.slice().reverse();
  var phases = [["", "None"], ["cut", "Cut"], ["maintain", "Maintain"], ["bulk", "Bulk"]];

  /* A CHANGE of target is a new phase, so it starts today. The FIRST target
     is different: starting it today would leave every day you'd already
     logged with nothing to be measured against, so it reaches back to the
     earliest one instead. Either way the date is right there to change. */
  var logged = store.nutritionKeys();
  var from = (!store.state.nutrition.goals.length && logged.length)
    ? logged[logged.length - 1]
    : today;

  openSheet("Calorie target",
    '<p class="sheet-sub">One per phase. Changing it never rewrites the days before it started.</p>' +

    suggestionsHTML() +

    numField("gKcal", "Calories per day", goal ? goal.kcal : null, "2200", "numeric") +

    '<div class="field">' +
      '<span class="lab">Phase</span>' +
      '<div class="seg wide">' + phases.map(function(p){
        return '<button data-gphase="' + p[0] + '" aria-pressed="' + (phase === p[0]) + '">' +
                 esc(p[1]) + '</button>';
      }).join("") + '</div>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="gFrom">Starting</label>' +
      '<input id="gFrom" type="date" value="' + from + '">' +
      '<p class="hint">Pick an earlier date if the phase really began earlier — ' +
        'days from then on are re-judged against this target, and nothing before it is.</p>' +
    '</div>' +

    (past.length
      ? '<div class="field">' +
          '<span class="lab">Phases so far</span>' +
          '<div class="bwlist">' + past.map(function(g){
            return '<div class="bwrow">' +
              '<span>From ' + esc(formatDay(store.fromDayKey(g.from))) +
                (store.PHASES[g.phase] ? ' · ' + esc(store.PHASES[g.phase]) : '') + '</span>' +
              '<b>' + kcal(g.kcal) + ' kcal</b>' +
              '<button class="segdel" data-goaldel="' + esc(g.from) + '">Remove</button>' +
            '</div>';
          }).join("") + '</div>' +
        '</div>'
      : '') +

    '<div class="rowbtns one">' +
      '<button class="primary" id="saveGoal">Save target</button>' +
    '</div>',
  "goal");
}

/* --------------------------------------------------------------------------
   Exercise library picker
   -------------------------------------------------------------------------- */

/* Built-ins and your own in one list. Yours get an Edit button, which is
   the only place they can be changed or removed. */
function libRow(x){
  return '<div class="lib-row" data-search="' + esc(x.name.toLowerCase()) + '">' +
    '<button class="lib-item" data-pick="' + esc(x.name) + '">' +
      '<strong>' + esc(x.name) + '</strong>' +
      '<span class="d">' + x.sets + ' × ' + esc(x.reps) +
        (x.pattern ? ' · ' + esc(data.PATTERN_LABEL[x.pattern]) : '') +
      '</span>' +
    '</button>' +
    (store.isCustom(x.name)
      ? '<button class="lib-edit" data-libedit="' + esc(x.name) + '">Edit</button>'
      : '') +
  '</div>';
}

function librarySheet(mode){
  var all = store.libAll();
  var groups = [];
  all.forEach(function(x){ if(groups.indexOf(x.group) < 0) groups.push(x.group); });

  var html =
    '<div class="field">' +
      '<input id="libSearch" type="text" placeholder="Search, or type a name of your own" autocomplete="off">' +
    '</div>' +
    '<div id="libCustom"></div>' +
    '<button class="add-btn" id="libNew">+ New exercise</button>' +
    '<div id="libList">' +
      groups.map(function(g){
        return '<div class="lib-group">' + esc(g) + '</div>' +
          all.filter(function(x){ return x.group === g; }).map(libRow).join("");
      }).join("") +
    '</div>';

  openSheet(mode === "swap" ? "Swap exercise" : "Add exercise", html, mode);
  $("libSearch").addEventListener("input", filterLibrary);
}

/* Filter the picker, hide group headings that end up empty, and offer the
   typed text as a new exercise when nothing matches. */
function filterLibrary(){
  var raw = this.value.trim();
  var q = raw.toLowerCase();
  var shown = 0;

  var rows = document.querySelectorAll("#libList .lib-row");
  for(var i = 0; i < rows.length; i++){
    var hit = !q || rows[i].dataset.search.indexOf(q) >= 0;
    rows[i].hidden = !hit;
    if(hit) shown++;
  }

  var heads = document.querySelectorAll("#libList .lib-group");
  for(var j = 0; j < heads.length; j++){
    var n = heads[j].nextElementSibling;
    var any = false;
    while(n && n.classList.contains("lib-row")){
      if(!n.hidden){ any = true; break; }
      n = n.nextElementSibling;
    }
    heads[j].hidden = !any;
  }

  $("libCustom").innerHTML = (raw && shown === 0)
    ? '<button class="lib-item solo" data-newname="' + esc(raw) + '">' +
        '<strong>Add “' + esc(raw) + '”</strong>' +
        '<span class="d">set it up ›</span>' +
      '</button>'
    : "";
}

/* --------------------------------------------------------------------------
   Building an exercise the library doesn't have

   Only one field here isn't cosmetic. The pattern is what tells rotation
   which other exercises could do this one's job — leave it blank and the
   exercise simply never rotates, which is a perfectly good answer for
   something you always want to do.
   -------------------------------------------------------------------------- */
function builderSheet(name, existing){
  var d = data.CUSTOM_DEFAULTS;
  var x = existing || {
    name:name || "", group:d.group, type:d.type,
    sets:d.sets, reps:d.reps, pattern:"", bw:false
  };

  var groups = [];
  store.libAll().forEach(function(g){
    if(groups.indexOf(g.group) < 0) groups.push(g.group);
  });

  var types = [["compound","Compound"],["support","Support"],["small","Small"]];

  openSheet(existing ? "Edit exercise" : "New exercise",
    '<div class="field">' +
      '<label class="lab" for="nxName">Name</label>' +
      '<input id="nxName" type="text" value="' + esc(x.name) + '" placeholder="Hack Squat Machine">' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="nxGroup">Body part</label>' +
      '<input id="nxGroup" type="text" list="nxGroups" value="' + esc(x.group) + '">' +
      '<datalist id="nxGroups">' +
        groups.map(function(g){ return '<option value="' + esc(g) + '">'; }).join("") +
      '</datalist>' +
    '</div>' +

    '<div class="field">' +
      '<span class="lab">Weight class</span>' +
      '<div class="seg wide">' + types.map(function(t){
        return '<button data-nxtype="' + t[0] + '" aria-pressed="' + (x.type === t[0]) + '">' +
                 t[1] + '</button>';
      }).join("") + '</div>' +
      '<p class="hint">Compounds get the three-minute rest and rotate slowest.</p>' +
    '</div>' +

    '<div class="seggrid">' +
      '<div class="field">' +
        '<label class="lab" for="nxSets">Sets</label>' +
        '<input id="nxSets" type="number" inputmode="numeric" min="1" max="' +
          store.MAX_SETS + '" value="' + x.sets + '">' +
      '</div>' +
      '<div class="field">' +
        '<label class="lab" for="nxReps">Target reps</label>' +
        '<input id="nxReps" type="text" value="' + esc(x.reps) + '" placeholder="8-10">' +
      '</div>' +
    '</div>' +

    '<div class="field">' +
      '<label class="lab" for="nxPattern">What job does it do</label>' +
      '<select id="nxPattern">' +
        '<option value="">Nothing else — never rotate it</option>' +
        data.PATTERNS.map(function(p){
          return '<option value="' + esc(p[0]) + '"' +
                 (x.pattern === p[0] ? " selected" : "") + '>' + esc(p[1]) + '</option>';
        }).join("") +
      '</select>' +
      '<p class="hint">This is the field auto-rotation reads. Pick “Squat pattern” ' +
        'for a hack squat and it can stand in for the V-squat, and the V-squat for it.</p>' +
    '</div>' +

    '<div class="setrow">' +
      '<div class="k">Loaded by bodyweight<small>Shows BW, and progresses on reps</small></div>' +
      '<div class="seg">' +
        '<button data-nxbw="1" aria-pressed="' + (x.bw === true) + '">Yes</button>' +
        '<button data-nxbw="0" aria-pressed="' + (x.bw !== true) + '">No</button>' +
      '</div>' +
    '</div>' +

    '<div class="rowbtns ' + (existing ? "two" : "one") + '">' +
      '<button class="primary" id="nxSave">' +
        (existing ? "Save" : "Save and use it") + '</button>' +
      (existing
        ? '<button class="danger" data-nxdel="' + esc(x.name) + '">Remove</button>'
        : '') +
    '</div>',
  "builder");
}

/* --------------------------------------------------------------------------
   Importing training you already did
   -------------------------------------------------------------------------- */

var SAMPLE =
  "2026-08-25 Upper A\n" +
  "Incline Smith Press 135x8 135x8 145x6\n" +
  "Barbell Bent-Over Row 155x8x3\n" +
  "Pull-Ups BWx9 BWx7\n" +
  "note: incline felt easy\n\n" +
  "8/27 Lower A\n" +
  "Hack Squat 250x8x4\n" +
  "Barbell RDL 185x8 185x8 195x6";

var lastImport = null;

function importSheet(){
  openSheet("Add past workouts",
    /* The sub is set in small caps, so it has to stay one line. The rest of
       the explanation goes under the box, where it reads as prose. */
    '<p class="sheet-sub">Training you have already done, in the shorthand you would write anyway.</p>' +

    '<div class="field">' +
      '<label class="lab" for="impText">Your training</label>' +
      '<textarea id="impText" class="tall" spellcheck="false" autocapitalize="none" ' +
        'placeholder="' + esc(SAMPLE) + '"></textarea>' +
      '<p class="hint">It lands in the log as real sessions, so the charts, the ' +
        '“last time” lines and every working weight start from where you actually ' +
        'are rather than from zero.</p>' +
    '</div>' +

    '<details class="fmt">' +
      '<summary>What it understands</summary>' +
      '<ul>' +
        '<li><b>A date starts a day.</b> <code>2026-08-25</code>, <code>8/25</code>, ' +
          '<code>8/25/26</code>, <code>Aug 25</code> or <code>yesterday</code> — then ' +
          'the workout name, if it had one.</li>' +
        '<li><b>Every other line is one exercise:</b> its name, then its sets.</li>' +
        '<li><code>135x8 135x8 145x6</code> — three sets</li>' +
        '<li><code>155x8x3</code> — that same set three times</li>' +
        '<li><code>185x5+155x3</code> — one set with a drop in it</li>' +
        '<li><code>BWx9</code> — bodyweight</li>' +
        '<li><code>45 45 45</code> — reps with nothing on the bar</li>' +
        '<li><code>note: felt strong</code> — a note on the day</li>' +
      '</ul>' +
      '<p class="hint">Spaces, commas, <code>lb</code> and <code>@</code> are all ' +
        'fine. Names are matched loosely, so “hack squat” finds the hack squat ' +
        'machine; anything genuinely new is added to your library.</p>' +
    '</details>' +

    '<div class="impview" id="impView"></div>' +

    '<div class="rowbtns one">' +
      '<button class="primary" id="impRun" disabled>Add to my log</button>' +
    '</div>',
  "import");

  $("impText").addEventListener("input", previewImport);
  previewImport();
}

/* Live read-back of what the text would become — including the lines it
   could NOT read, because an import you can't check is one you can't trust. */
function previewImport(){
  var box = $("impView");
  var btn = $("impRun");
  if(!box || !btn) return;

  var text = $("impText").value;

  if(!text.trim()){
    lastImport = null;
    btn.disabled = true;
    box.innerHTML = '<p class="hint">Nothing to read yet.</p>';
    return;
  }

  var parsed = IL.plan.parseImport(text);
  lastImport = parsed;
  btn.disabled = !parsed.sessions.length;

  if(!parsed.sessions.length){
    box.innerHTML = '<p class="impwarn">No sessions found yet — every workout ' +
      'needs a line starting with its date, above its exercises.</p>';
    return;
  }

  var first = parsed.sessions[0];
  var last = parsed.sessions[parsed.sessions.length - 1];

  box.innerHTML =
    '<div class="settotal">' +
      '<span>' + parsed.sessions.length +
        (parsed.sessions.length === 1 ? " session" : " sessions") + '</span>' +
      '<b>' + parsed.sets + ' sets · ' +
        parsed.volume.toLocaleString() + ' ' + esc(unit()) + '</b>' +
    '</div>' +
    '<p class="hint">' + esc(formatDay(first.at)) +
      (parsed.sessions.length > 1 ? " to " + esc(formatDay(last.at)) : "") + '</p>' +

    parsed.sessions.map(function(sn){
      return '<div class="improw">' +
        '<span>' + esc(formatDay(sn.at)) + '</span>' +
        '<b>' + esc(sn.dayName || "Imported") + '</b>' +
        '<small>' + sn.entries.length + ' exercises</small>' +
      '</div>';
    }).join("") +

    (parsed.unknown.length
      ? '<p class="hint">New to the app, and added to your library: ' +
          esc(parsed.unknown.join(", ")) + '.</p>'
      : "") +

    (parsed.errors.length
      ? '<p class="impwarn">' + parsed.errors.length +
          (parsed.errors.length === 1 ? " line skipped" : " lines skipped") + ' — ' +
          esc(parsed.errors.slice(0, 4).map(function(x){
            return "line " + x.line + " (" + x.why + ")";
          }).join(", ")) + '.</p>'
      : "");
}

/* -------------------------------------------------------------------------- */

function init(){
  viewEl  = $("view");
  sheetEl = $("sheet");
  scrimEl = $("scrim");
  toastEl = $("toast");
}

IL.ui = {
  init: init,
  esc: esc,
  formatClock: formatClock,
  formatDay: formatDay,
  repsSummary: repsSummary,
  segsDetail: segsDetail,
  toast: toast,

  renderRail: renderRail,
  renderTrain: renderTrain,
  patchExercise: patchExercise,
  setFinishLabel: setFinishLabel,
  renderLog: renderLog,
  paintDataPanel: paintDataPanel,
  renderProgress: renderProgress,
  paintCharts: paintCharts,

  get progress(){ return progress; },

  openSheet: openSheet,
  closeSheet: closeSheet,
  sheetMode: sheetMode,
  setSheet: setSheet,
  refreshSetTotal: refreshSetTotal,
  exerciseSheet: exerciseSheet,
  librarySheet: librarySheet,
  builderSheet: builderSheet,
  importSheet: importSheet,
  previewImport: previewImport,
  get lastImport(){ return lastImport; },
  skipSheet: skipSheet,
  weightSheet: weightSheet,
  foodSheet: foodSheet,
  goalSheet: goalSheet
};

})(window.IL);
