/* ==========================================================================
   store.js — state, persistence, and the domain questions asked of it.

   The whole app is one plain object saved to localStorage on every change.
   Shape:

     {
       schema:  storage version, so old saves can be migrated
       day:     0-3, index into days
       cycle:   how many times the rotation has come round
       days:    [ { id, name, tag, notes, ex: [ exercise ] } x4 ]
       history: [ session ]
       prefs:   { unit, step, autoRest, restCompound, restOther }
     }

     exercise = { uid, name, sets, reps, weight, note, log }

   A SET IS NOT A CHECKBOX. log[k] is either null (not done yet) or an array
   of segments — [{ w, r }, ...] — because one set can be several weights.
   Grinding 5 at 185, stripping down and getting 3 more at 155 is still one
   set, and it's stored as [{w:185,r:5},{w:155,r:3}].

     session = { at, dayId, dayName, notes, unit, volume, entries }
     entry   = { name, sets, target, completed, topWeight, volume,
                 logged: [ { set, segs } ] }
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var data = IL.data;

var KEY = "ironLedger.v1";
var SCHEMA = 2;
var MAX_SETS = 10;

var uidCounter = 0;
function uid(){
  uidCounter++;
  return "e" + Date.now().toString(36) + uidCounter.toString(36);
}

/* --------------------------------------------------------------------------
   Reading a rep target
   -------------------------------------------------------------------------- */

/* Top of a "6-8" style target. Quick-logging a set assumes you hit this. */
function repTop(reps){
  var found = String(reps).match(/\d+/g);
  return found ? parseInt(found[found.length - 1], 10) : 8;
}

/* Every whole number in the target, for the one-tap rep chips. */
function repChoices(reps){
  var found = String(reps).match(/\d+/g);
  if(!found) return [];
  var low = parseInt(found[0], 10);
  var high = parseInt(found[found.length - 1], 10);
  if(high < low) high = low;
  if(high - low > 7) return [low, high];        /* silly-wide target, just ends */
  var out = [];
  for(var n = low; n <= high; n++) out.push(n);
  return out;
}

/* --------------------------------------------------------------------------
   Segments
   -------------------------------------------------------------------------- */

function totalReps(segs){
  if(!segs) return 0;
  return segs.reduce(function(n, s){ return n + (s.r || 0); }, 0);
}

function segmentVolume(segs){
  if(!segs) return 0;
  return segs.reduce(function(n, s){ return n + (s.w || 0) * (s.r || 0); }, 0);
}

/* Heaviest weight in a set — what the set is "at", ignoring the drops. */
function topWeight(segs){
  if(!segs || !segs.length) return 0;
  return segs.reduce(function(m, s){ return Math.max(m, s.w || 0); }, 0);
}

function isLogged(e, k){ return !!(e.log && e.log[k] && e.log[k].length); }

/* --------------------------------------------------------------------------
   Seeding, loading, migrating
   -------------------------------------------------------------------------- */

function seed(){
  return {
    schema: SCHEMA,
    day: 0,
    cycle: 1,
    days: data.TEMPLATES.map(function(t){
      return {
        id: t.id,
        name: t.name,
        tag: t.tag,
        notes: "",
        ex: t.plan.map(function(p){
          return { uid:uid(), name:p[0], sets:p[1], reps:p[2], weight:0, note:"", log:[] };
        })
      };
    }),
    history: [],
    prefs: { unit:"lb", step:5, autoRest:true, restCompound:180, restOther:90 }
  };
}

/* schema 1 stored done:[bool]. Rebuild each ticked set as a single segment at
   whatever the working weight and rep target were, so nothing is lost. */
