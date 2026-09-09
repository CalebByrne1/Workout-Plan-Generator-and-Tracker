/* ==========================================================================
   store.js — state, persistence, and the domain questions asked of it.

   The whole app is one plain object saved to localStorage on every change.
   Shape:

     {
       schema:  storage version, so old saves can be migrated
       day:     0-3, index into days
       cycle:   how many times the rotation has come round
       days:    [ { id, name, tag, notes, ex: [ exercise ] } x4 ]
       history: [ session | skip ]        always sorted oldest → newest
       body:    [ { at, w } ]             bodyweight log, one entry per day
       prefs:   { unit, step, autoRest, restCompound, restOther }
     }

     exercise = { uid, name, sets, reps, weight, note, log }

   A SET IS NOT A CHECKBOX. log[k] is either null (not done yet) or an array
   of segments — [{ w, r }, ...] — because one set can be several weights.
   Grinding 5 at 185, stripping down and getting 3 more at 155 is still one
   set, and it's stored as [{w:185,r:5},{w:155,r:3}].

     session = { id, at, kind:"session", dayId, dayName, notes, unit,
                 volume, entries }
     entry   = { name, sets, target, completed, topWeight, volume,
                 logged: [ { set, segs } ] }
     skip    = { id, at, kind:"skip", skipType:"missed"|"rest", dayId,
                 dayName, notes, unit, volume:0, entries:[] }

   HISTORY IS KEYED BY id, NOT BY POSITION. `at` is editable and skips can be
   backdated, so the array is re-sorted after any date change — an index held
   across that would point at the wrong day.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var data = IL.data;

var KEY = "ironLedger.v1";
var SCHEMA = 3;
var MAX_SETS = 10;

var uidCounter = 0;
function uid(prefix){
  uidCounter++;
  return (prefix || "e") + Date.now().toString(36) + uidCounter.toString(36);
}

/* --------------------------------------------------------------------------
   Dates

   Everything is stored as a timestamp, but the app reasons in local days: a
   session belongs to the calendar day you trained, not to a UTC instant.
   dayKey() is that day's identity and is what the date <input> speaks.
   -------------------------------------------------------------------------- */

function dayKey(ts){
  var d = new Date(ts);
  return d.getFullYear() + "-" +
         ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
         ("0" + d.getDate()).slice(-2);
}

/* "2026-09-08" → a timestamp at that local midnight. Parsing the string with
   new Date() would read it as UTC and land on the day before for anyone west
   of Greenwich, so the parts are handed to the constructor directly. */
function fromDayKey(key, keepTimeFrom){
  var bits = String(key).split("-");
  var d = new Date(
    parseInt(bits[0], 10),
    parseInt(bits[1], 10) - 1,
    parseInt(bits[2], 10)
  );
  if(keepTimeFrom){
    var old = new Date(keepTimeFrom);
    d.setHours(old.getHours(), old.getMinutes(), 0, 0);
  }else{
    d.setHours(12, 0, 0, 0);      /* midday: immune to DST edges */
  }
  return d.getTime();
}

