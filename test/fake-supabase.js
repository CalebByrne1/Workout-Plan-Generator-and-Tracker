/* ==========================================================================
   test/fake-supabase.js — a stand-in Supabase, for the sync tests.

   Implements exactly the slice of Supabase that js/sync.js uses, with the
   same shapes on the wire:

     POST  /auth/v1/otp        send a sign-in code (recorded, not emailed)
     POST  /auth/v1/verify     trade the code for a session
     POST  /auth/v1/token      refresh — rotating, one-time refresh tokens
     POST  /auth/v1/logout
     GET   /rest/v1/ledgers    PostgREST read, with row-level security
     POST  /rest/v1/ledgers    insert; 409 if the row exists
     PATCH /rest/v1/ledgers    update, honouring the rev=eq.N filter

   and the server-side rules from supabase/schema.sql: rows visible only to
   their owner, rev bumped by the server, updated_at stamped by the server.

   Plain script so the same file runs in Node (test/sync.mjs) and in the
   browser (test/harness.js). Knobs for the unhappy paths: offline,
   rateLimited, noTable, expireAll(), revoke().
   ========================================================================== */

(function(root){
"use strict";

function FakeSupabase(opts){
  opts = opts || {};
  this.url = opts.url;
  this.key = opts.key;
  this.accessTTL = opts.accessTTL || 3600;
  this.acceptTypes = opts.acceptTypes || ["email", "signup", "magiclink"];

  this.users = {};          /* email -> { id, email } */
  this.codes = {};          /* email -> current code */
  this.access = {};         /* access token -> { uid, exp } */
  this.refresh = {};        /* refresh token -> uid, one use each */
  this.rows = {};           /* uid -> row */
  this.requests = [];

  this.offline = false;
  this.rateLimited = false;
  this.noTable = false;
  this.redirects = [];

  this._n = 0;
}

var P = FakeSupabase.prototype;

P._id = function(prefix){ this._n++; return prefix + this._n; };

function b64url(s){
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* A token shaped like a real JWT, so the app's claims() decoder is tested on
   the real format. The signature is a label; the fake checks tokens by
   looking them up, which is all a test needs. */
P._jwt = function(user){
  var head = b64url(JSON.stringify({ alg:"HS256", typ:"JWT" }));
  var body = b64url(JSON.stringify({ sub:user.id, email:user.email, n:this._id("") }));
  return head + "." + body + ".fake";
};

P._session = function(user){
  var access = this._jwt(user);
  var refresh = this._id("rt-");
  var exp = Math.floor(Date.now() / 1000) + this.accessTTL;
  this.access[access] = { uid:user.id, exp:exp * 1000 };
  this.refresh[refresh] = user.id;
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: this.accessTTL,
    expires_at: exp,
    refresh_token: refresh,
    user: { id:user.id, email:user.email }
  };
};

/* Test helpers ------------------------------------------------------------ */

P.codeFor = function(email){ return this.codes[email]; };

/* Every access token expires at once — the "phone was asleep all night" case. */
P.expireAll = function(){
  var self = this;
  Object.keys(this.access).forEach(function(t){ self.access[t].exp = 0; });
};

/* Every refresh token stops working — a revoked session. */
P.revoke = function(){ this.refresh = {}; this.expireAll(); };

P.row = function(uid){ return this.rows[uid] || null; };

/* Write a row as though another device had, without going through HTTP. */
P.writeAs = function(uid, data, device){
  var old = this.rows[uid];
  this.rows[uid] = {
    user_id: uid,
    data: JSON.parse(JSON.stringify(data)),
    rev: old ? old.rev + 1 : 1,
    device: device || "another device",
    updated_at: new Date().toISOString()
  };
  return this.rows[uid];
};

P.userId = function(email){ return this.users[email] && this.users[email].id; };

/* The wire ----------------------------------------------------------------- */

function respond(status, body){
  var text = body === undefined ? "" : JSON.stringify(body);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    text: function(){ return Promise.resolve(text); },
    headers: { get: function(){ return null; } }
  });
}

function parseQuery(q){
  var out = {};
  (q || "").split("&").forEach(function(kv){
    if(!kv) return;
    var i = kv.indexOf("=");
    out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
  });
  return out;
}

/* Postgres hands JSON back with its keys in a different order from the one
   they went in with. Doing the same here keeps the app honest about it. */
function reorder(v){
  if(v === null || typeof v !== "object") return v;
  if(Array.isArray(v)) return v.map(reorder);
  var out = {};
  Object.keys(v).sort().reverse().forEach(function(k){ out[k] = reorder(v[k]); });
  return out;
}