function migrateToV2(saved){
  saved.days.forEach(function(d){
    d.ex.forEach(function(e){
      if(e.log) return;
      var done = e.done || [];
      e.log = [];
      for(var k = 0; k < e.sets; k++){
        e.log[k] = done[k] ? [{ w:(e.weight || 0), r:repTop(e.reps) }] : null;
      }
      delete e.done;
    });
  });

  (saved.history || []).forEach(function(h){
    h.entries.forEach(function(en){
      if(en.logged) return;
      var segs = [];
      for(var k = 0; k < (en.completed || 0); k++){
        segs.push({ set:k + 1, segs:[{ w:(en.weight || 0), r:repTop(en.reps) }] });
      }
      en.logged = segs;
      en.target = en.reps;
      en.topWeight = en.weight || 0;
      en.volume = segs.reduce(function(n, s){ return n + segmentVolume(s.segs); }, 0);
      delete en.weight;
      delete en.reps;
    });
    h.volume = h.entries.reduce(function(n, en){ return n + (en.volume || 0); }, 0);
  });

  saved.schema = 2;
  return saved;
}

function load(){
  try{
    var raw = localStorage.getItem(KEY);
    if(raw){
      var saved = JSON.parse(raw);
      if(saved && saved.days && saved.days.length === 4){
        /* Fill in anything an older save predates rather than discarding it. */
        saved.prefs = Object.assign(seed().prefs, saved.prefs || {});
        saved.history = saved.history || [];
        saved.cycle = saved.cycle || 1;
        saved.day = saved.day || 0;
        saved.days.forEach(function(d){ d.notes = d.notes || ""; });
        if(!saved.schema || saved.schema < 2) migrateToV2(saved);
        saved.days.forEach(function(d){
          d.ex.forEach(function(e){ if(!Array.isArray(e.log)) e.log = []; });
        });
        return saved;
      }
    }
  }catch(err){
    /* Unreadable or blocked storage — fall through to the stock plan. */
  }
  return seed();
}

var state = load();

/* onSaveError is set by app.js so a failed write can surface in the UI. */
var onSaveError = null;

function save(){
  try{
    localStorage.setItem(KEY, JSON.stringify(state));
  }catch(err){
    if(onSaveError) onSaveError();
  }
}

function reset(){
  state = seed();
  save();
  return state;
}

/* --------------------------------------------------------------------------
   Questions asked about the state
   -------------------------------------------------------------------------- */

function currentDay(){ return state.days[state.day]; }

function typeOf(name){
  var found = data.LIB_BY_NAME[name];
  return found ? found.type : data.CUSTOM_DEFAULTS.type;
}

function isBodyweight(name){ return !!data.BODYWEIGHT[name]; }

function restFor(name){
  return typeOf(name) === "compound" ? state.prefs.restCompound : state.prefs.restOther;
}

function doneCount(e){
  var n = 0;
  for(var k = 0; k < e.sets; k++){ if(isLogged(e, k)) n++; }
  return n;
}

function dayProgress(day){
  var total = 0, done = 0;
  day.ex.forEach(function(e){ total += e.sets; done += doneCount(e); });
  return { done:done, total:total };
}

function exerciseVolume(e){
  var v = 0;
  for(var k = 0; k < e.sets; k++){ v += segmentVolume(e.log[k]); }
  return v;
}

/* Most recent logged performance per movement, for the "last ..." line.
   Walks history newest-first and keeps the first hit for each name. */
function lastPerformed(){
  var map = {};
  for(var i = state.history.length - 1; i >= 0; i--){
    var h = state.history[i];
    for(var j = 0; j < h.entries.length; j++){
      var en = h.entries[j];
      if(!map[en.name] && en.completed > 0){
        map[en.name] = {
          topWeight: en.topWeight || 0,
          logged: en.logged || [],
          unit: h.unit || "lb"
        };
      }
    }
  }
  return map;
}

/* --------------------------------------------------------------------------
   Mutations
   -------------------------------------------------------------------------- */

function newExercise(name){
  var def = data.LIB_BY_NAME[name] || data.CUSTOM_DEFAULTS;
  return { uid:uid(), name:name, sets:def.sets, reps:def.reps, weight:0, note:"", log:[] };
}

function clampSets(n){
  return Math.min(MAX_SETS, Math.max(1, parseInt(n, 10) || 1));
}

function setSets(e, n){
  e.sets = clampSets(n);
  e.log.length = e.sets;   /* drop logs for sets that no longer exist */
  return e.sets;
}

