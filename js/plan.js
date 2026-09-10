/* ==========================================================================
   plan.js — the part that decides what next week looks like.

   Three jobs, all of them reading the log and writing the plan:

     overload()   what load and rep target this exercise has earned
     advance()    run after a finished session: move the loads, and let a
                  slot or two change hands so the day is never identical
     reseed()     re-derive every working weight from history, which is what
                  makes importing old training worth doing

   plus the importer, which turns notebook shorthand into real sessions.

   NOTHING HERE INVENTS A NUMBER. Every decision is made from a set you
   actually logged, which is why an empty log leaves the plan alone.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var store = IL.store;

/* Load rounded onto the increment you actually have — plates, pins, the
   dumbbell rack's next pair up. */
function toStep(w){
  var step = store.state.prefs.step || 5;
  return Math.max(0, Math.round(w / step) * step);
}

function downStep(w){
  var step = store.state.prefs.step || 5;
  return Math.max(step, Math.floor(w / step) * step);
}

/* --------------------------------------------------------------------------
   Double progression

   In one sentence: earn the top of the rep range on every set and the load
   goes up; hold the range and the load stays while you chase reps; fall out
   of the bottom of it twice and the load comes down.

   `last` is what store.lastEntryFor() hands back — a whole logged entry, so
   the rule can see every set rather than an average.
   -------------------------------------------------------------------------- */
function overload(e, last){
  var unit = store.state.prefs.unit;
  var step = store.state.prefs.step || 5;

  /* Never trained, or trained and nothing recorded: there is no evidence to
     act on, so the plan is left exactly as it is. */
  if(!last || !last.entry || !last.entry.completed){
    return {
      kind: "open",
      weight: e.weight || 0,
      reps: e.reps,
      note: "no logged sets yet — find a working weight"
    };
  }

  var en = last.entry;
  var target = en.target || e.reps;
  var top = store.repTop(target);
  var bottom = store.repBottom(target);
  var plannedSets = en.sets || e.sets;

  var reps = (en.logged || []).map(function(item){
    return store.totalReps(item.segs);
  });
  var lowest = reps.length ? Math.min.apply(null, reps) : 0;
  var missing = Math.max(0, plannedSets - reps.length);
  var under = reps.filter(function(r){ return r < bottom; }).length;
  var loaded = en.topWeight > 0;

  /* Earned it — every planned set at the top of the range. */
  if(!missing && lowest >= top){
    if(loaded){
      return {
        kind: "up",
        weight: toStep(en.topWeight + step),
        reps: e.reps,
        note: "+" + step + " " + unit + " — all " + plannedSets +
              " sets hit " + top
      };
    }
    /* Bodyweight with nothing hanging off you: reps ARE the progression. */
    return {
      kind: "up",
      weight: 0,
      reps: (bottom + 1) + "-" + (top + 1),
      note: "target up to " + (bottom + 1) + "-" + (top + 1) +
            " — you cleared " + top + " on every set"
    };
  }

  /* Inside the range everywhere: same load, more reps. */
  if(!under && !missing){
    return {
      kind: "hold",
      weight: loaded ? en.topWeight : 0,
      reps: e.reps,
      note: "same load — chase " + top + " on all " + plannedSets + " sets"
    };
  }

  /* Two or more sets that you DID do coming in under the bottom of the range
     is a load problem, not a bad night's sleep. Back off enough to rebuild,
     not enough to lose the month it took to get there.

     Sets you never logged are deliberately not counted here: leaving the gym
     early is a short session, and taking weight off the bar for it would
     punish you for something the bar didn't do. */
  if(under >= 2 && loaded){
    var lighter = downStep(en.topWeight * 0.9);
    return {
      kind: "down",
      weight: lighter,
      reps: e.reps,
      note: "−" + Math.round(en.topWeight - lighter) + " " + unit +
            " to rebuild — " + under + " sets came in under " + bottom
    };
  }

  return {
    kind: "hold",
    weight: loaded ? en.topWeight : 0,
    reps: e.reps,
    note: missing
      ? "same load — " + missing + (missing === 1 ? " set" : " sets") +
        " of " + plannedSets + " went unlogged"
      : "same load — a set came in under " + bottom
  };
}

/* --------------------------------------------------------------------------
   Variety

   A slot keeps its job and changes its exercise. Two rules keep that from
   becoming a shuffle:

     age      an exercise has to survive a few visits before it's eligible,
              so nothing moves the week after it arrived
     recency  the candidate chosen is the one you have gone longest without

   Together they walk you round the pool instead of bouncing between two.
   -------------------------------------------------------------------------- */

/* Everything the four days are currently using, so Lower A and Lower B
   can't both land on the hack squat in the same week. */
