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
       custom:  [ libEntry ]              exercises you added on the phone
       nutrition: { days:{ "YYYY-MM-DD": food }, goals:[ goal ] }
       prefs:   { unit, step, autoRest, restCompound, restOther,
                  autoProgress, variety, lastExport }
     }

     food = { kcal, protein, fiber }      each a number or null (not logged)
     goal = { from:"YYYY-MM-DD", kcal, phase:"cut"|"maintain"|"bulk"|"" }

     exercise = { uid, name, sets, reps, weight, note, log,
                  pin, rotAge, progress }
     libEntry = { name, group, type, sets, reps, pattern, bw }

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
var SCHEMA = 5;
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

/* Bottom of a "6-8" style target — the number a set has to clear to count
   as on-plan. Progression reads both ends. */
function repBottom(reps){
  var found = String(reps).match(/\d+/g);
  return found ? parseInt(found[0], 10) : 8;
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
   The exercise library

   Two sources, one list: the built-in library in data.js and whatever you
   have added from the phone, which lives in the save file. A custom entry
   with a built-in's name REPLACES it rather than sitting alongside, so
   re-adding "Calf Raise" with a different rep target is how you correct one.
   -------------------------------------------------------------------------- */

/* Guarded because seed() runs while state is still being built — the very
   first plan is laid out before there is a save file to read from. */
function customLib(){ return (state && state.custom) || []; }

function libLookup(name){
  var mine = customLib();
  for(var i = 0; i < mine.length; i++){
    if(mine[i].name === name) return mine[i];
  }
  return data.LIB_BY_NAME[name] ||
         Object.assign({ name:name }, data.CUSTOM_DEFAULTS);
}

function libAll(){
  var out = data.LIB.map(function(r){ return data.LIB_BY_NAME[r[1]]; });
  var at = {};
  out.forEach(function(x, i){ at[x.name] = i; });

  customLib().forEach(function(c){
    if(at[c.name] === undefined) out.push(c);
    else out[at[c.name]] = c;
  });
  return out;
}

function isCustom(name){
  return customLib().some(function(c){ return c.name === name; });
}

/* Punctuation-blind key, so "Hack-Squat machine" and "hack squat machine"
   are the same string to compare. */
function normName(s){
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/* Loosely typed name -> the canonical one, or "" when it's genuinely new.
   An exact match wins; failing that a partial only counts when exactly one
   exercise matches, because silently turning "squat" into "Split Squat"
   would put the wrong numbers in the log. */
function libResolve(name){
  var want = normName(name);
  if(!want) return "";

  var all = libAll();
  var i;
  for(i = 0; i < all.length; i++){
    if(normName(all[i].name) === want) return all[i].name;
  }

  var hits = all.filter(function(x){
    var n = normName(x.name);
    return n.indexOf(want) >= 0 || want.indexOf(n) >= 0;
  });
  return hits.length === 1 ? hits[0].name : "";
}

function addCustomExercise(spec){
  var name = String(spec.name || "").trim().replace(/\s+/g, " ");
  if(!name) return null;

  var d = data.CUSTOM_DEFAULTS;
  var entry = {
    name: name,
    group: String(spec.group || d.group).trim() || d.group,
    type: /^(compound|support|small)$/.test(spec.type) ? spec.type : d.type,
    sets: clampSets(spec.sets || d.sets),
    reps: String(spec.reps || d.reps).trim() || d.reps,
    pattern: data.PATTERN_LABEL[spec.pattern] ? spec.pattern : "",
    bw: !!spec.bw
  };

  state.custom = customLib().filter(function(c){ return c.name !== name; });
  state.custom.push(entry);
  state.custom.sort(function(a, b){ return a.name.localeCompare(b.name); });
  save();
  return entry;
}

/* Only ever forgets the library entry. Sessions already logged against the
   name keep it, and so does any day still using it — removing the entry
   just stops it being offered. */
function removeCustomExercise(name){
  var mine = customLib();
  var kept = mine.filter(function(c){ return c.name !== name; });
  if(kept.length === mine.length) return false;
  state.custom = kept;
  save();
  return true;
}

/* Everything that could do this exercise's job: same movement pattern, same
   weight class. A blank pattern gives a pool of one, which is how you hold
   an exercise still — the app has not been told what it could stand in for. */
function poolFor(name){
  var me = libLookup(name);
  if(!me.pattern) return [name];

  return libAll().filter(function(x){
    return x.pattern === me.pattern && x.type === me.type;
  }).map(function(x){ return x.name; });
}

function patternOf(name){ return libLookup(name).pattern || ""; }

function varietyRules(){
  return data.VARIETY[state.prefs.variety] || data.VARIETY.medium;
}

/* --------------------------------------------------------------------------
   Seeding, loading, migrating
   -------------------------------------------------------------------------- */

/* One exercise as it sits in a day's plan.

   pin       keeps auto-rotation off this slot
   rotAge    visits to this day since the slot last changed hands
   progress  what the last finish decided — the chip on the row */
function planned(name, sets, reps){
  var def = libLookup(name);
  return {
    uid: uid(),
    name: name,
    sets: clampSets(sets || def.sets),
    reps: String(reps || def.reps),
    weight: 0,
    note: "",
    log: [],
    pin: false,
    rotAge: 0,
    progress: null
  };
}

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
          return planned(p[0], p[1], p[2]);
        })
      };
    }),
    history: [],
    body: [],
    custom: [],
    nutrition: { days:{}, goals:[] },
    prefs: {
      unit:"lb", step:5, autoRest:true, restCompound:180, restOther:90,
      autoProgress:true, variety:"medium",
      lastExport:0
    }
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

