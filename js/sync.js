/* ==========================================================================
   sync.js — the same log on every device, through Supabase.

   The whole save is one JSON document and there is one of you, so sync is
   one row per account holding that document. Nothing finer-grained: every
   device keeps working offline exactly as before, and this only ever moves
   the whole document between the device and the account.

     pull   the account changed and this device didn't — take the account's
     push   this device changed and the account didn't — send ours
     both   both changed since they last spoke — the newer copy wins, and the
            other is kept as a snapshot HERE, so nothing is thrown away

   The server numbers every write (rev). A device remembers the last rev it
   saw; a push only lands if the account is still at that rev, which is how
   two devices writing at once can't silently overwrite each other.

   Talks to Supabase's REST endpoints with plain fetch — no client library —
   so the app still needs nothing but a browser. The server side is in
   supabase/schema.sql.

   SIGN-IN IS BY CODE, NOT LINK. The email carries a one-time code you type
   into the app. A link would open in the phone's browser, and on an iPhone a
   home-screen app doesn't share storage with Safari: you'd end up signed in
   to Safari, not to the app. A link still works if it happens to open in the
   same browser the app is running in, so both are handled.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var store = IL.store;

/* The publishable key is meant to be public — it ships in every browser that
   loads the app. What protects the data is row-level security on the table:
   each row is readable and writable only by the account that owns it. */
var config = {
  url: "https://fhfpcknbivgdsefllloi.supabase.co",
  key: "sb_publishable_hG3P3R3JKhwSLa6pPXjayQ_3kGAb8T1",
  table: "ledgers",
  pushDelay: 2500,        /* after the last change, wait this long, then push */
  checkEvery: 15000       /* re-check the account on focus at most this often */
};

var AUTH_KEY = "ironLedger.auth";
var META_KEY = "ironLedger.sync";

function readJSON(k){
  try{ return JSON.parse(localStorage.getItem(k)) || null; }catch(err){ return null; }
}

