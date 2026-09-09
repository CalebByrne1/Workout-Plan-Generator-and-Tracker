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
      '<div class="k">Start over<small>Erases the plan, history and settings</small></div>' +
      '<button class="edit danger" id="resetAll">Reset</button>' +
    '</div>' +
  '</div>';
}

/* Getting the log off the phone. Everything here is generated on the device
   and handed to you — nothing is uploaded anywhere, because there is nowhere
   to upload it to. */
function dataPanel(){
  var canShare = !!(navigator.share && navigator.canShare);

  return '<div class="settings">' +
    '<h3 class="set-title">Your data</h3>' +
    '<p class="hint">' + store.state.history.length + ' entries and ' +
      store.state.body.length + ' weigh-ins are saved on this device only. ' +
      'Send yourself a copy whenever you want one off it.</p>' +
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
  '</div>';
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
      '<button class="add-btn" id="addSkip">+ Mark a missed or rest day</button>' +
      body + settingsPanel() + dataPanel() +
    '</div>';

  $("actionbar").hidden = true;
  renderRail("log");
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

function renderProgress(){
  var s = store.summary();
  var view = strengthView();
  var bw = store.latestBodyweight();

  var sub = s.since
    ? "Week " + s.weeks + " · training since " + formatDay(s.since)
    : "Nothing logged yet";

  /* One weigh-in is a number with nothing to compare it to, which is not the
     same as having none — say what's actually missing. */
  var bwSub;
  if(!bw)                            bwSub = "add a weigh-in";
  else if(store.state.body.length < 2) bwSub = "log another to see the trend";
  else if(s.bodyweightDelta)         bwSub = (s.bodyweightDelta > 0 ? "+" : "") +
                                             s.bodyweightDelta + " since the start";
  else                               bwSub = "level since the start";

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
        statTile("Bodyweight", bw ? bw.w + " " + unit() : "—", bwSub) +
      '</div>' +

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
        '<div class="chart-host" id="chBody"></div>' +
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

  IL.chart.draw($("chBody"), {
    kind: "line",
    points: store.bodySeries(),
    fmtY: function(v){ return Math.round(v); },
    fmtV: function(v){ return v + " " + unit(); },
    fmtX: formatDay,
    label: "bodyweight over time",
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

  openSheet("Edit exercise",
    '<button class="swapname" id="swapBtn">' +
      '<strong>' + esc(e.name) + '</strong><span>Swap ›</span>' +
    '</button>' +

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
   Exercise library picker
   -------------------------------------------------------------------------- */

function librarySheet(mode){
  var groups = [];
  data.LIB.forEach(function(r){ if(groups.indexOf(r[0]) < 0) groups.push(r[0]); });

  var html =
    '<div class="field">' +
      '<input id="libSearch" type="text" placeholder="Search, or type a name of your own" autocomplete="off">' +
    '</div>' +
    '<div id="libCustom"></div>' +
    '<div id="libList">' +
      groups.map(function(g){
        return '<div class="lib-group">' + esc(g) + '</div>' +
          data.LIB.filter(function(r){ return r[0] === g; }).map(function(r){
            return '<button class="lib-item" data-pick="' + esc(r[1]) + '"' +
                     ' data-search="' + esc(r[1].toLowerCase()) + '">' +
                     '<strong>' + esc(r[1]) + '</strong>' +
                     '<span class="d">' + r[3] + '×' + r[4] + '</span>' +
                   '</button>';
          }).join("");
      }).join("") +
    '</div>';

  openSheet(mode === "swap" ? "Swap exercise" : "Add exercise", html, mode);
  $("libSearch").addEventListener("input", filterLibrary);
}

/* Filter the picker, hide group headings that end up empty, and offer the
   typed text as a custom exercise when nothing matches. */
function filterLibrary(){
  var raw = this.value.trim();
  var q = raw.toLowerCase();
  var shown = 0;

  var items = document.querySelectorAll("#libList .lib-item");
  for(var i = 0; i < items.length; i++){
    var hit = !q || items[i].dataset.search.indexOf(q) >= 0;
    items[i].hidden = !hit;
    if(hit) shown++;
  }

  var heads = document.querySelectorAll("#libList .lib-group");
  for(var j = 0; j < heads.length; j++){
    var n = heads[j].nextElementSibling;
    var any = false;
    while(n && n.classList.contains("lib-item")){
      if(!n.hidden){ any = true; break; }
      n = n.nextElementSibling;
    }
    heads[j].hidden = !any;
  }

  var d = data.CUSTOM_DEFAULTS;
  $("libCustom").innerHTML = (raw && shown === 0)
    ? '<button class="lib-item" data-pick="' + esc(raw) + '">' +
        '<strong>Add “' + esc(raw) + '”</strong>' +
        '<span class="d">' + d.sets + '×' + d.reps + '</span>' +
      '</button>'
    : "";
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
  skipSheet: skipSheet,
  weightSheet: weightSheet
};

})(window.IL);