function inUse(exceptUid){
  var used = {};
  store.state.days.forEach(function(d){
    d.ex.forEach(function(e){
      if(e.uid !== exceptUid) used[e.name] = true;
    });
  });
  return used;
}

function lastTouched(name){
  var found = store.lastEntryFor(name);
  return found ? found.at : 0;
}

/* The exercise this slot should hand over to, or "" for "leave it". */
function nextAlternative(e){
  var pool = store.poolFor(e.name);
  if(pool.length < 2) return "";

  var used = inUse(e.uid);
  var options = pool.filter(function(n){ return n !== e.name && !used[n]; });
  if(!options.length) return "";

  options.sort(function(a, b){
    return lastTouched(a) - lastTouched(b) || a.localeCompare(b);
  });
  return options[0];
}

/* What a slot would rotate to next, for the exercise editor to show. */
function preview(e){
  if(e.pin) return "";
  return nextAlternative(e);
}

/* --------------------------------------------------------------------------
   After a session

   Called by store.finishSession() with the record it just wrote. Loads move
   first so that a slot which then rotates is replaced with a decision
   already made, and the sets count is left alone so the day's shape — and
   therefore its volume — stays recognisable across a swap.
   -------------------------------------------------------------------------- */
function advance(day, record){
  var p = store.state.prefs;
  var entries = record.entries || [];
  var changes = [];
  var byName = {};

  entries.forEach(function(en){ byName[en.name] = en; });

  day.ex.forEach(function(e, i){
    e.rotAge = (e.rotAge || 0) + 1;

    /* entries are built in plan order, so the index is exact; the name is
       there as a belt-and-braces fallback. */
    var en = (entries[i] && entries[i].name === e.name) ? entries[i] : byName[e.name];

    /* Progression off, or nothing logged against this one: clear the chip
       rather than leave it. Advice from three weeks ago, still sitting under
       an exercise as though it were about today, is worse than no advice. */
    if(!p.autoProgress || !en){
      e.progress = null;
      return;
    }

    var res = overload(e, { at:record.at, unit:record.unit, entry:en });
    if(res.kind === "open"){
      e.progress = null;
      return;
    }

    e.weight = res.weight;
    e.reps = res.reps;
    e.progress = { kind:res.kind, note:res.note };
    changes.push({ name:e.name, kind:res.kind, note:res.note });
  });

  var rules = store.varietyRules();
  if(!rules.cap) return changes;

  /* Oldest slot first, and never more than the cap in one go — "a little
     bit different", not a new program every week. */
  var queue = day.ex.slice().sort(function(a, b){
    return (b.rotAge || 0) - (a.rotAge || 0);
  });
  var swapped = 0;
  var heavy = 0;

  queue.forEach(function(e){
    if(swapped >= rules.cap || e.pin) return;

    var compound = store.typeOf(e.name) === "compound";
    var due = compound ? rules.compound : rules.other;
    if((e.rotAge || 0) < due) return;

    /* Only ever one of the heavy movements at a time. Two compounds changing
       in the same session means walking in with no idea what any of it
       should weigh, which is the opposite of progressive overload. */
    if(compound && heavy) return;

    var next = nextAlternative(e);
    if(!next) return;

    var from = e.name;
    var def = store.libLookup(next);
    var seen = store.lastEntryFor(next);

    e.name = next;
    e.reps = String(def.reps);
    e.note = "";                 /* the old note was about the old machine */
    e.log = [];
    e.rotAge = 0;
    e.weight = seen ? overload(e, seen).weight : 0;
    e.progress = {
      kind: "swap",
      note: seen
        ? "in for " + from + " — you had " + seen.entry.topWeight + " " +
          seen.unit + " on it last time"
        : "in for " + from + " — new, find a working weight"
    };

    changes.push({ name:next, from:from, kind:"swap", note:e.progress.note });
    swapped++;
    if(compound) heavy++;
  });

  return changes;
}

/* --------------------------------------------------------------------------
   Re-deriving the whole plan from the log

   Paste in a month of old training, press this, and every day in the
   rotation opens at the load your own history says you have earned. Also
   the repair button for a plan that has drifted away from reality.
   -------------------------------------------------------------------------- */
function reseed(){
  var touched = 0;

  store.state.days.forEach(function(day){
    day.ex.forEach(function(e){
      var last = store.lastEntryFor(e.name);
      if(!last) return;

      var res = overload(e, last);
      if(res.kind === "open") return;

      e.weight = res.weight;
      e.reps = res.reps;
      e.progress = { kind:res.kind, note:res.note };
      touched++;
    });
  });

  store.save();
  return touched;
}