/* schema 3 knew nothing about custom exercises or auto-progression, so the
   plan it saved has never been advanced. Every new field has a sensible
   default and the first finished session takes it from there. */
function migrateToV4(saved){
  saved.custom = saved.custom || [];
  saved.schema = 4;
  return saved;
}

/* schema 4 had no nutrition log. Nothing to convert — it starts empty. */
function migrateToV5(saved){
  saved.nutrition = saved.nutrition || { days:{}, goals:[] };
  saved.schema = 5;
  return saved;
}

/* Bring any accepted save up to the current shape. Shared by load() and by
   restoring a backup file, so a backup can never sneak past a migration. */
function normalize(saved){
  saved.prefs = Object.assign(seed().prefs, saved.prefs || {});
  saved.history = saved.history || [];
  saved.body = saved.body || [];
  saved.custom = Array.isArray(saved.custom) ? saved.custom : [];
  saved.cycle = saved.cycle || 1;
  saved.day = saved.day || 0;
  saved.days.forEach(function(d){ d.notes = d.notes || ""; });

  if(!saved.schema || saved.schema < 2) migrateToV2(saved);
  if(saved.schema < 3) migrateToV3(saved);
  if(saved.schema < 4) migrateToV4(saved);
  if(saved.schema < 5) migrateToV5(saved);

  /* Whatever arrived, leave nutrition in exactly one shape: days as a map,
     goals as a list in date order. A hand-edited backup can't break it. */
  var food = saved.nutrition || {};
  saved.nutrition = {
    days: (food.days && typeof food.days === "object" && !Array.isArray(food.days))
      ? food.days : {},
    goals: Array.isArray(food.goals) ? food.goals : []
  };
  saved.nutrition.goals.sort(function(a, b){ return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });

  saved.days.forEach(function(d){
    d.ex.forEach(function(e){
      if(!Array.isArray(e.log)) e.log = [];
      if(typeof e.pin !== "boolean") e.pin = false;
      if(typeof e.rotAge !== "number") e.rotAge = 0;
      if(e.progress === undefined) e.progress = null;
    });
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

/* onSaveError is set by app.js so a failed write can surface in the UI.
   onSaved is set by sync.js: every change goes through save(), which makes
   it the one place that can say "something changed, send it up". */
var onSaveError = null;
var onSaved = null;

function save(){
  try{
    localStorage.setItem(KEY, JSON.stringify(state));
  }catch(err){
    if(onSaveError) onSaveError();
    return;
  }
  if(onSaved) onSaved();
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
  return libLookup(name).type || data.CUSTOM_DEFAULTS.type;
}

function isBodyweight(name){
  return !!(data.BODYWEIGHT[name] || libLookup(name).bw);
}

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

/* The most recent session in which a movement was actually worked, handed
   over whole — sets planned, target, every rep of every set. This is what
   the progression rules read to decide the next load. */
function lastEntryFor(name){
  for(var i = state.history.length - 1; i >= 0; i--){
    var h = state.history[i];
    if(isSkip(h)) continue;
    for(var j = 0; j < h.entries.length; j++){
      if(h.entries[j].name === name && h.entries[j].completed > 0){
        return { at:h.at, unit:h.unit || "lb", entry:h.entries[j] };
      }
    }
  }
  return null;
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
   Nutrition

   One entry per calendar day, keyed by the day itself ("2026-09-10") — food
   has no time of day worth keeping. Every field is optional, and a day with
   nothing left in it is removed rather than kept as an empty shell.

   TARGETS ARE PHASES, NOT A NUMBER. Each target starts on a date and holds
   until the next one begins, and a day is always judged against the target
   that was in force ON THAT DAY. Keep a single number instead and moving
   from a bulk to a cut would re-grade every bulk day as a day you blew it.
   -------------------------------------------------------------------------- */

var PHASES = { cut:"Cut", maintain:"Maintain", bulk:"Bulk" };

/* Blank means "not logged". A typed 0 is kept — a day with no fibre is a
   real day, and so is a fast. Negative or unreadable is treated as blank. */
function amount(v, places){
  if(v === null || v === undefined || String(v).trim() === "") return null;
  var n = parseFloat(v);
  if(!isFinite(n) || n < 0) return null;
  var f = Math.pow(10, places || 0);
  return Math.round(n * f) / f;
}

function nutritionOn(key){
  return state.nutrition.days[key] || null;
}

function setNutrition(key, vals){
  var entry = {
    kcal: amount(vals.kcal, 0),
    protein: amount(vals.protein, 1),
    fiber: amount(vals.fiber, 1)
  };

  if(entry.kcal === null && entry.protein === null && entry.fiber === null){
    delete state.nutrition.days[key];
    save();
    return null;
  }

  state.nutrition.days[key] = entry;
  save();
  return entry;
}

function clearNutrition(key){
  delete state.nutrition.days[key];
  save();
}

/* Every day with anything logged, newest first. */
function nutritionKeys(){
  return Object.keys(state.nutrition.days).sort().reverse();
}

function goalOn(key){
  var found = null;
  state.nutrition.goals.forEach(function(g){ if(g.from <= key) found = g; });
  return found;
}

function currentGoal(){ return goalOn(dayKey(Date.now())); }

/* A new target starting on `from`. One per start date — setting a second
   target for the same day corrects the first rather than stacking on it. */
function setGoal(spec){
  var kcal = amount(spec.kcal, 0);
  if(!kcal) return null;

  var goal = {
    from: spec.from || dayKey(Date.now()),
    kcal: kcal,
    phase: PHASES[spec.phase] ? spec.phase : ""
  };

  state.nutrition.goals = state.nutrition.goals.filter(function(g){
    return g.from !== goal.from;
  });
  state.nutrition.goals.push(goal);
  state.nutrition.goals.sort(function(a, b){ return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
  save();
  return goal;
}

function removeGoal(from){
  state.nutrition.goals = state.nutrition.goals.filter(function(g){ return g.from !== from; });
  save();
}

/* The last `count` days, oldest first, INCLUDING the ones with nothing
   logged. The chart needs honest gaps: a missed Wednesday should look like
   a missing Wednesday, not close up so Thursday sits where it would be. */
function nutritionSeries(count){
  var out = [];
  var cursor = new Date(startOfDay(Date.now()));
  cursor.setDate(cursor.getDate() - (count - 1));

  for(var i = 0; i < count; i++){
    var key = dayKey(cursor.getTime());
    var food = nutritionOn(key);
    var goal = goalOn(key);
    var kcal = food ? food.kcal : null;

    out.push({
      key: key,
      at: fromDayKey(key),
      kcal: kcal,
      protein: food ? food.protein : null,
      fiber: food ? food.fiber : null,
      target: goal ? goal.kcal : null,
      phase: goal ? goal.phase : "",
      diff: (kcal !== null && goal) ? kcal - goal.kcal : null
    });

    cursor.setDate(cursor.getDate() + 1);      /* setDate walks DST cleanly */
  }
  return out;
}

/* Averages over a window, each one over ONLY the days that field was logged.
   A day you didn't write fibre down is not a day you ate none, so it can't
   be allowed to drag the average toward zero. */
function nutritionAverages(count){
  var rows = nutritionSeries(count);

  function avg(field){
    var vals = rows.map(function(r){ return r[field]; })
                   .filter(function(v){ return v !== null; });
    if(!vals.length) return { value:null, days:0 };
    var total = vals.reduce(function(n, v){ return n + v; }, 0);
    return { value: total / vals.length, days: vals.length };
  }

  return {
    window: count,
    kcal: avg("kcal"),
    diff: avg("diff"),
    protein: avg("protein"),
    fiber: avg("fiber")
  };
}

/* --------------------------------------------------------------------------
   Weight trend

   One weigh-in is mostly water — salt, carbs, a hard leg day, the time you
   went to bed. Averaging the last seven days of readings cancels most of
   that, which is why the 7-day average is the number the app leads with and
   a single reading is the footnote.
   -------------------------------------------------------------------------- */

var TREND_DAYS = 7;

/* A day key moved by n calendar days. Built from the date's parts so a DST
   change can't knock it a day sideways. */
function shiftKey(key, n){
  var b = String(key).split("-");
  return dayKey(new Date(+b[0], +b[1] - 1, +b[2] + n, 12).getTime());
}

function round1(n){ return Math.round(n * 10) / 10; }

/* The mean of every weigh-in in the 7 days ending on `key`, inclusive, and
   how many readings it's made of. null when there are none — one reading in
   the window is an average of one, and the count says so. */
function weekAverage(key){
  var from = shiftKey(key, -(TREND_DAYS - 1));
  var vals = [];

  state.body.forEach(function(b){
    var k = dayKey(b.at);
    if(k >= from && k <= key) vals.push(b.w);
  });
  if(!vals.length) return null;

  var total = vals.reduce(function(n, v){ return n + v; }, 0);
  return { value: round1(total / vals.length), count: vals.length, from: from, to: key };
}

/* What the Bodyweight tile says: this week's average against last week's.
   Week on week is the number that tells a cut or a bulk how it's going;
   "since the start" is what the chart is for. */
function weightTrend(){
  var today = dayKey(Date.now());
  var now = weekAverage(today);
  var prev = weekAverage(shiftKey(today, -TREND_DAYS));

  return {
    now: now,
    prev: prev,
    change: (now && prev) ? round1(now.value - prev.value) : null,
    latest: latestBodyweight()
  };
}

/* The trend as of each weigh-in, with the reading itself alongside — the
   chart draws the average as its line and the readings as faint dots. */
function bodyTrendSeries(){
  return state.body.map(function(b){
    var avg = weekAverage(dayKey(b.at));
    return { x: b.at, y: avg.value, raw: b.w, count: avg.count };
  });
}

/* Bodyweight "at the time" for anything that divides by it. The 7-day
   average where there is one, so a single heavy morning doesn't knock a
   point off your relative strength; the nearest reading otherwise. */
function trendWeightAt(ts){
  var avg = weekAverage(dayKey(ts));
  return avg ? avg.value : bodyweightAt(ts);
}

/* --------------------------------------------------------------------------
   Maintenance, from your own numbers

   Over a few weeks, what you ate and what the scale did pin down what you
   burn:

     maintenance = average intake − (weight change per day × energy per unit)

   Lose half a pound a week on 2,300 and you're burning about 2,550.

   Three details decide whether that's useful or misleading:

   · The weight change is the SLOPE of a line fitted through every weigh-in
     in the window, not the last reading minus the first. Two single days
     are mostly water; a fitted line through twenty isn't.
   · Intake averages only the days you logged. Unlogged days are unknown,
     not zero.
   · Nothing is shown until there's enough to stand on. A confident wrong
     number is worse than "not yet".

   The ± that comes with it is one standard error of the slope, turned into
   kilocalories: how much the weigh-ins disagree with the line they sit on.
   It shrinks with more weigh-ins and a steadier scale. It says nothing about
   how carefully the food was counted — but a consistent miscount cancels
   out, because the answer comes back in your own counting. That is exactly
   what a target needs, and exactly what no online calculator can give you.

   The window runs through YESTERDAY. Today's food isn't finished, and a
   breakfast-only today would drag the average down every morning.
   -------------------------------------------------------------------------- */

var TDEE_WINDOW = 21;
var TDEE_NEEDS = { kcalDays: 10, weighIns: 6, span: 10 };

/* The usual approximation for body tissue: 3,500 kcal a pound, 7,700 a kilo.
   Weights are stored in whatever unit the app is set to, so this follows. */
function energyPerUnit(){ return state.prefs.unit === "kg" ? 7700 : 3500; }

/* Ordinary least squares, plus the standard error of the slope. */
function fitLine(pts){
  var n = pts.length;
  var mx = 0, my = 0;
  pts.forEach(function(p){ mx += p.x; my += p.y; });
  mx /= n; my /= n;

  var sxx = 0, sxy = 0;
  pts.forEach(function(p){ sxx += (p.x - mx) * (p.x - mx); sxy += (p.x - mx) * (p.y - my); });

  var slope = sxx ? sxy / sxx : 0;
  var sse = 0;
  pts.forEach(function(p){
    var e = p.y - (my + slope * (p.x - mx));
    sse += e * e;
  });

  var se = (n > 2 && sxx) ? Math.sqrt(sse / (n - 2)) / Math.sqrt(sxx) : 0;
  return { slope: slope, se: se };
}

/* The estimate for the 21 days ending on `endKey`. Always says what it had
   to work with, and — when it isn't ready — exactly what it's still missing. */
function tdeeFor(endKey){
  var startKey = shiftKey(endKey, -(TDEE_WINDOW - 1));
  var kcals = [];
  var key = startKey;

  for(var i = 0; i < TDEE_WINDOW; i++){
    var food = nutritionOn(key);
    if(food && food.kcal !== null) kcals.push(food.kcal);
    key = shiftKey(key, 1);
  }

  var pts = [];
  state.body.forEach(function(b){
    var k = dayKey(b.at);
    if(k >= startKey && k <= endKey){
      pts.push({ x: daysBetween(fromDayKey(startKey), b.at), y: b.w });
    }
  });
  var span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;

  var out = {
    from: startKey,
    to: endKey,
    window: TDEE_WINDOW,
    kcalDays: kcals.length,
    weighIns: pts.length,
    span: span,
    need: {
      kcalDays: Math.max(0, TDEE_NEEDS.kcalDays - kcals.length),
      weighIns: Math.max(0, TDEE_NEEDS.weighIns - pts.length),
      span: Math.max(0, TDEE_NEEDS.span - span)
    },
    ready: false
  };

  if(out.need.kcalDays || out.need.weighIns || out.need.span) return out;

  var intake = kcals.reduce(function(n, v){ return n + v; }, 0) / kcals.length;
  var fit = fitLine(pts);
  var perUnit = energyPerUnit();

  out.ready = true;
  out.intake = Math.round(intake);
  out.perWeek = Math.round(fit.slope * 7 * 100) / 100;       /* unit per week */
  out.unit = state.prefs.unit;
  out.tdee = Math.round((intake - fit.slope * perUnit) / 10) * 10;
  out.band = Math.max(10, Math.round(fit.se * perUnit / 10) * 10);
  return out;
}

/* Now, and a week ago — so the card can say whether it's drifting. */
function tdee(){
  var today = dayKey(Date.now());
  var now = tdeeFor(shiftKey(today, -1));
  var weekAgo = tdeeFor(shiftKey(today, -1 - TREND_DAYS));

  return {
    now: now,
    weekAgo: weekAgo.ready ? weekAgo : null,
    change: (now.ready && weekAgo.ready) ? now.tdee - weekAgo.tdee : null
  };
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
   bodyweight at the time (the 7-day average) is added in — a chin-up at
   150lb and the same rep at 190lb are not the same lift. metric "reps" is the fallback for anything
   never logged with a load (and no bodyweight on file to supply one), where
   more reps IS the progress. */
function exerciseSeries(name){
  var raw = [];
  var anyLoad = false;

  sessionsOnly().forEach(function(h){
    h.entries.forEach(function(en){
      if(en.name !== name || !en.completed) return;

      var bw = trendWeightAt(h.at);
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

  /* Bodyweight isn't summarised here any more — it has its own trend (see
     weightTrend), because a single reading makes a poor headline. */
  return {
    sessions: sessions.length,
    weeks: since,
    since: first,
    last30: recent.length,
    missed30: missed.length,
    volume: sessions.reduce(function(n, h){ return n + (h.volume || 0); }, 0)
  };
}

/* --------------------------------------------------------------------------
   Mutations
   -------------------------------------------------------------------------- */

function newExercise(name){ return planned(name); }

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

  var record = {
    id: uid("h"),
    at: Date.now(),
    kind: "session",
    dayId: day.id,
    dayName: day.name,
    notes: day.notes,
    unit: state.prefs.unit,
    volume: Math.round(volume),
    entries: entries
  };

  state.history.push(record);
  sortHistory();   /* a backdated skip may already sit after "now" */

  day.ex.forEach(function(e){ e.log = []; });
  day.notes = "";

  /* Set the day up for next time while the session is still in hand: loads
     move on what you actually hit, and a slot or two may change hands. It
     happens here rather than in app.js so every route to a finished session
     gets the same treatment. */
  var changes = IL.plan ? IL.plan.advance(day, record) : [];

  if(state.day === state.days.length - 1) state.cycle++;
  state.day = (state.day + 1) % state.days.length;

  save();
  return { day:day, record:record, changes:changes };
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
  var header = [
    "date","time","day","type","exercise","set","segment",
    "weight","reps","unit","volume","bodyweight","notes",
    "calories","calorie_target","protein_g","fiber_g"
  ];
  var rows = [header];

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

  /* And so does food, with the target that was in force that day — the
     spreadsheet can do its own over/under without knowing about phases. */
  nutritionKeys().slice().reverse().forEach(function(key){
    var food = nutritionOn(key);
    var goal = goalOn(key);
    rows.push([key, "", "", "nutrition", "", "", "", "", "", "", "", "", "",
               food.kcal, goal ? goal.kcal : "", food.protein, food.fiber]);
  });

  /* Rows written before the nutrition columns existed just end early. */
  rows.forEach(function(r){ while(r.length < header.length) r.push(""); });

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

/* Stamped whenever a copy actually leaves the device, so the Data panel can
   say how long it has been. Snapshots do NOT count — they live in the same
   origin as the thing they are backing up. */
function markExported(){
  state.prefs.lastExport = Date.now();
  save();
  return state.prefs.lastExport;
}

function daysSinceExport(){
  if(!state.prefs.lastExport) return null;
  return daysBetween(state.prefs.lastExport, Date.now());
}

function exportName(ext){
  return "iron-ledger-" + dayKey(Date.now()) + "." + ext;
}

IL.store = {
  MAX_SETS: MAX_SETS,

  get state(){ return state; },
  set onSaveError(fn){ onSaveError = fn; },
  set onSaved(fn){ onSaved = fn; },

  save: save,
  reset: reset,
  seed: seed,

  dayKey: dayKey,
  fromDayKey: fromDayKey,
  daysBetween: daysBetween,

  uid: uid,
  repTop: repTop,
  repBottom: repBottom,
  repChoices: repChoices,
  totalReps: totalReps,
  segmentVolume: segmentVolume,
  topWeight: topWeight,
  isLogged: isLogged,

  currentDay: currentDay,
  customLib: customLib,
  libLookup: libLookup,
  libAll: libAll,
  libResolve: libResolve,
  isCustom: isCustom,
  addCustomExercise: addCustomExercise,
  removeCustomExercise: removeCustomExercise,
  poolFor: poolFor,
  patternOf: patternOf,
  varietyRules: varietyRules,
  typeOf: typeOf,
  isBodyweight: isBodyweight,
  restFor: restFor,
  doneCount: doneCount,
  dayProgress: dayProgress,
  exerciseVolume: exerciseVolume,
  lastPerformed: lastPerformed,

  planned: planned,
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
  sortHistory: sortHistory,
  lastEntryFor: lastEntryFor,
  sessionsOnly: sessionsOnly,
  skipsOnly: skipsOnly,
  findEntry: findEntry,
  removeEntry: removeEntry,
  setEntryDate: setEntryDate,
  addSkip: addSkip,

  PHASES: PHASES,
  nutritionOn: nutritionOn,
  setNutrition: setNutrition,
  clearNutrition: clearNutrition,
  nutritionKeys: nutritionKeys,
  goalOn: goalOn,
  currentGoal: currentGoal,
  setGoal: setGoal,
  removeGoal: removeGoal,
  nutritionSeries: nutritionSeries,
  nutritionAverages: nutritionAverages,

  addBodyweight: addBodyweight,
  removeBodyweight: removeBodyweight,
  latestBodyweight: latestBodyweight,
  bodyweightAt: bodyweightAt,

  e1rm: e1rm,
  loggedExercises: loggedExercises,
  exerciseSeries: exerciseSeries,
  relativeSeries: relativeSeries,
  volumeSeries: volumeSeries,
  TREND_DAYS: TREND_DAYS,
  TDEE_NEEDS: TDEE_NEEDS,
  shiftKey: shiftKey,
  weekAverage: weekAverage,
  weightTrend: weightTrend,
  bodyTrendSeries: bodyTrendSeries,
  trendWeightAt: trendWeightAt,
  energyPerUnit: energyPerUnit,
  fitLine: fitLine,
  tdeeFor: tdeeFor,
  tdee: tdee,
  calendar: calendar,
  summary: summary,

  markExported: markExported,
  daysSinceExport: daysSinceExport,
  toCSV: toCSV,
  toBackup: toBackup,
  restore: restore,
  exportName: exportName
};

})(window.IL);
