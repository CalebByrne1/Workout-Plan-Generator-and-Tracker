/* Offline cache for the app shell.
   Bump CACHE whenever you change any file below, or phones will keep
   serving the old copy. */
var CACHE = "iron-ledger-v8";

var SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./js/data.js",
  "./js/vault.js",
  "./js/store.js",
  "./js/plan.js",
  "./js/sync.js",
  "./js/chart.js",
  "./js/ui.js",
  "./js/app.js",
  "./icon.svg",
  "./manifest.webmanifest"
];

/* Fonts are the only thing from another origin worth keeping offline. */
var FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function(ev){
  ev.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(ev){
  ev.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* Cache first so the gym's dead signal doesn't matter, then fill the cache
   in the background. Google Fonts get cached opportunistically on first hit.

   ONLY the app's own files and its fonts. Everything else — above all the
   sync server — goes straight to the network untouched. Caching an API
   response here would hand the app a stale copy of your account for ever. */
self.addEventListener("fetch", function(ev){
  if(ev.request.method !== "GET") return;

  var url = new URL(ev.request.url);
  var mine = url.origin === self.location.origin;
  if(!mine && FONT_HOSTS.indexOf(url.hostname) < 0) return;

  ev.respondWith(
    caches.match(ev.request).then(function(cached){
      var network = fetch(ev.request).then(function(res){
        if(res && (res.ok || res.type === "opaque")){
          var copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(ev.request, copy); });
        }
        return res;
      }).catch(function(){ return cached; });

      return cached || network;
    })
  );
});