/* --------------------------------------------------------------------------
   Importing training you already did

   The format is what you would scribble in a notebook:

     2026-08-25 Upper A
     Incline Smith Press 135x8 135x8 145x6
     Barbell Bent-Over Row 155x8x3
     Pull-Ups BWx9 BWx7
     Cable Crunch 60x15, 60x15
     note: incline felt easy

   A line that starts with a date starts a new day, and whatever follows the
   date says which workout it was. Every other line is one exercise: its
   name, then its sets.
   -------------------------------------------------------------------------- */

var MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function fullYear(y){ return y < 100 ? 2000 + y : y; }

/* No year given means the most recent one that isn't in the future — you're
   typing up training you have already done, not booking it. */
function stamp(y, mo, d, rest){
  if(mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  var now = new Date();
  var at = new Date(y || now.getFullYear(), mo - 1, d, 12, 0, 0, 0);

  if(!y && at.getTime() > now.getTime() + 86400000){
    at = new Date(now.getFullYear() - 1, mo - 1, d, 12, 0, 0, 0);
  }
  if(isNaN(at.getTime())) return null;

  return { at:at.getTime(), rest:String(rest || "").trim() };
}

/* Reads a date off the front of a line and hands back the timestamp plus
   whatever text followed it. null means "this isn't a header", which is how
   the parser tells a day from an exercise. */
function readDate(line){
  var s = String(line).trim();
  var m;

  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b(.*)$/);
  if(m) return stamp(+m[1], +m[2], +m[3], m[4]);

  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})(?:[-\/.](\d{2,4}))?(?![\d])(.*)$/);
  if(m) return stamp(m[3] ? fullYear(+m[3]) : 0, +m[1], +m[2], m[4]);

  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b(.*)$/);
  if(m){
    var mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if(mi >= 0) return stamp(m[3] ? +m[3] : 0, mi + 1, +m[2], m[4]);
  }

  m = s.match(/^(today|yesterday)\b(.*)$/i);
  if(m){
    var back = m[1].toLowerCase() === "yesterday" ? 86400000 : 0;
    return {
      at: store.fromDayKey(store.dayKey(Date.now() - back)),
      rest: String(m[2] || "").trim()
    };
  }

  return null;
}

/* Understood, in any mix, separated by spaces or commas:

     135x8         one set
     135x8x3       that same set three times
     135 x 8       spaces are fine, so are * and @
     BWx9          bodyweight
     185x5+155x3   one set with a drop in it
     8 8 6         reps only, for a line with no load to record
*/
var SET_TOKEN = /^(?:bw|\d+(?:\.\d+)?)x\d+(?:x\d+)?(?:\+(?:bw|\d+(?:\.\d+)?)x\d+)*$/i;
var BARE_REPS = /^\d{1,3}$/;

/* Close up the gaps so every set becomes one token.

   Two details earn their keep. The digit-or-bw guard on the left stops the x
   in "Box Squat" being eaten. And the right-hand side is a LOOKAHEAD, not a
   capture — matching it would consume the digit, and "155 x 8 x 3" needs
   that 8 still available to pair with the second x. */
