/* ==========================================================================
   vault.js — snapshots, and asking the browser not to throw them away.

   The plan and the log live in localStorage, which is one string and one
   mistake away from gone. This adds two things around it:

     persist()    asks the browser to mark this origin's storage as
                  persistent, so it isn't evicted to reclaim space
     snapshots    a rolling set of whole-state copies in IndexedDB, taken
                  automatically before anything destructive and after every
                  finished session

   BE CLEAR ABOUT WHAT THIS PROTECTS AGAINST. Snapshots live in the same
   origin as the thing they back up, so "clear site data", a wiped phone or
   a lost one takes them too. What they undo is the damage you do from
   inside the app — a mistaken Reset, a restore from the wrong file, an
   import that turned out to be nonsense. Getting a copy OFF the device is
   still the export button, and eventually the sync.

   Everything here is best-effort and asynchronous. IndexedDB is missing in
   private windows on some browsers and blocked on file:// in others, so
   every call resolves to something harmless rather than throwing, and the
   app works exactly as before when it isn't there.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var DB_NAME = "ironLedger";
var STORE = "snapshots";
var VERSION = 1;

/* How many to keep. A snapshot is the whole save file, so this grows with
   your history — twenty of them a year in is a few megabytes, which is
   nothing to IndexedDB and would not have fit in localStorage. */
var KEEP = 20;

var dbPromise = null;
var broken = false;

function open(){
  if(broken) return Promise.reject(new Error("unavailable"));
  if(dbPromise) return dbPromise;

  dbPromise = new Promise(function(resolve, reject){
    if(!window.indexedDB){
      reject(new Error("no indexedDB"));
      return;
    }

    var req;
    try{
      req = indexedDB.open(DB_NAME, VERSION);
    }catch(err){
      reject(err);            /* file:// in some browsers throws right here */
      return;
    }

    req.onupgradeneeded = function(){
      var db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, { keyPath:"id", autoIncrement:true })
          .createIndex("at", "at");
      }
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error || new Error("open failed")); };
    req.onblocked = function(){ reject(new Error("blocked")); };
  });

  dbPromise.catch(function(){
    /* Remember the failure so every later call fails fast and silently
       rather than re-prompting a browser that has already said no. */
    broken = true;
    dbPromise = null;
  });

  return dbPromise;
}

/* Run one transaction. `fn` gets the object store and returns a request;
   the promise settles on the transaction, not the request, so the write is
   actually durable by the time it resolves. */
function tx(mode, fn){
  return open().then(function(db){
    return new Promise(function(resolve, reject){
      var t = db.transaction(STORE, mode);
      var store = t.objectStore(STORE);
      var out;

      try{
        out = fn(store);
      }catch(err){
        reject(err);
        return;
      }

      if(out && "onsuccess" in out){
        out.onsuccess = function(){ resolve(out.result); };
        out.onerror = function(){ /* the transaction's own error handles it */ };
      }else{
        t.oncomplete = function(){ resolve(out); };
      }

      t.onerror = function(){ reject(t.error || new Error("transaction failed")); };
      t.onabort = function(){ reject(t.error || new Error("transaction aborted")); };
    });
  });
}

function available(){
  return open().then(function(){ return true; }, function(){ return false; });
}

/* --------------------------------------------------------------------------
   Durability

   persist() is the one call that actually reduces the odds of losing
   everything. Browsers decide for themselves whether to grant it — an
   installed app is the likeliest to get a yes — and a browser without the
   API has no answer to give, which is why the result is three-valued rather
   than a boolean.
   -------------------------------------------------------------------------- */
function persist(){
  if(!navigator.storage || !navigator.storage.persist){
    return Promise.resolve(null);            /* browser has no opinion */
  }
  return navigator.storage.persisted()
    .then(function(already){
      return already ? true : navigator.storage.persist();
    })
    .catch(function(){ return null; });
}