function startOfDay(ts){
  var d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

var DAY_MS = 86400000;

function daysBetween(a, b){
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
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
    body: [],
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

/* schema 2 had no ids, no skipped days and no bodyweight log. Everything it
   did have was a real session, so that's what it becomes. */
function migrateToV3(saved){
  saved.body = saved.body || [];
  (saved.history || []).forEach(function(h){
    if(!h.id) h.id = uid("h");
    if(!h.kind) h.kind = "session";
  });
  saved.schema = 3;
  return saved;
}

/* Bring any accepted save up to the current shape. Shared by load() and by
   restoring a backup file, so a backup can never sneak past a migration. */
function normalize(saved){
  saved.prefs = Object.assign(seed().prefs, saved.prefs || {});
  saved.history = saved.history || [];
  saved.body = saved.body || [];
  saved.cycle = saved.cycle || 1;
  saved.day = saved.day || 0;
  saved.days.forEach(function(d){ d.notes = d.notes || ""; });

  if(!saved.schema || saved.schema < 2) migrateToV2(saved);
  if(saved.schema < 3) migrateToV3(saved);

  saved.days.forEach(function(d){
    d.ex.forEach(function(e){ if(!Array.isArray(e.log)) e.log = []; });
  });
  saved.history.sort(function(a, b){ return a.at - b.at; });
  saved.body.sort(function(a, b){ return a.at - b.at; });
  return saved;
}

function looksLikeSave(o){
  return !!(o && o.days && o.days.length === 4 && Array.isArray(o.days[0].ex));
}

function load(){
  try{
    var raw = localStorage.getItem(KEY);
    if(raw){
      var saved = JSON.parse(raw);
      if(looksLikeSave(saved)) return normalize(saved);
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
   History — sessions and skipped days
   -------------------------------------------------------------------------- */

function isSkip(h){ return h.kind === "skip"; }

function sessionsOnly(){
  return state.history.filter(function(h){ return !isSkip(h); });
}

/* Which calendar days have a logged workout on them. */
function trainedDays(){
  var set = {};
  sessionsOnly().forEach(function(h){ set[dayKey(h.at)] = true; });
  return set;
}

/* A day you trained is not a day off, whatever else was recorded against it —
   mark a miss and then train after all, and the miss stops counting. The
   calendar and the counts both defer to this so they can't disagree. */
function skipsOnly(){
  var trained = trainedDays();
  return state.history.filter(function(h){
    return isSkip(h) && !trained[dayKey(h.at)];
  });
}

function sortHistory(){
  state.history.sort(function(a, b){ return a.at - b.at; });
}

function findEntry(id){
  for(var i = 0; i < state.history.length; i++){
    if(state.history[i].id === id) return state.history[i];
  }
  return null;
}

function removeEntry(id){
  for(var i = 0; i < state.history.length; i++){
    if(state.history[i].id === id){
      state.history.splice(i, 1);
      save();
      return true;
    }
  }
  return false;
}

/* Move a logged day to a different date, keeping the time of day it was
   finished at — the date is the part you'd want to correct, not the clock. */
function setEntryDate(id, key){
  var h = findEntry(id);
  if(!h) return false;
  h.at = fromDayKey(key, h.at);
  sortHistory();
  save();
  return true;
}

/* A day you didn't train. "missed" is one you owe; "rest" is one you planned.
   Neither advances the rotation — the workout you skipped is still the next
   one up, which is what you'd actually do at the gym. */
function addSkip(key, skipType, dayIndex, note){
  var day = state.days[dayIndex] || currentDay();
  var entry = {
    id: uid("h"),
    at: fromDayKey(key),
    kind: "skip",
    skipType: skipType === "rest" ? "rest" : "missed",
    dayId: day.id,
    dayName: day.name,
    notes: note || "",
    unit: state.prefs.unit,
    volume: 0,
    entries: []
  };
  state.history.push(entry);
  sortHistory();
  save();
  return entry;
}

/* --------------------------------------------------------------------------
   Bodyweight

   One entry per calendar day — weighing yourself twice on a Tuesday means
   the second reading replaces the first rather than making two points.
   -------------------------------------------------------------------------- */

function addBodyweight(w, key){
  var weight = Math.max(0, Math.round((parseFloat(w) || 0) * 10) / 10);
  if(!weight) return null;

  var at = fromDayKey(key || dayKey(Date.now()));
  var k = dayKey(at);
  var existing = null;

  state.body.forEach(function(b){ if(dayKey(b.at) === k) existing = b; });

  if(existing){
    existing.w = weight;
  }else{
    existing = { at:at, w:weight };
    state.body.push(existing);
  }

  state.body.sort(function(a, b){ return a.at - b.at; });
  save();
  return existing;
}

function removeBodyweight(at){
  state.body = state.body.filter(function(b){ return b.at !== at; });
  save();
}

function latestBodyweight(){
  return state.body.length ? state.body[state.body.length - 1] : null;
}

/* What you weighed around a given date. Walks back to the last reading on or
   before it; if the log only starts later, the earliest reading stands in,
   because a rough number beats dropping the point entirely. */
function bodyweightAt(ts){
  if(!state.body.length) return 0;
  var best = 0;
  for(var i = 0; i < state.body.length; i++){
    if(state.body[i].at <= ts) best = state.body[i].w;
    else break;
  }
  return best || state.body[0].w;
}

/* --------------------------------------------------------------------------
   Progress — turning the log into something plottable
   -------------------------------------------------------------------------- */

/* Epley. It's an estimate and it drifts above about ten reps, but it's the
   standard one and this only ever feeds a trend line, where consistency
   matters more than absolute truth. */
function e1rm(w, r){
  if(!w || !r) return 0;
  return w * (1 + r / 30);
}

/* Every movement you've actually logged, most-trained first — the order the
   exercise picker offers them in. */
function loggedExercises(){
  var counts = {};
  sessionsOnly().forEach(function(h){
    h.entries.forEach(function(en){
      if(en.completed > 0) counts[en.name] = (counts[en.name] || 0) + 1;
    });
  });
  return Object.keys(counts).sort(function(a, b){
    return counts[b] - counts[a] || a.localeCompare(b);
  });
}

/* The strength trend for one movement.

   metric "load" is an estimated 1RM, and for pull-ups and dips your
   bodyweight at the time is added in — a chin-up at 150lb and the same rep
   at 190lb are not the same lift. metric "reps" is the fallback for anything
   never logged with a load (and no bodyweight on file to supply one), where
   more reps IS the progress. */
function exerciseSeries(name){
  var raw = [];
  var anyLoad = false;

  sessionsOnly().forEach(function(h){
    h.entries.forEach(function(en){
      if(en.name !== name || !en.completed) return;

      var bw = bodyweightAt(h.at);
      var carried = data.BODYWEIGHT[name] ? bw : 0;
      var best = 0;
      var reps = 0;

      (en.logged || []).forEach(function(item){
        item.segs.forEach(function(s){
          best = Math.max(best, e1rm((s.w || 0) + carried, s.r));
        });
        reps = Math.max(reps, totalReps(item.segs));
      });

      if(best > 0) anyLoad = true;
      raw.push({ at:h.at, load:best, reps:reps, bw:bw });
    });
  });

  var metric = anyLoad ? "load" : "reps";
  var points = [];

  raw.forEach(function(p){
    var v = metric === "load" ? p.load : p.reps;
    if(!v) return;                      /* a session with nothing usable */
    points.push({ x:p.at, y:Math.round(v * 10) / 10, bw:p.bw });
  });

  return { name:name, metric:metric, points:points };
}

/* The same series divided by what you weighed that week — "am I getting
   stronger for my size", which is the question a changing bodyweight makes
   hard to answer from load alone. Points with no bodyweight on file can't
   be expressed this way and are left out. */
function relativeSeries(series){
  return {
    name: series.name,
    metric: series.metric,
    points: series.points.filter(function(p){ return p.bw > 0; }).map(function(p){
      return { x:p.x, y:Math.round(p.y / p.bw * 100) / 100, bw:p.bw };
    })
  };
}

function volumeSeries(){
  return sessionsOnly().map(function(h){
    return { x:h.at, y:h.volume || 0 };
  });
}

function bodySeries(){
  return state.body.map(function(b){ return { x:b.at, y:b.w }; });
}

/* One row per calendar day for the consistency grid, oldest first, always
   starting on a Sunday so the columns line up as weeks. */
function calendar(weeks){
  var byDay = {};
  state.history.forEach(function(h){
    var k = dayKey(h.at);
    /* A session outranks a skip on the same date — if you logged a workout,
       that day counts as trained whatever else got recorded. */
    if(!byDay[k] || isSkip(byDay[k])) byDay[k] = h;
  });

  var end = startOfDay(Date.now());
  var cursor = new Date(end);
  cursor.setDate(cursor.getDate() - (weeks * 7 - 1));
  cursor.setDate(cursor.getDate() - cursor.getDay());     /* back to Sunday */

  var volumes = sessionsOnly().map(function(h){ return h.volume || 0; })
                              .filter(function(v){ return v > 0; })
                              .sort(function(a, b){ return a - b; });
  var mid = volumes.length ? volumes[Math.floor(volumes.length / 2)] : 0;

  var cells = [];
  var day = cursor.getTime();

  while(startOfDay(day) <= end){
    var k = dayKey(day);
    var hit = byDay[k];
    var level = 0;

    if(hit && !isSkip(hit)){
      level = !mid ? 2 : (hit.volume >= mid * 1.25 ? 3 : hit.volume >= mid * 0.6 ? 2 : 1);
    }

    cells.push({
      at: day,
      key: k,
      state: hit ? (isSkip(hit) ? hit.skipType : "trained") : "none",
      level: level,
      entry: hit || null
    });

    day += DAY_MS;
    day = startOfDay(day) + DAY_MS / 2;   /* re-anchor at midday past DST */
  }

  return cells;
}

/* The headline numbers above the charts. */
function summary(){
  var sessions = sessionsOnly();
  var first = state.history.length ? state.history[0].at : null;
  var since = first ? Math.max(1, Math.ceil((daysBetween(first, Date.now()) + 1) / 7)) : 0;

  var monthAgo = Date.now() - 30 * DAY_MS;
  var recent = sessions.filter(function(h){ return h.at >= monthAgo; });
  var missed = skipsOnly().filter(function(h){
    return h.skipType === "missed" && h.at >= monthAgo;
  });

  var bw = latestBodyweight();
  var firstBw = state.body.length ? state.body[0] : null;

  return {
    sessions: sessions.length,
    weeks: since,
    since: first,
    last30: recent.length,
    missed30: missed.length,
    volume: sessions.reduce(function(n, h){ return n + (h.volume || 0); }, 0),
    bodyweight: bw ? bw.w : 0,
    bodyweightDelta: (bw && firstBw && bw !== firstBw) ? Math.round((bw.w - firstBw.w) * 10) / 10 : 0
  };
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
    id: uid("h"),
    at: Date.now(),
    kind: "session",
    dayId: day.id,
    dayName: day.name,
    notes: day.notes,
    unit: state.prefs.unit,
    volume: Math.round(volume),
    entries: entries
  });
  sortHistory();   /* a backdated skip may already sit after "now" */

  day.ex.forEach(function(e){ e.log = []; });
  day.notes = "";

  if(state.day === state.days.length - 1) state.cycle++;
  state.day = (state.day + 1) % state.days.length;

  save();
  return day;
}

/* --------------------------------------------------------------------------
   Getting the data out (and back in)

   Nothing here talks to the network. These produce text; app.js decides
   whether that text becomes a download or goes into the share sheet.
   -------------------------------------------------------------------------- */

function csvCell(v){
  var s = (v === null || v === undefined) ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* One row per weight lifted — a set with a drop in it is two rows sharing a
   set number, so nothing is averaged away before it reaches a spreadsheet.
   Skipped days get a row of their own so the gaps are explicit. */
function toCSV(){
  var rows = [[
    "date","time","day","type","exercise","set","segment",
    "weight","reps","unit","volume","bodyweight","notes"
  ]];

  state.history.forEach(function(h){
    var d = new Date(h.at);
    var date = dayKey(h.at);
    var time = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    var bw = bodyweightAt(h.at) || "";
    var noteUsed = false;

    function note(){
      if(noteUsed) return "";
      noteUsed = true;
      return h.notes || "";
    }

    if(isSkip(h)){
      rows.push([date, time, h.dayName, h.skipType, "", "", "", "", "", "", 0, bw, note()]);
      return;
    }

    h.entries.forEach(function(en){
      if(!en.logged || !en.logged.length){
        rows.push([date, time, h.dayName, "not done", en.name, "", "", "", "",
                   h.unit || "lb", 0, bw, note()]);
        return;
      }
      en.logged.forEach(function(item){
        item.segs.forEach(function(s, i){
          rows.push([
            date, time, h.dayName, "set", en.name, item.set, i + 1,
            s.w || 0, s.r || 0, h.unit || "lb",
            Math.round((s.w || 0) * (s.r || 0)), bw, note()
          ]);
        });
      });
    });
  });

  /* Weigh-ins ride along in the same file, so one export is the whole story. */
  state.body.forEach(function(b){
    rows.push([dayKey(b.at), "", "", "weigh-in", "", "", "", b.w, "",
               state.prefs.unit, "", b.w, ""]);
  });

  return rows.map(function(r){ return r.map(csvCell).join(","); }).join("\r\n");
}

function toBackup(){
  return JSON.stringify(state, null, 2);
}

/* Replace everything with a backup file. Throws if the text isn't one, so
   the caller can tell you rather than silently wiping the log. */
function restore(text){
  var incoming = JSON.parse(text);
  if(!looksLikeSave(incoming)) throw new Error("Not an Iron Ledger backup.");
  state = normalize(incoming);
  save();
  return state;
}

function exportName(ext){
  return "iron-ledger-" + dayKey(Date.now()) + "." + ext;
}

IL.store = {
  MAX_SETS: MAX_SETS,

  get state(){ return state; },
  set onSaveError(fn){ onSaveError = fn; },

  save: save,
  reset: reset,
  seed: seed,

  dayKey: dayKey,
  fromDayKey: fromDayKey,
  daysBetween: daysBetween,

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
  finishSession: finishSession,

  isSkip: isSkip,
  sessionsOnly: sessionsOnly,
  skipsOnly: skipsOnly,
  findEntry: findEntry,
  removeEntry: removeEntry,
  setEntryDate: setEntryDate,
  addSkip: addSkip,

  addBodyweight: addBodyweight,
  removeBodyweight: removeBodyweight,
  latestBodyweight: latestBodyweight,
  bodyweightAt: bodyweightAt,

  e1rm: e1rm,
  loggedExercises: loggedExercises,
  exerciseSeries: exerciseSeries,
  relativeSeries: relativeSeries,
  volumeSeries: volumeSeries,
  bodySeries: bodySeries,
  calendar: calendar,
  summary: summary,

  toCSV: toCSV,
  toBackup: toBackup,
  restore: restore,
  exportName: exportName
};

})(window.IL);