function tighten(line){
  var s = String(line);
  s = s.replace(/[×✕]/g, "x").replace(/[–—]/g, "-");
  s = s.replace(/(\d)\s*(?:lbs?|kgs?|#)\b/gi, "$1");
  s = s.replace(/(\d|bw)\s*[x*@]\s*(?=\d)/gi, "$1x");
  s = s.replace(/(\d)\s*\+\s*(?=\d|bw)/gi, "$1+");
  return s;
}

function readExercise(line){
  var s = tighten(line).trim();
  if(!s) return null;

  var tokens = s.split(/[\s,;]+/).filter(Boolean);
  var cut = tokens.length;
  var hasSpec = false;

  while(cut > 0 && SET_TOKEN.test(tokens[cut - 1])){
    hasSpec = true;
    cut--;
  }

  /* No "weight x reps" anywhere on the line: a trailing run of bare numbers
     is reps with nothing on the bar — sit-ups, planks, pull-ups from before
     you started hanging plates off yourself. */
  if(!hasSpec){
    while(cut > 0 && BARE_REPS.test(tokens[cut - 1])) cut--;
  }

  var name = tokens.slice(0, cut).join(" ").replace(/[:\-]\s*$/, "").trim();
  var specs = tokens.slice(cut);
  if(!name || !specs.length) return null;

  var sets = [];

  specs.forEach(function(tok){
    if(BARE_REPS.test(tok)){
      sets.push([{ w:0, r:parseInt(tok, 10) }]);
      return;
    }

    var repeat = 1;
    var segs = [];

    tok.split("+").forEach(function(part, i){
      var bits = part.split(/x/i);
      segs.push({
        w: /^bw$/i.test(bits[0]) ? 0 : (parseFloat(bits[0]) || 0),
        r: parseInt(bits[1], 10) || 0
      });
      if(i === 0 && bits[2]) repeat = Math.min(12, parseInt(bits[2], 10) || 1);
    });

    for(var n = 0; n < repeat; n++){
      sets.push(segs.map(function(sg){ return { w:sg.w, r:sg.r }; }));
    }
  });

  return { name:name, sets:sets };
}

function parseImport(text){
  var lines = String(text || "").split(/\r?\n/);
  var sessions = [];
  var errors = [];
  var unknown = {};
  var current = null;

  lines.forEach(function(raw, i){
    var line = raw.trim();
    if(!line || line.charAt(0) === "#") return;

    var head = readDate(line);
    if(head){
      current = { at:head.at, dayName:head.rest, notes:"", entries:[] };
      sessions.push(current);
      return;
    }

    var noteHit = line.match(/^(?:notes?|comment)\s*[:\-]\s*(.*)$/i);
    if(noteHit && current){
      current.notes = current.notes ? current.notes + " " + noteHit[1] : noteHit[1];
      return;
    }

    if(!current){
      errors.push({ line:i + 1, text:line, why:"no date above it" });
      return;
    }

    var ex = readExercise(line);
    if(!ex){
      errors.push({ line:i + 1, text:line, why:"no sets found in it" });
      return;
    }

    var canonical = store.libResolve(ex.name);
    if(!canonical) unknown[ex.name] = true;

    current.entries.push({ name:canonical || ex.name, sets:ex.sets });
  });

  /* A date with nothing under it is a stray header, not a session. */
  sessions = sessions.filter(function(s){ return s.entries.length; });
  sessions.sort(function(a, b){ return a.at - b.at; });

  var sets = 0;
  var volume = 0;
  sessions.forEach(function(s){
    s.entries.forEach(function(en){
      sets += en.sets.length;
      en.sets.forEach(function(segs){ volume += store.segmentVolume(segs); });
    });
  });

  return {
    sessions: sessions,
    errors: errors,
    unknown: Object.keys(unknown),
    sets: sets,
    volume: Math.round(volume)
  };
}

/* "upper a", "UA" and "Upper-A" all find the day. When the text matches
   none of them the session keeps its own label — an imported day from a
   program you no longer run is still a real day you trained. */
function matchDay(text){
  var want = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if(!want) return null;

  var days = store.state.days;
  var i;
  var keys = days.map(function(d){
    return d.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  });

  for(i = 0; i < days.length; i++){
    if(want === days[i].id.toLowerCase() || want === keys[i]) return days[i];
  }
  for(i = 0; i < days.length; i++){
    if(want.indexOf(keys[i]) >= 0 || keys[i].indexOf(want) >= 0) return days[i];
  }
  return null;
}

/* Turn parsed sessions into real history.

   Volume, top weight and completed counts are computed exactly the way a
   live session computes them, so an imported day and a logged one are the
   same kind of thing to everything downstream — the charts, the totals, the
   "last time" line, and the progression rules. */
function commitImport(parsed, opts){
  opts = opts || {};
  var learned = 0;

  if(opts.learn !== false){
    parsed.unknown.forEach(function(name){
      if(store.addCustomExercise({ name:name, group:"Imported" })) learned++;
    });
  }

  parsed.sessions.forEach(function(s){
    var volume = 0;

    var entries = s.entries.map(function(en){
      var def = store.libLookup(en.name);
      var logged = [];
      var heaviest = 0;
      var exVolume = 0;

      en.sets.forEach(function(segs, k){
        logged.push({ set:k + 1, segs:segs });
        heaviest = Math.max(heaviest, store.topWeight(segs));
        exVolume += store.segmentVolume(segs);
      });

      volume += exVolume;
      return {
        name: en.name,
        sets: logged.length,
        target: String(def.reps || "8-10"),
        completed: logged.length,
        topWeight: heaviest,
        volume: Math.round(exVolume),
        logged: logged
      };
    });

    var day = matchDay(s.dayName);
    store.state.history.push({
      id: store.uid("h"),
      at: s.at,
      kind: "session",
      dayId: day ? day.id : "IM",
      dayName: day ? day.name : (s.dayName || "Imported"),
      notes: s.notes,
      unit: store.state.prefs.unit,
      volume: Math.round(volume),
      entries: entries
    });
  });

  store.sortHistory();
  store.save();

  return { sessions:parsed.sessions.length, learned:learned };
}

IL.plan = {
  overload: overload,
  advance: advance,
  reseed: reseed,
  nextAlternative: nextAlternative,
  preview: preview,
  parseImport: parseImport,
  commitImport: commitImport
};

})(window.IL);
