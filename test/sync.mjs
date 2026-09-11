/* ==========================================================================
   test/sync.mjs — several devices, one account, a fake Supabase between them.

     node test/sync.mjs

   Each device is its own copy of the app in its own V8 context with its own
   storage, exactly as a phone and a laptop would be. They share one
   FakeSupabase (test/fake-supabase.js), which speaks the same HTTP as the
   real thing and enforces the same rules as supabase/schema.sql.

   Snapshots are recorded rather than written to IndexedDB (Node has none),
   which is also what lets these tests check that nothing is ever dropped:
   every copy that loses a conflict must turn up in a snapshot.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = join(import.meta.dirname, "..");
vm.runInThisContext(readFileSync(join(ROOT, "test/fake-supabase.js"), "utf8"));
const FakeSupabase = globalThis.FakeSupabase;

const URL = "https://fhfpcknbivgdsefllloi.supabase.co";
const KEY = "sb_publishable_hG3P3R3JKhwSLa6pPXjayQ_3kGAb8T1";
const EMAIL = "caleb@example.com";

const fake = new FakeSupabase({ url: URL, key: KEY });

const UA = {
  iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"
};

/* One device: a full copy of the app's logic with its own storage. */
function device(ua, opts = {}) {
  const mem = {};
  const on = {};
  const sandbox = {
    window: { addEventListener: (t, fn) => (on["window:" + t] ||= []).push(fn) },
    document: { hidden: false, addEventListener: (t, fn) => (on["document:" + t] ||= []).push(fn) },
    navigator: { onLine: true, userAgent: ua },
    location: {
      protocol: "https:",
      origin: "https://calebbyrne1.github.io",
      pathname: "/Workout-Plan-Generator-and-Tracker/",
      search: "",
      hash: opts.hash || ""
    },
    history: { replaceState: () => { sandbox.location.hash = ""; } },
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; }
    },
    fetch: (u, i) => fake.fetch(u, i),
    setTimeout, clearTimeout, atob, btoa, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ["js/data.js", "js/vault.js", "js/store.js", "js/plan.js", "js/sync.js"]) {
    vm.runInContext(readFileSync(join(ROOT, f), "utf8"), sandbox, { filename: f });
  }

  const IL = sandbox.window.IL;
  const snaps = [];
  IL.vault.snapshot = (json, reason) => { snaps.push({ reason, json }); return Promise.resolve(snaps.length); };

  const events = { applied: [], choose: [], conflict: [], signedOut: 0 };
  IL.sync.hooks.applied = (row) => events.applied.push(row.device);
  IL.sync.hooks.choose = (c) => events.choose.push(c);
  IL.sync.hooks.conflict = (c) => events.conflict.push(c);
  IL.sync.hooks.signedOut = () => { events.signedOut++; };
  IL.sync.config.pushDelay = 5;

  return {
    IL, store: IL.store, sync: IL.sync, snaps, events, sandbox, mem,
    fire: (key) => (on[key] || []).forEach((fn) => fn()),
    meta: () => IL.sync.debug().meta,
    session: () => IL.sync.debug().session
  };
}

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, extra) {
  if (cond) pass++;
  else {
    fail++;
    const line = label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "");
    failures.push(line);
    console.log("  FAIL " + line);
  }
}
function eq(label, a, b) { ok(label + " = " + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), a); }
function group(name) { console.log("\n" + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyAgo(d, n) {
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  t.setDate(t.getDate() - n);
  return d.store.dayKey(t.getTime());
}

/* Resolves with the result of the sync that signing in kicks off. */
async function signIn(d, email = EMAIL) {
  await d.sync.sendCode(email);
  return d.sync.verifyCode(email, fake.codeFor(email));
}

const requests = (method, path) => fake.requests.filter((r) => r.method === method && (!path || r.path === path)).length;

/* ---------------------------------------------------------------- start */
group("the first device creates the account's copy");
const phone = device(UA.iPhone);
phone.store.addBodyweight(186, keyAgo(phone, 2));
phone.store.setNutrition(keyAgo(phone, 1), { kcal: 2300, protein: 170 });
eq("changes before signing in are marked as unsynced", phone.meta().dirty, true);
eq("and nothing was sent — not signed in", fake.requests.length, 0);

await phone.sync.sendCode(EMAIL);
eq("the code request asks the link to come back to the app", fake.redirects[0],
   "https://calebbyrne1.github.io/Workout-Plan-Generator-and-Tracker/");
let res = await phone.sync.verifyCode(EMAIL, fake.codeFor(EMAIL));
eq("signing in created the account's copy", res, "created");
const uid = fake.userId(EMAIL);
ok("signed in", phone.sync.info().signedIn);
eq("the email came back with the session", phone.sync.info().email, EMAIL);
ok("the account now holds the phone's data", fake.row(uid) && phone.sync.sameData(fake.row(uid).data, phone.store.state));
eq("the server numbered it", fake.row(uid).rev, 1);
eq("and knows which device wrote it", fake.row(uid).device, "iPhone");
eq("the phone is in step", [phone.meta().rev, phone.meta().dirty].join(), "1,false");

group("a second, empty device takes the account's copy without asking");
const laptop = device(UA.windows);
res = await signIn(laptop);
eq("it pulled", res, "pulled");
ok("no question asked — there was nothing here to lose", laptop.events.choose.length === 0);
ok("the laptop now has the phone's weigh-in", laptop.store.state.body.length === 1 && laptop.store.state.body[0].w === 186);
ok("its empty starting state was still snapshotted first", laptop.snaps.some((s) => /before first sync/.test(s.reason)));
eq("taking the copy doesn't count as a change to push back", laptop.meta().dirty, false);

group("changes travel both ways");
laptop.store.addBodyweight(185.2, keyAgo(laptop, 0));
res = await laptop.sync.syncNow("test");
eq("the laptop pushed", res, "pushed");
eq("the account moved to rev 2", fake.row(uid).rev, 2);

const patchesBefore = requests("PATCH");
res = await phone.sync.syncNow("test");
eq("the phone pulled", res, "pulled");
ok("and has the laptop's weigh-in", phone.store.state.body.some((b) => b.w === 185.2));
eq("the app is told who it came from", phone.events.applied.slice(-1)[0], "Windows PC");
eq("pulling sent nothing back", requests("PATCH"), patchesBefore);

res = await phone.sync.syncNow("test");
eq("nothing changed, nothing to do", res, "unchanged");
const lastGet = fake.requests.filter((r) => r.method === "GET").slice(-1)[0];
ok("and the check didn't download the whole save", !/data/.test(lastGet.query.select), lastGet.query.select);

group("a burst of edits is one push");
const beforeBurst = requests("PATCH");
phone.store.setNutrition(keyAgo(phone, 0), { kcal: 1500 });
phone.store.setNutrition(keyAgo(phone, 0), { kcal: 1800 });
phone.store.setNutrition(keyAgo(phone, 0), { kcal: 2100 });
await sleep(60);
await phone.sync.syncNow("test");
eq("three saves, one push", requests("PATCH") - beforeBurst, 1);
eq("carrying the last value", fake.row(uid).data.nutrition.days[keyAgo(phone, 0)].kcal, 2100);

group("offline changes wait, then go");
await laptop.sync.syncNow("test");
phone.sandbox.navigator.onLine = false;
phone.store.addBodyweight(184.6, keyAgo(phone, 3));
res = await phone.sync.syncNow("test");
eq("offline is reported, not treated as an error", res, "offline");
eq("the phone knows it's behind", phone.meta().dirty, true);
ok("the account doesn't have it yet", !fake.row(uid).data.body.some((b) => b.w === 184.6));
phone.sandbox.navigator.onLine = true;
phone.fire("window:online");
await phone.sync.syncNow("test");
ok("back online, it went up", fake.row(uid).data.body.some((b) => b.w === 184.6));
eq("and the phone is in step", phone.meta().dirty, false);

group("leaving the app sends what's waiting");
await laptop.sync.syncNow("test");
phone.sync.config.pushDelay = 60000;             /* only the leave can push it */
phone.store.addBodyweight(184.1, keyAgo(phone, 4));
phone.sandbox.document.hidden = true;
phone.fire("document:visibilitychange");
await phone.sync.syncNow("test");
ok("switching away pushed it", fake.row(uid).data.body.some((b) => b.w === 184.1));
phone.sandbox.document.hidden = false;
phone.sync.config.pushDelay = 5;

group("an edit made mid-push is not marked as sent");
await laptop.sync.syncNow("test");
laptop.sync.config.pushDelay = 60000;
laptop.store.addBodyweight(183.9, keyAgo(laptop, 5));
laptop.sandbox.fetch = (u, i) => {
  if (i && i.method === "PATCH") {
    laptop.sandbox.fetch = (uu, ii) => fake.fetch(uu, ii);
    laptop.store.addBodyweight(183.7, keyAgo(laptop, 6));      /* lands while the push is out */
  }
  return fake.fetch(u, i);
};
await laptop.sync.syncNow("test");
eq("still dirty after the push that missed it", laptop.meta().dirty, true);
await laptop.sync.syncNow("test");
ok("and it goes on the next one", fake.row(uid).data.body.some((b) => b.w === 183.7));
laptop.sync.config.pushDelay = 5;

/* ------------------------------------------------------------ conflicts */
group("both changed: the newer copy wins, the older is kept");
await phone.sync.syncNow("test");
await laptop.sync.syncNow("test");

laptop.sync.config.pushDelay = 60000;
laptop.store.setNutrition(keyAgo(laptop, 8), { kcal: 1111 });        /* laptop edits first... */
await sleep(15);
phone.store.setNutrition(keyAgo(phone, 9), { kcal: 2222 });          /* ...then the phone, and it syncs */
await phone.sync.syncNow("test");
res = await laptop.sync.syncNow("test");
eq("the laptop took the phone's newer copy", res, "conflict-remote");
ok("so it has the phone's edit", !!laptop.store.nutritionOn(keyAgo(laptop, 9)));
const lost = laptop.snaps.filter((s) => /replaced by a newer one/.test(s.reason)).slice(-1)[0];
ok("and its own older copy is in a snapshot, edit and all",
   lost && JSON.parse(lost.json).nutrition.days[keyAgo(laptop, 8)].kcal === 1111);
eq("the app is told what happened", laptop.events.conflict.slice(-1)[0].kept, "remote");
laptop.sync.config.pushDelay = 5;

group("both changed: this device newer, so it wins");
phone.sync.config.pushDelay = 60000;
laptop.store.setNutrition(keyAgo(laptop, 10), { kcal: 3000 });
await laptop.sync.syncNow("test");                                    /* account moves */
await sleep(15);
phone.store.setNutrition(keyAgo(phone, 11), { kcal: 1900 });         /* phone edits later */
res = await phone.sync.syncNow("test");
eq("the phone's newer copy went up", res, "conflict-local");
ok("the account has the phone's edit", !!fake.row(uid).data.nutrition.days[keyAgo(phone, 11)]);
const kept = phone.snaps.filter((s) => /account copy from Windows PC/.test(s.reason)).slice(-1)[0];
ok("and the account's older copy is in a snapshot on the phone",
   kept && JSON.parse(kept.json).nutrition.days[keyAgo(phone, 10)].kcal === 3000);
phone.sync.config.pushDelay = 5;

group("two devices pushing at the same moment can't both land");
await laptop.sync.syncNow("test");
await phone.sync.syncNow("test");
const revBefore = fake.row(uid).rev;
phone.sync.config.pushDelay = 60000;
laptop.sync.config.pushDelay = 60000;
phone.store.addBodyweight(180, keyAgo(phone, 12));
await sleep(5);
laptop.store.addBodyweight(181, keyAgo(laptop, 13));
const both = await Promise.all([phone.sync.syncNow("test"), laptop.sync.syncNow("test")]);
ok("one pushed and the other noticed", both.includes("pushed") && both.some((r) => /conflict/.test(r)), both);
ok("the rev only moved as far as the writes that landed", fake.row(uid).rev >= revBefore + 1);
phone.sync.config.pushDelay = 5;
laptop.sync.config.pushDelay = 5;

/* --------------------------------------------------- the first-link question */
group("a device with its own training asks before choosing");
await phone.sync.syncNow("test");
const tablet = device(UA.android);
tablet.store.addBodyweight(170, keyAgo(tablet, 30));
tablet.store.setNutrition(keyAgo(tablet, 30), { kcal: 1700 });
res = await signIn(tablet);
eq("it stops and asks", res, "choose");
eq("the app is asked", tablet.events.choose.length, 1);
eq("with what each side holds", [tablet.events.choose[0].local.weighIns, tablet.events.choose[0].remote.weighIns > 1].join(), "1,true");
eq("and nothing is pushed while it waits", await tablet.sync.syncNow("test"), "choose");
ok("the account is untouched", !fake.row(uid).data.body.some((b) => b.w === 170));

res = await tablet.sync.resolveChoice("remote");
eq("choosing the account's copy pulls it", res, "pulled");
ok("the tablet now has the account's data", tablet.store.state.body.some((b) => b.w === 186));
ok("and its own data is in a snapshot", tablet.snaps.some((s) => /replaced by the account's on first sync/.test(s.reason) &&
   JSON.parse(s.json).body.some((b) => b.w === 170)));

group("…or keeps its own, and the account's goes into a snapshot");
const desk = device(UA.windows);
desk.store.addBodyweight(199, keyAgo(desk, 40));
res = await signIn(desk);
eq("asks", res, "choose");
res = await desk.sync.resolveChoice("local");
eq("keeping this device's pushes it", res, "pushed");
ok("the account now holds the desk's data", fake.row(uid).data.body.some((b) => b.w === 199));
ok("with the account's old copy kept on the desk", desk.snaps.some((s) => /replaced by this device's on first sync/.test(s.reason)));
res = await phone.sync.syncNow("test");
eq("the phone follows", res, "pulled");
ok("the phone snapshotted before taking it", phone.snaps.some((s) => /before taking changes from Windows PC/.test(s.reason)));

group("identical copies never ask");
await desk.sync.syncNow("test");
const twin = device(UA.windows);
twin.store.restore(desk.store.toBackup());
res = await signIn(twin);
eq("the same data on both sides just links up", res, "unchanged");
eq("no question", twin.events.choose.length, 0);

/* --------------------------------------------------------------- sessions */
group("sessions: an expired token is refreshed and the request retried");
await phone.sync.syncNow("test");
const oldRefresh = phone.session().refresh_token;
fake.expireAll();
phone.store.addBodyweight(178, keyAgo(phone, 14));
res = await phone.sync.syncNow("test");
eq("the sync still went through", res, "pushed");
ok("after a refresh", requests("POST", "/auth/v1/token") >= 1);
ok("with the rotated refresh token saved", phone.session().refresh_token !== oldRefresh);

phone.session().expires_at = 0;                  /* the phone knows it's stale */
const refreshesBefore = requests("POST", "/auth/v1/token");
res = await phone.sync.syncNow("test");
eq("refreshed before asking, not after failing", requests("POST", "/auth/v1/token") - refreshesBefore, 1);

group("sessions: a revoked session signs out, and keeps the data");
fake.revoke();
const weighIns = phone.store.state.body.length;
res = await phone.sync.syncNow("test");
eq("reported", res, "error");
eq("signed out", phone.sync.info().signedIn, false);
eq("with a reason", phone.sync.info().message, "Signed out — sign in again to keep syncing.");
eq("the app was told", phone.events.signedOut, 1);
eq("every weigh-in still here", phone.store.state.body.length, weighIns);

phone.store.addBodyweight(177, keyAgo(phone, 15));
res = await signIn(phone);
ok("signing back in to the same account just carries on", res === "pushed" || res === "conflict-local", res);
ok("without asking which copy", phone.events.choose.length === 0);
ok("and the change made while signed out went up", fake.row(uid).data.body.some((b) => b.w === 177));

group("sessions: signing out keeps the data; back in, no questions");
phone.sync.signOut();
eq("signed out", phone.sync.info().signedIn, false);
ok("data kept", phone.store.state.body.length > 0);
res = await signIn(phone);
ok("carries on", res === "unchanged" || res === "pushed", res);
ok("no question", phone.events.choose.length === 0);

group("sessions: a different account on the same device starts fresh");
phone.sync.signOut();
res = await signIn(phone, "other@example.com");
const uid2 = fake.userId("other@example.com");
eq("the new account gets this device's data as its first copy", res, "created");
ok("in its own row", fake.row(uid2) && fake.row(uid2).rev === 1);
ok("and the first account's row is untouched", fake.row(uid).user_id === uid);
phone.sync.signOut();
await signIn(phone);

/* ----------------------------------------------------------- sign-in paths */
group("sign-in: codes, links, and what goes wrong");
const fresh = device(UA.windows);
await fresh.sync.sendCode("third@example.com");
let err = null;
try { await fresh.sync.verifyCode("third@example.com", "000000"); } catch (e) { err = e; }
ok("a wrong code is refused", !!err);
eq("in plain words", fresh.sync.explain(err), "That code didn't work — it may have expired. Send a new one.");
eq("not signed in", fresh.sync.info().signedIn, false);

fake.acceptTypes = ["signup"];
await fresh.sync.sendCode("third@example.com");
await fresh.sync.verifyCode("third@example.com", " " + fake.codeFor("third@example.com").replace(/(\d{3})/, "$1 ") + " ");
ok("an older server wanting a different type still signs in, spaces and all", fresh.sync.info().signedIn);
fake.acceptTypes = ["email", "signup", "magiclink"];

fake.rateLimited = true;
err = null;
try { await fresh.sync.sendCode("fourth@example.com"); } catch (e) { err = e; }
ok("the email limit is explained", /limits how often/.test(fresh.sync.explain(err)), fresh.sync.explain(err));
fake.rateLimited = false;

fake.offline = true;
err = null;
try { await fresh.sync.sendCode("fourth@example.com"); } catch (e) { err = e; }
ok("no connection is explained", /Couldn't reach/.test(fresh.sync.explain(err)), fresh.sync.explain(err));
fake.offline = false;

/* A sign-in link opened in the same browser the app runs in. */
fake.users["link@example.com"] = { id: "user-link", email: "link@example.com" };
const s = fake._session(fake.users["link@example.com"]);
const hash = "#access_token=" + s.access_token + "&expires_at=" + s.expires_at +
             "&expires_in=3600&refresh_token=" + s.refresh_token + "&token_type=bearer&type=magiclink";
const linked = device(UA.windows, { hash });
linked.sync.init();
await linked.sync.syncNow("test");
ok("a link in the address bar signs you in", linked.sync.info().signedIn);
eq("reading who you are from the token", linked.sync.info().email, "link@example.com");
eq("and the token is scrubbed from the address", linked.sandbox.location.hash, "");

const bad = device(UA.windows, { hash: "#error=access_denied&error_description=Email+link+is+invalid+or+has+expired" });
bad.sync.init();
eq("an expired link says so", bad.sync.info().message, "Email link is invalid or has expired");
eq("and leaves you signed out", bad.sync.info().signedIn, false);

/* --------------------------------------------------------------- failures */
group("failures: the server's side isn't set up");
fake.noTable = true;
phone.store.addBodyweight(176, keyAgo(phone, 16));
res = await phone.sync.syncNow("test");
eq("reported", res, "error");
ok("pointing at the fix", /schema\.sql/.test(phone.sync.info().message), phone.sync.info().message);
eq("the change is still waiting", phone.meta().dirty, true);
fake.noTable = false;
await phone.sync.syncNow("test");
eq("and goes once it's fixed", phone.meta().dirty, false);

group("failures: an unreadable copy on the account is left alone");
const before = JSON.stringify(phone.store.state);
fake.writeAs(uid, { not: "a save" }, "a broken device");
res = await phone.sync.syncNow("test");
eq("reported", res, "error");
ok("saying why", /isn't a readable save/.test(phone.sync.info().message), phone.sync.info().message);
eq("and this device's data is untouched", JSON.stringify(phone.store.state), before);

/* ------------------------------------------------------------------- done */
console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) {
  console.log("\nfailures:\n  " + failures.join("\n  "));
  process.exit(1);
}