function writeJSON(k, v){
  try{
    if(v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  }catch(err){ /* storage blocked — sync just won't remember */ }
}

/* --------------------------------------------------------------------------
   Per-device bookkeeping. Deliberately NOT part of the save: which rev this
   device last saw, and whether it has changes the account hasn't, are facts
   about this device, and syncing them would make every device lie.
   -------------------------------------------------------------------------- */

var session = readJSON(AUTH_KEY);
var meta;

function blankMeta(){
  return {
    user: null,           /* account these numbers belong to */
    rev: 0,               /* last account rev this device saw; 0 = never linked */
    dirty: false,         /* changes here the account hasn't got */
    edited: 0,            /* when this device last changed anything (its clock) */
    seq: 0,               /* bumps on every local change, to spot edits mid-push */
    lastSync: 0,
    lastDevice: ""        /* who wrote the copy we last took */
  };
}

function saveMeta(patch){
  if(patch) Object.keys(patch).forEach(function(k){ meta[k] = patch[k]; });
  writeJSON(META_KEY, meta);
}

meta = blankMeta();
(function(){
  var m = readJSON(META_KEY);
  if(m) Object.keys(m).forEach(function(k){ meta[k] = m[k]; });
})();

/* --------------------------------------------------------------------------
   Status, for the Data panel
   -------------------------------------------------------------------------- */

var status = { state: session ? "idle" : "signed-out", message: "" };
var listeners = [];
var hooks = { applied:null, choose:null, conflict:null, signedOut:null };

function setStatus(state, message){
  status = { state: state, message: message || "" };
  listeners.forEach(function(fn){ try{ fn(status); }catch(err){ /* a UI bug mustn't stop sync */ } });
}

function onChange(fn){ listeners.push(fn); }

/* --------------------------------------------------------------------------
   HTTP
   -------------------------------------------------------------------------- */

function api(path, opts){
  opts = opts || {};
  var headers = { "apikey": config.key, "Content-Type": "application/json" };
  if(opts.auth && session) headers.Authorization = "Bearer " + session.access_token;
  if(opts.headers) Object.keys(opts.headers).forEach(function(k){ headers[k] = opts.headers[k]; });

  return fetch(config.url + path, {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  }).then(function(res){
    return res.text().then(function(text){
      var body = null;
      try{ body = text ? JSON.parse(text) : null; }catch(err){ body = text; }
      if(!res.ok){
        var err = new Error(serverMessage(body) || ("HTTP " + res.status));
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    });
  });
}

function serverMessage(b){
  return b && typeof b === "object"
    ? (b.msg || b.message || b.error_description || b.error || "")
    : "";
}

/* What to tell a person. The raw errors are for developers; these are for
   someone standing in a gym. */
function explain(err){
  if(!err) return "Something went wrong.";
  var code = err.body && (err.body.code || err.body.error_code);

  if(err.signedOut)
    return "Signed out — sign in again to keep syncing.";
  if(err.status === undefined || err instanceof TypeError)
    return "Couldn't reach the sync server. Check the connection and try again.";
  if(err.status === 429)
    return "Supabase limits how often it sends sign-in emails. Wait a few minutes and try again.";
  if(code === "otp_expired" || /expired|invalid/i.test(err.message) && /token|otp|code/i.test(err.message))
    return "That code didn't work — it may have expired. Send a new one.";
  if(code === "PGRST205" || code === "42P01")
    return "The sync table doesn't exist yet. Run supabase/schema.sql in the Supabase SQL editor.";
  if(code === "42501" || err.status === 403)
    return "The account's database refused this. Check that supabase/schema.sql has been run.";
  return err.message || "Couldn't sync.";
}

/* Errors of our own making carry status 0, so nothing mistakes them for a
   dropped connection. */
function internal(message){
  var err = new Error(message);
  err.status = 0;
  return err;
}

/* --------------------------------------------------------------------------
   Signing in
   -------------------------------------------------------------------------- */

/* The claims inside an access token — who it belongs to. Only read, never
   trusted for anything: the server checks the token on every request. */
function claims(token){
  try{
    var part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while(part.length % 4) part += "=";
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  }catch(err){
    return {};
  }
}

function adopt(s){
  if(!s || !s.access_token) throw new Error("No session came back from the server.");
  var who = s.user || {};
  var c = (!who.id || !who.email) ? claims(s.access_token) : {};

  session = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ? s.expires_at * 1000 : Date.now() + (s.expires_in || 3600) * 1000,
    user: { id: who.id || c.sub, email: who.email || c.email || "" }
  };
  writeJSON(AUTH_KEY, session);

  /* A different account on this device starts its bookkeeping from nothing —
     its rev numbers mean nothing to the last one's. */
  if(meta.user !== session.user.id){
    var dirty = true;                 /* this device's data is news to the new account */
    meta = blankMeta();
    saveMeta({ user: session.user.id, dirty: dirty, edited: Date.now() });
  }
  return session;
}

/* Where a link in the email should land, when it's used at all. */
function redirectTo(){
  return String(location.protocol).indexOf("http") === 0
    ? location.origin + location.pathname
    : "";
}

function sendCode(email){
  var back = redirectTo();
  return api("/auth/v1/otp" + (back ? "?redirect_to=" + encodeURIComponent(back) : ""), {
    method: "POST",
    body: { email: email, create_user: true }
  });
}

/* A first-time address gets a sign-up email and a returning one a sign-in
   email, and older servers want the matching type when the code comes back.
   "email" covers both on current Supabase; the others are the fallback. */
function verifyCode(email, code){
  var types = ["email", "signup", "magiclink"];
  var token = String(code).replace(/\s+/g, "");

  function attempt(i){
    return api("/auth/v1/verify", {
      method: "POST",
      body: { type: types[i], email: email, token: token }
    }).catch(function(err){
      if(i + 1 < types.length && (err.status === 400 || err.status === 401 || err.status === 403)){
        return attempt(i + 1).catch(function(){ throw err; });   /* report the first failure */
      }
      throw err;
    });
  }

  /* Resolves once the first sync after signing in has finished, with how
     it went ("created", "pulled", "choose"…) — so the app can say what just
     happened rather than guess. */
  return attempt(0).then(function(body){
    adopt(body);
    setStatus("idle");
    return syncNow("sign-in");
  });
}

/* A magic link opened in the same browser lands here with the session in the
   address. Take it, then get it out of the address bar straight away. */
function takeLinkFromUrl(){
  var hash = String(location.hash || "");
  if(hash.indexOf("access_token=") < 0 && hash.indexOf("error=") < 0) return false;

  var p = {};
  hash.slice(1).split("&").forEach(function(kv){
    var i = kv.indexOf("=");
    if(i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
  });

  try{ history.replaceState(null, "", location.pathname + location.search); }catch(err){ /* file:// */ }

  if(p.error){
    setStatus("signed-out", p.error_description || p.error);
    return false;
  }

  adopt({
    access_token: p.access_token,
    refresh_token: p.refresh_token,
    expires_at: Number(p.expires_at) || 0,
    expires_in: Number(p.expires_in) || 3600
  });
  setStatus("idle");
  return true;
}

/* The session goes; this device's bookkeeping stays. Sign back in to the
   same account and it simply carries on — changes made while signed out
   push, and nothing asks "which copy?" about two copies that are the same.
   Signing in to a DIFFERENT account resets it (see adopt). */
function signOut(){
  var old = session;
  session = null;
  writeJSON(AUTH_KEY, null);
  pendingChoice = null;
  clearTimeout(pushTimer);
  setStatus("signed-out");

  if(old){
    api("/auth/v1/logout", {
      method: "POST",
      headers: { Authorization: "Bearer " + old.access_token }
    }).catch(function(){ /* the local sign-out already happened */ });
  }
}

/* The server said the session is gone for good (a revoked or reused refresh
   token). Keep the data, drop the session, say so. */
function lostSession(){
  session = null;
  writeJSON(AUTH_KEY, null);
  setStatus("signed-out", "Signed out — sign in again to keep syncing.");
  if(hooks.signedOut) hooks.signedOut();
  var err = new Error("signed out");
  err.signedOut = true;
  return err;
}

/* --------------------------------------------------------------------------
   Keeping the session fresh

   Access tokens last about an hour. A refresh token swaps for a new pair —
   and the old refresh token stops working, so the new one must be saved
   every time.
   -------------------------------------------------------------------------- */

var refreshing = null;

function refresh(){
  if(!session) return Promise.reject(lostSession());
  if(refreshing) return refreshing;

  refreshing = api("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: session.refresh_token }
  }).then(function(body){
    if(!body.user) body.user = session.user;
    adopt(body);
    refreshing = null;
    return session;
  }, function(err){
    refreshing = null;
    /* 400/401 is the server saying no. A network failure is not — the
       session may be perfectly good, we just can't reach anyone. */
    if(err.status === 400 || err.status === 401) throw lostSession();
    throw err;
  });

  return refreshing;
}

function fresh(){
  if(!session) return Promise.reject(lostSession());
  if(session.expires_at - Date.now() > 60000) return Promise.resolve(session);
  return refresh();
}

/* A signed-in request, refreshing first if the token's nearly up, and once
   more if the server says it's expired anyway (clocks disagree). */
function authed(path, opts){
  return fresh().then(function(){
    return api(path, withAuth(opts));
  }).catch(function(err){
    if(err.status === 401 && session){
      return refresh().then(function(){ return api(path, withAuth(opts)); });
    }
    throw err;
  });
}

function withAuth(opts){
  var o = {};
  Object.keys(opts || {}).forEach(function(k){ o[k] = opts[k]; });
  o.auth = true;
  return o;
}

/* --------------------------------------------------------------------------
   The row
   -------------------------------------------------------------------------- */

function rowsPath(extra){
  return "/rest/v1/" + config.table + "?user_id=eq." + encodeURIComponent(session.user.id) + (extra || "");
}

/* Most checks only need to know whether the account moved, so they ask for
   the rev and nothing else. The document itself — which grows with every
   session — is only fetched when there's actually something to take. */
function readRow(full){
  return authed(rowsPath("&select=rev,updated_at,device" + (full ? ",data" : ""))).then(function(rows){
    return (rows && rows[0]) || null;
  });
}

function deviceName(){
  var ua = navigator.userAgent || "";
  if(/iPhone/.test(ua)) return "iPhone";
  if(/iPad/.test(ua)) return "iPad";
  if(/Android/.test(ua)) return "Android phone";
  if(/Macintosh/.test(ua)) return "Mac";
  if(/Windows/.test(ua)) return "Windows PC";
  if(/Linux|CrOS/.test(ua)) return "computer";
  return "another device";
}

function insertRow(){
  return authed("/rest/v1/" + config.table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { user_id: session.user.id, data: store.state, device: deviceName() }
  }).then(function(rows){ return rows[0]; });
}

