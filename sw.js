/* Offline cache for the app shell.
   Bump CACHE whenever you change any file below, or phones will keep
   serving the old copy. */
var CACHE = "iron-ledger-v7";

var SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./js/data.js",
  "./js/vault.js",
  "./js/store.js",
  "./js/plan.js",
  "./js/chart.js",
  "./js/ui.js",
  "./js/app.js",
  "./icon.svg",
  "./manifest.webmanifest"
];

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
   in the background. Google Fonts get cached opportunistically on first hit. */
self.addEventListener("fetch", function(ev){
  if(ev.request.method !== "GET") return;

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