function addWeight(e, delta){
  /* Round to 2dp so 2.5 steps don't drift into float noise. */
  e.weight = Math.max(0, Math.round(((+e.weight || 0) + delta) * 100) / 100);
  return e.weight;
}

/* One tap: assume the working weight and the top of the rep target. */
function quickLog(e, k){
  e.log[k] = [{ w:(e.weight || 0), r:repTop(e.reps) }];
  return e.log[k];
}

function clearSet(e, k){ e.log[k] = null; }

/* A drop starts one step lighter and at roughly half the reps — both are
   just a sensible place for the steppers to begin. */
function addSegment(e, k){
  var segs = e.log[k];
  if(!segs) segs = quickLog(e, k);
  var prev = segs[segs.length - 1];
  segs.push({
    w: Math.max(0, Math.round((prev.w - state.prefs.step) * 100) / 100),
    r: Math.max(1, Math.round(prev.r / 2))
  });
  return segs;
}

function removeSegment(e, k, index){
  var segs = e.log[k];
  if(!segs || segs.length <= 1) return false;
  segs.splice(index, 1);
  return true;
}

function setSegmentWeight(e, k, index, value){
  var seg = e.log[k] && e.log[k][index];
  if(!seg) return 0;
  seg.w = Math.max(0, Math.round((value || 0) * 100) / 100);
  return seg.w;
}

function setSegmentReps(e, k, index, value){
  var seg = e.log[k] && e.log[k][index];
  if(!seg) return 0;
  seg.r = Math.min(999, Math.max(0, parseInt(value, 10) || 0));
  return seg.r;
}

function moveExercise(day, from, to){
  if(to < 0 || to >= day.ex.length) return false;
  var moved = day.ex.splice(from, 1)[0];
  day.ex.splice(to, 0, moved);
  return true;
}

/* Log the session, clear the sets, advance the rotation.
   Returns the finished day so the caller can report on it. */
function finishSession(){
  var day = currentDay();
  var volume = 0;

  var entries = day.ex.map(function(e){
    var logged = [];
    var heaviest = 0;
    var exVolume = 0;

    for(var k = 0; k < e.sets; k++){
      if(!isLogged(e, k)) continue;
      var segs = e.log[k].map(function(s){ return { w:s.w, r:s.r }; });
      logged.push({ set:k + 1, segs:segs });
      heaviest = Math.max(heaviest, topWeight(segs));
      exVolume += segmentVolume(segs);
    }

    volume += exVolume;
    return {
      name: e.name,
      sets: e.sets,
      target: e.reps,
      completed: logged.length,
      topWeight: heaviest,
      volume: Math.round(exVolume),
      logged: logged
    };
  });

  state.history.push({
    at: Date.now(),
    dayId: day.id,
    dayName: day.name,
    notes: day.notes,
    unit: state.prefs.unit,
    volume: Math.round(volume),
    entries: entries
  });

  day.ex.forEach(function(e){ e.log = []; });
  day.notes = "";

  if(state.day === state.days.length - 1) state.cycle++;
  state.day = (state.day + 1) % state.days.length;

  save();
  return day;
}

IL.store = {
  MAX_SETS: MAX_SETS,

  get state(){ return state; },
  set onSaveError(fn){ onSaveError = fn; },

  save: save,
  reset: reset,
  seed: seed,

  repTop: repTop,
  repChoices: repChoices,
  totalReps: totalReps,
  segmentVolume: segmentVolume,
  topWeight: topWeight,
  isLogged: isLogged,

  currentDay: currentDay,
  typeOf: typeOf,
  isBodyweight: isBodyweight,
  restFor: restFor,
  doneCount: doneCount,
  dayProgress: dayProgress,
  exerciseVolume: exerciseVolume,
  lastPerformed: lastPerformed,

  newExercise: newExercise,
  clampSets: clampSets,
  setSets: setSets,
  addWeight: addWeight,
  quickLog: quickLog,
  clearSet: clearSet,
  addSegment: addSegment,
  removeSegment: removeSegment,
  setSegmentWeight: setSegmentWeight,
  setSegmentReps: setSegmentReps,
  moveExercise: moveExercise,
  finishSession: finishSession
};

})(window.IL);
