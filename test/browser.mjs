/* ==========================================================================
   test/browser.mjs — the app, driven in a real headless browser.

     node test/browser.mjs

   Serves the repository over http (not file://, so IndexedDB, localStorage
   and the service worker all behave the way they will once it's deployed),
   injects test/harness.js into index.html, and reads the results back over
   the DevTools protocol.

   WHY NOT --dump-dom. That flag needs --virtual-time-budget to wait for
   anything, and virtual time only knows about timers: once the page is
   waiting on IndexedDB with no timer queued, it jumps straight to the end
   and dumps a page that hasn't finished. So this runs in real time and asks
   the page for its results until they appear. Node has a WebSocket client
   built in, so that still needs no dependencies.

   Skips with a zero exit when there is no Chrome or Edge to drive, so this
   can sit in CI without becoming a liability. Point CHROME_PATH at a binary
   to override the search.
   ========================================================================== */

import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(import.meta.dirname, "..");

/* A whole run takes a few seconds; this is only the backstop for a step
   that never settles. */
const TIMEOUT_MS = 90000;

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/microsoft-edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
].filter(Boolean);

const browser = CANDIDATES.find((p) => existsSync(p));

if (!browser) {
  console.log("browser tests skipped — no Chrome or Edge found.");
  console.log("  set CHROME_PATH to run them.");
  process.exit(0);
}

/* ----------------------------------------------------------- the server */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json"
};

const server = createServer((req, res) => {
  let path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/") path = "/index.html";

  /* No traversal outside the repo, and nothing that isn't a plain file. This
     only ever serves a test run, but a server that can read anything is a
     bad habit to leave lying around. */
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }

  let body = readFileSync(file);

  if (path === "/index.html") {
    body = Buffer.from(
      body.toString("utf8").replace("</body>", '<script src="/test/harness.js"></script></body>')
    );
  }

  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(body);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const appUrl = `http://127.0.0.1:${server.address().port}/`;

/* ---------------------------------------------------------- the browser */

/* A throwaway profile, so no service worker or storage survives from one
   run to the next — every run starts as a first visit. */
const profile = mkdtempSync(join(tmpdir(), "iron-ledger-test-"));

const child = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--remote-debugging-port=0",
  "--user-data-dir=" + profile,
  appUrl
], { stdio: "ignore" });

let exited = false;
child.on("exit", () => { exited = true; });

function cleanup() {
  try { child.kill(); } catch { /* already gone */ }
  server.close();
  /* Windows keeps the profile locked for a moment after the process dies. */
  setTimeout(() => {
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }, 500);
}

function fail(message) {
  console.log("browser tests FAILED — " + message);
  cleanup();
  process.exit(1);
}

/* With port 0 the browser picks one and writes it into the profile. */
async function devtoolsPort() {
  const file = join(profile, "DevToolsActivePort");
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (exited) return null;
    if (existsSync(file)) {
      const line = readFileSync(file, "utf8").split("\n")[0].trim();
      if (line) return Number(line);
    }
    await sleep(100);
  }
  return null;
}

const port = await devtoolsPort();
if (!port) fail("the browser never opened a DevTools port" + (exited ? " (it exited)" : ""));

async function pageTarget() {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(appUrl));
      if (page) return page;
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  return null;
}

const target = await pageTarget();
if (!target) fail("the app page never appeared in the browser");

/* ------------------------------------------------ talking to the page */

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
}).catch(() => fail("could not connect to the page"));

let nextId = 1;
const waiting = new Map();

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
});

function evaluate(expression) {
  const id = nextId++;
  ws.send(JSON.stringify({
    id, method: "Runtime.evaluate",
    params: { expression, returnByValue: true }
  }));
  return new Promise((resolve) => {
    waiting.set(id, (msg) => resolve(msg.result && msg.result.result && msg.result.result.value));
  });
}

/* Ask for the results until the harness has written them. */
const started = Date.now();
let report = "";

while (Date.now() - started < TIMEOUT_MS) {
  const text = await evaluate(
    "(document.getElementById('testout') || {}).textContent || ''"
  );
  const found = text && text.match(/@@RESULTS@@([\s\S]*?)@@END@@/);
  if (found) {
    report = found[1].trim();
    break;
  }
  await sleep(250);
}

if (!report) {
  /* Say how far it got, which is the only useful thing when it hangs. */
  const partial = await evaluate("document.title + ' | ' + (document.body ? document.body.innerText.slice(0, 400) : '')");
  ws.close();
  fail("no results after " + (TIMEOUT_MS / 1000) + "s.\n  page said: " + partial);
}

ws.close();
cleanup();

console.log(report);

const tally = report.match(/(\d+) passed, (\d+) failed/);
process.exit(tally && Number(tally[2]) === 0 ? 0 : 1);