/* Only lands if the account is still at `fromRev`. The server bumps rev
   itself (see the trigger in schema.sql), so the answer tells us the new one.
   An empty answer means someone else wrote first. */
function updateRow(fromRev){
  return authed(rowsPath("&rev=eq." + fromRev), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: { data: store.state, device: deviceName() }
  }).then(function(rows){ return (rows && rows[0]) || null; });
}

/* --------------------------------------------------------------------------
   What a copy holds — for the "which do you keep?" question
   -------------------------------------------------------------------------- */

function summarize(s){
  s = s || {};
  var history = s.history || [];
  var sessions = history.filter(function(h){ return h.kind !== "skip"; });
  return {
    sessions: sessions.length,
    weighIns: (s.body || []).length,
    foodDays: s.nutrition && s.nutrition.days ? Object.keys(s.nutrition.days).length : 0,
    custom: (s.custom || []).length,
    last: sessions.length ? sessions[sessions.length - 1].at : 0
  };
}

function hasTraining(s){
  var n = summarize(s);
  return !!(n.sessions || n.weighIns || n.foodDays || n.custom || (s && s.history && s.history.length));
}

/* The same data written the same way, whatever order its keys are in.
   Postgres stores JSON with its keys re-sorted, so comparing text straight
   would call two identical copies different. */