P.fetch = function(url, init){
  init = init || {};
  var self = this;
  var method = (init.method || "GET").toUpperCase();
  var headers = {};
  Object.keys(init.headers || {}).forEach(function(k){ headers[k.toLowerCase()] = init.headers[k]; });
  var body = init.body ? JSON.parse(init.body) : null;

  url = String(url);
  var rest = url.slice(this.url.length);
  var q = rest.indexOf("?");
  var path = q < 0 ? rest : rest.slice(0, q);
  var query = parseQuery(q < 0 ? "" : rest.slice(q + 1));

  this.requests.push({ method:method, path:path, query:query, body:body });

  if(this.offline) return Promise.reject(new TypeError("Failed to fetch"));
  if(url.indexOf(this.url) !== 0) return respond(404, { message:"wrong host" });
  if(headers.apikey !== this.key) return respond(401, { message:"Invalid API key" });

  /* ------------------------------------------------------------ auth */

  if(path === "/auth/v1/otp" && method === "POST"){
    if(this.rateLimited) return respond(429, { code:"over_email_send_rate_limit", msg:"email rate limit exceeded" });
    if(!body || !body.email) return respond(400, { msg:"email required" });
    if(query.redirect_to) this.redirects.push(query.redirect_to);
    this.codes[body.email] = String(100000 + Math.floor(Math.random() * 900000));
    return respond(200, {});
  }

  if(path === "/auth/v1/verify" && method === "POST"){
    if(this.acceptTypes.indexOf(body.type) < 0){
      return respond(403, { code:"otp_expired", msg:"Token has expired or is invalid" });
    }
    if(!this.codes[body.email] || this.codes[body.email] !== body.token){
      return respond(403, { code:"otp_expired", msg:"Token has expired or is invalid" });
    }
    delete this.codes[body.email];
    if(!this.users[body.email]) this.users[body.email] = { id:this._id("user-"), email:body.email };
    return respond(200, this._session(this.users[body.email]));
  }

  if(path === "/auth/v1/token" && method === "POST" && query.grant_type === "refresh_token"){
    var uid = this.refresh[body.refresh_token];
    if(!uid) return respond(400, { error:"invalid_grant", error_description:"Invalid Refresh Token: Already Used" });
    delete this.refresh[body.refresh_token];                  /* rotation */
    var who = null;
    Object.keys(this.users).forEach(function(e){ if(self.users[e].id === uid) who = self.users[e]; });
    return respond(200, this._session(who));
  }

  if(path === "/auth/v1/logout" && method === "POST"){
    return respond(204);
  }

  /* ------------------------------------------------------------ rest */

  if(path === "/rest/v1/ledgers"){
    if(this.noTable){
      return respond(404, { code:"PGRST205", message:"Could not find the table 'public.ledgers' in the schema cache" });
    }

    var auth = (headers.authorization || "").replace(/^Bearer\s+/i, "");
    var tok = this.access[auth];
    if(!tok) return respond(401, { code:"PGRST301", message:"JWT invalid" });
    if(tok.exp <= Date.now()) return respond(401, { code:"PGRST301", message:"JWT expired" });
    var me = tok.uid;

    /* Row-level security: you can only ever see your own row. */
    var filterUser = (query.user_id || "").replace(/^eq\./, "");
    var mine = this.rows[me];
    var matches = mine && (!filterUser || filterUser === me) ? [mine] : [];
    if(query.rev) matches = matches.filter(function(r){ return String(r.rev) === query.rev.replace(/^eq\./, ""); });

    var select = query.select ? query.select.split(",") : null;
    function shape(r){
      var out = {};
      Object.keys(r).forEach(function(k){ if(!select || select.indexOf(k) >= 0) out[k] = r[k]; });
      if(out.data) out.data = reorder(out.data);
      return out;
    }

    if(method === "GET"){
      return respond(200, matches.map(shape));
    }

    if(method === "POST"){
      var owner = body.user_id || me;
      if(owner !== me) return respond(403, { code:"42501", message:"new row violates row-level security policy" });
      if(this.rows[me]) return respond(409, { code:"23505", message:"duplicate key value violates unique constraint" });
      this.rows[me] = {
        user_id: me,
        data: JSON.parse(JSON.stringify(body.data)),
        rev: 1,
        device: body.device || null,
        updated_at: new Date().toISOString()
      };
      return respond(201, [shape(this.rows[me])]);
    }

    if(method === "PATCH"){
      if(!matches.length) return respond(200, []);
      var r = matches[0];
      r.data = JSON.parse(JSON.stringify(body.data));
      r.device = body.device || null;
      r.rev += 1;                                   /* the trigger */
      r.updated_at = new Date().toISOString();      /* the trigger */
      return respond(200, [shape(r)]);
    }
  }

  return respond(404, { message:"not implemented in the fake: " + method + " " + path });
};

root.FakeSupabase = FakeSupabase;

})(typeof window !== "undefined" ? window : globalThis);