function estimate(){
  if(!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
  return navigator.storage.estimate().catch(function(){ return null; });
}

/* Everything the Data panel wants to say about storage, in one call. */
function status(){
  return Promise.all([
    persist().catch(function(){ return null; }),
    estimate(),
    count().catch(function(){ return 0; })
  ]).then(function(all){
    return { persisted:all[0], estimate:all[1], snapshots:all[2] };
  });
}

/* --------------------------------------------------------------------------
   Snapshots
   -------------------------------------------------------------------------- */

/* The summary shown in the list. Read off the JSON rather than stored
   separately so an older snapshot can never disagree with its own contents. */
function describe(json){
  try{
    var s = JSON.parse(json);
    var sessions = (s.history || []).filter(function(h){ return h.kind !== "skip"; });
    return {
      sessions: sessions.length,
      entries: (s.history || []).length,
      weighIns: (s.body || []).length,
      cycle: s.cycle || 1
    };
  }catch(err){
    return { sessions:0, entries:0, weighIns:0, cycle:1 };
  }
}

/* Take a copy. `json` is store.toBackup() — a string, already serialised, so
   nothing here can be caught half-written by a later edit.

   An identical snapshot is normally not taken twice, so a double-tap on the
   button doesn't push a real checkpoint out of the window.

   `always` overrides that, and every guard before a destructive action
   passes it. Deduping there saves nothing worth having and costs the one
   thing that matters afterwards: finding a snapshot labelled "before reset"
   when you go looking for it, rather than an identical copy filed under
   some other name from a minute earlier. */
function snapshot(json, reason, always){
  if(typeof json !== "string" || !json) return Promise.resolve(null);
  if(always) return write(json, reason);

  return list().then(function(rows){
    if(rows.length && rows[0].bytes === json.length){
      return read(rows[0].id).then(function(prev){
        return prev === json ? null : write(json, reason);
      });
    }
    return write(json, reason);
  }).catch(function(){ return null; });
}

function write(json, reason){
  var meta = describe(json);

  return tx("readwrite", function(store){
    return store.add({
      at: Date.now(),
      reason: String(reason || "snapshot"),
      bytes: json.length,
      sessions: meta.sessions,
      weighIns: meta.weighIns,
      json: json
    });
  }).then(function(id){
    prune();                        /* fire and forget; never blocks a save */
    return id;
  }).catch(function(){ return null; });
}

/* Newest first, without the payloads — the list view doesn't need megabytes
   of JSON to draw a dozen rows. */
function list(){
  return tx("readonly", function(store){
    return store.getAll();
  }).then(function(rows){
    return (rows || []).map(function(r){
      return {
        id: r.id,
        at: r.at,
        reason: r.reason,
        bytes: r.bytes,
        sessions: r.sessions,
        weighIns: r.weighIns
      };
    }).sort(function(a, b){ return b.at - a.at; });
  }).catch(function(){ return []; });
}

function count(){
  return tx("readonly", function(store){
    return store.count();
  }).catch(function(){ return 0; });
}

function read(id){
  return tx("readonly", function(store){
    return store.get(id);
  }).then(function(row){
    return row ? row.json : null;
  }).catch(function(){ return null; });
}

function remove(id){
  return tx("readwrite", function(store){
    return store.delete(id);
  }).then(function(){ return true; }, function(){ return false; });
}

/* Keep the most recent KEEP. Deliberately not clever: an "important ones
   live longer" policy is one more thing that can decide wrong, and the
   thing you want back is nearly always the one from just before now. */
function prune(keep){
  var max = keep || KEEP;

  return list().then(function(rows){
    var doomed = rows.slice(max);
    if(!doomed.length) return 0;

    return Promise.all(doomed.map(function(r){ return remove(r.id); }))
      .then(function(){ return doomed.length; });
  }).catch(function(){ return 0; });
}

function clear(){
  return tx("readwrite", function(store){
    return store.clear();
  }).then(function(){ return true; }, function(){ return false; });
}

IL.vault = {
  KEEP: KEEP,
  available: available,
  persist: persist,
  estimate: estimate,
  status: status,
  snapshot: snapshot,
  list: list,
  count: count,
  read: read,
  remove: remove,
  prune: prune,
  clear: clear,
  describe: describe
};

})(window.IL);
