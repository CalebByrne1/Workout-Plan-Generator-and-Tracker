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
  return d.toLocaleDateString(undefined, { month:"short", day:"numeric" }) + " · " +
         d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
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
        '<p class="sub">' + esc(day.tag) + '</p>' +
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

function sessionCard(h, index, isOpen){
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
    '<button class="sess-top" data-open="' + index + '" aria-expanded="' + isOpen + '">' +
      '<span class="sess-tag">' + esc(h.dayId) + '</span>' +
      '<span class="sess-when"><b>' + esc(h.dayName) + '</b><small>' + formatDate(h.at) + '</small></span>' +
      '<span class="sess-vol"><b>' + h.volume.toLocaleString() + '</b><small>' + esc(u) + ' volume</small></span>' +
    '</button>' +
    (isOpen ?
      '<div class="sess-detail">' + lines +
        (h.notes ? '<p class="sess-note">' + esc(h.notes) + '</p>' : '') +
        '<button class="sess-del" data-del="' + index + '">Delete this session</button>' +
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

function renderLog(openIndex){
  var history = store.state.history;
  var body;

  if(!history.length){
    body = '<p class="empty">No sessions logged yet. Finish a workout and it lands here with every rep you did.</p>';
  }else{
    var cards = [];
    for(var i = history.length - 1; i >= 0; i--){
      cards.push(sessionCard(history[i], i, openIndex === i));
    }
    body = cards.join("");
  }

  viewEl.innerHTML =
    '<div class="session-head">' +
      '<div>' +
        '<h2>Training log</h2>' +
        '<p class="sub">' + history.length + ' session' + (history.length === 1 ? "" : "s") + ' recorded</p>' +
      '</div>' +
    '</div>' +
    '<div class="hist">' + body + settingsPanel() + '</div>';

  $("actionbar").hidden = true;
  renderRail("log");
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

function stepper(kind, index, value, step, min){
  return '<div class="stepper mini">' +
    '<button data-seg="' + kind + ',' + index + ',' + (-step) + '" aria-label="Less">−</button>' +
    '<input type="number" inputmode="' + (kind === "w" ? "decimal" : "numeric") + '"' +
      ' step="any" min="' + min + '" data-segval="' + kind + ',' + index + '"' +
      ' value="' + value + '">' +
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
  repsSummary: repsSummary,
  segsDetail: segsDetail,
  toast: toast,

  renderRail: renderRail,
  renderTrain: renderTrain,
  patchExercise: patchExercise,
  setFinishLabel: setFinishLabel,
  renderLog: renderLog,

  openSheet: openSheet,
  closeSheet: closeSheet,
  sheetMode: sheetMode,
  setSheet: setSheet,
  refreshSetTotal: refreshSetTotal,
  exerciseSheet: exerciseSheet,
  librarySheet: librarySheet
};

})(window.IL);