function canon(v){
  if(v === null || typeof v !== "object") return JSON.stringify(v);
  if(Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().filter(function(k){ return v[k] !== undefined; })
    .map(function(k){ return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
}

function sameData(a, b){ return canon(a) === canon(b); }

/* --------------------------------------------------------------------------
   Taking the account's copy

   Snapshotted first, always: if the other device had just been reset by
   mistake, this is what gets it back. store.restore() runs the same checks
   and migrations as loading a backup, so a copy from an older version of the
   app on another device still comes in cleanly.
   -------------------------------------------------------------------------- */

var applying = false;

function takeRemote(row, reason, always){
  var snap = IL.vault ? IL.vault.snapshot(store.toBackup(), reason, always) : Promise.resolve();

  return snap.then(null, function(){}).then(function(){
    applying = true;
    try{
      store.restore(JSON.stringify(row.data));
    }catch(err){
      throw internal("The account's copy isn't a readable save, so it was left alone.");
    }finally{
      applying = false;
    }
    saveMeta({ rev: row.rev, dirty: false, lastSync: Date.now(), lastDevice: row.device || "" });
    if(hooks.applied) hooks.applied(row);
  });
}

/* Sending ours. If more changes land while it's in flight, stay dirty so
   they go on the next push rather than being marked as sent. */
function sendLocal(fromRev){
  var seqAtSend = meta.seq;
  return updateRow(fromRev).then(function(row){
    if(!row) return null;
    saveMeta({ rev: row.rev, dirty: meta.seq !== seqAtSend, lastSync: Date.now() });
    return row;
  });
}

/* --------------------------------------------------------------------------
   One pass of sync
   -------------------------------------------------------------------------- */

var pendingChoice = null;

function pass(depth){
  if(depth > 3){
    return Promise.reject(internal("Sync kept colliding with another device. Try again in a moment."));
  }

  return readRow(false).then(function(head){

    /* Nothing on the account yet: this device's data becomes the account's. */
    if(!head){
      var seqAtSend = meta.seq;
      return insertRow().then(function(made){
        saveMeta({ rev: made.rev, dirty: meta.seq !== seqAtSend, lastSync: Date.now() });
        return "created";
      }, function(err){
        /* Another device created it a moment ago — go round again. */
        if(err.status === 409) return pass(depth + 1);
        throw err;
      });
    }

    /* The account hasn't moved since we last spoke — no need for its data. */
    if(meta.rev && head.rev === meta.rev){
      if(!meta.dirty){
        saveMeta({ lastSync: Date.now() });
        return "unchanged";
      }
      return sendLocal(head.rev).then(function(sent){
        return sent ? "pushed" : pass(depth + 1);
      });
    }

    /* Everything else needs to see what the account holds. */
    return readRow(true).then(function(row){
      if(!row) return pass(depth + 1);                /* gone between the two reads */

      /* This device has never synced with this account. */
      if(!meta.rev) return firstLink(row, depth);

      /* The account moved. If we didn't, take it. */
      if(!meta.dirty){
        return takeRemote(row, "before taking changes from " + (row.device || "another device"))
          .then(function(){ return "pulled"; });
      }

      return bothChanged(row, depth);
    });
  });
}

/* Both sides changed since they last agreed. The newer copy wins — this
   device's last edit against the time the server took the account's — and
   the loser is kept as a snapshot here either way. */
function bothChanged(row, depth){
  var theirs = Date.parse(row.updated_at) || 0;

  if(theirs > meta.edited){
    return takeRemote(row, "this device's copy — replaced by a newer one from " +
                           (row.device || "another device"), true)
      .then(function(){
        if(hooks.conflict) hooks.conflict({ kept: "remote", device: row.device });
        return "conflict-remote";
      });
  }

  var keep = IL.vault
    ? IL.vault.snapshot(JSON.stringify(row.data), "account copy from " +
        (row.device || "another device") + " — replaced by this device's newer one", true)
    : Promise.resolve();

  return keep.then(null, function(){}).then(function(){
    return sendLocal(row.rev);
  }).then(function(sent){
    if(!sent) return pass(depth + 1);
    if(hooks.conflict) hooks.conflict({ kept: "local", device: row.device });
    return "conflict-local";
  });
}

/* The first time this device meets this account. If only one side has any
   training in it, that side wins without a question. If both do, silently
   choosing would risk throwing months away — so it asks. */
function firstLink(row, depth){
  var mine = hasTraining(store.state);
  var theirs = hasTraining(row.data);

  /* Already the same data — nothing to decide, just start tracking. */
  if(sameData(store.state, row.data)){
    saveMeta({ rev: row.rev, dirty: false, lastSync: Date.now(), lastDevice: row.device || "" });
    return Promise.resolve("unchanged");
  }

  if(!mine){
    return takeRemote(row, "before first sync").then(function(){ return "pulled"; });
  }
  if(!theirs){
    return sendLocal(row.rev).then(function(sent){
      return sent ? "pushed" : pass(depth + 1);
    });
  }

  pendingChoice = {
    row: row,
    local: summarize(store.state),
    remote: summarize(row.data),
    remoteDevice: row.device || ""
  };
  setStatus("choose");
  if(hooks.choose) hooks.choose(pendingChoice);
  return Promise.resolve("choose");
}

/* The answer to "which do you keep?". The one not kept goes into a snapshot
   on this device, so either answer can be undone. */
function resolveChoice(keep){
  var c = pendingChoice;
  if(!c) return Promise.resolve("nothing");
  pendingChoice = null;
  setStatus("syncing");

  var work;
  if(keep === "remote"){
    work = takeRemote(c.row, "this device's data — replaced by the account's on first sync", true)
      .then(function(){ return "pulled"; });
  }else{
    var snap = IL.vault
      ? IL.vault.snapshot(JSON.stringify(c.row.data), "account data from " +
          (c.remoteDevice || "another device") + " — replaced by this device's on first sync", true)
      : Promise.resolve();
    work = snap.then(null, function(){}).then(function(){ return sendLocal(c.row.rev); })
      .then(function(sent){
        /* The account moved while you were deciding: ask again about the new one. */
        return sent ? "pushed" : pass(0);
      });
  }

  return work.then(function(result){
    if(result !== "choose") setStatus("idle");
    return result;
  }, function(err){
    setStatus("error", explain(err));
    return "error";
  });
}

/* --------------------------------------------------------------------------
   When to sync

   One pass at a time. Asking again while one's running queues exactly one
   more pass for after — enough to catch whatever changed in the meantime.
   -------------------------------------------------------------------------- */

var running = null;
var again = false;
var lastCheck = 0;
var pushTimer = null;

function syncNow(reason){
  if(!session) return Promise.resolve("signed-out");
  if(pendingChoice) return Promise.resolve("choose");
  if(typeof navigator.onLine === "boolean" && !navigator.onLine){
    setStatus("offline");
    return Promise.resolve("offline");
  }
  if(running){
    again = true;
    return running;
  }

  clearTimeout(pushTimer);
  lastCheck = Date.now();
  setStatus("syncing");

  running = pass(0).then(function(result){
    if(result !== "choose") setStatus("idle");
    return result;
  }, function(err){
    if(err && err.signedOut){
      /* lostSession() already set the status */
    }else if(err instanceof TypeError || err.status === undefined){
      setStatus("offline", explain(err));
    }else{
      setStatus("error", explain(err));
    }
    return "error";
  }).then(function(result){
    running = null;
    if(again){
      again = false;
      return syncNow("again");
    }
    return result;
  });

  return running;
}

/* Every save lands here. Mark this device as ahead of the account and push
   a moment later — long enough that logging three sets in a row is one push,
   not three. */
function noteLocalChange(){
  if(applying) return;
  saveMeta({ dirty: true, edited: Date.now(), seq: meta.seq + 1 });
  if(!session) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(function(){ syncNow("change"); }, config.pushDelay);
}

store.onSaved = noteLocalChange;

function init(){
  takeLinkFromUrl();

  if(typeof window.addEventListener === "function"){
    window.addEventListener("online", function(){ syncNow("online"); });
    window.addEventListener("offline", function(){ if(session) setStatus("offline"); });
  }

  if(typeof document !== "undefined" && document.addEventListener){
    document.addEventListener("visibilitychange", function(){
      if(!session) return;
      if(document.hidden){
        /* Leaving: send anything waiting now, in case the next thing you
           pick up is the other device. */
        if(meta.dirty) syncNow("leave");
        return;
      }
      if(Date.now() - lastCheck > config.checkEvery) syncNow("focus");
    });
  }

  if(session) syncNow("open");
}

function info(){
  return {
    signedIn: !!session,
    email: session && session.user ? session.user.email : "",
    status: status.state,
    message: status.message,
    lastSync: meta.lastSync,
    dirty: meta.dirty,
    lastDevice: meta.lastDevice,
    choosing: !!pendingChoice
  };
}

IL.sync = {
  config: config,
  hooks: hooks,
  init: init,
  info: info,
  onChange: onChange,
  explain: explain,
  sendCode: sendCode,
  verifyCode: verifyCode,
  signOut: signOut,
  syncNow: syncNow,
  resolveChoice: resolveChoice,
  pendingChoice: function(){ return pendingChoice; },
  summarize: summarize,
  sameData: sameData,
  deviceName: deviceName,
  /* For the tests: this device's bookkeeping and session, read-only. */
  debug: function(){ return { meta: meta, session: session }; }
};

})(window.IL);
