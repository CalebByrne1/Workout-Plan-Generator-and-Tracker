# Iron Ledger

A single-page workout tracker for a four-day upper/lower split. No backend, no
login, no accounts — everything lives in the browser's `localStorage` on the
device you're using.

## Logging a set

A set is not a checkbox. `log[k]` is either `null` or an array of **segments**
— `[{ w, r }, ...]` — because one set can involve more than one weight.

Grinding out 5 at 185, stripping the bar down and getting 3 more at 155 is
still *one set*, and it's stored as `[{w:185,r:5},{w:155,r:3}]`. It counts as
one set toward the day, reports 8 total reps, and its volume is exact.

In the app:

- **Tap an empty set** → logged at the working weight and the top of the rep
  target, and the rest timer starts. One tap; this is the common case.
- **Tap a logged set** → the set logger opens. Correct the reps, change the
  weight for that set alone, or **+ Add a drop** for another weight inside the
  same set. Sets with drops show a ▾ on the button.
- **Clear this set** in the logger unlogs it.

Editing the working weight in the exercise editor changes the starting point
for *future* sets only. Sets you already logged keep the weight you actually
used.

Number fields start **empty**, not at `0`, with the zero shown as a
placeholder. Tap and type; there is nothing to delete first.

## Dates and days off

Every finished session is stamped with the day you finished it, and the Log
shows that date on the card. Open a card and there's a **Date** field —
change it if you logged the workout the morning after, or if you're catching
up on one you did earlier. The time of day is kept; only the date moves.

**+ Mark a missed or rest day** at the top of the Log records a day you
didn't train:

- **Missed** — one you owe.
- **Rest day** — one that was the plan.

Neither advances the rotation. The workout you skipped is still the next one
up, which is what you'd actually do at the gym. A day with a logged session
on it never counts as a day off, even if you marked it before training after
all.

## Progress

The third tab turns the log into four things worth looking at.

- **Strength trend** — an estimated one-rep max (Epley, from your best set
  that day) for whichever movement you pick. For pull-ups and dips your
  bodyweight at the time is added in, because a chin-up at 150lb and the same
  rep at 190lb are not the same lift. Anything you've never logged with a
  load charts your best set's *reps* instead, where that IS the progress.
- **× body** — the same trend divided by what you weighed that week. It only
  rises when you get stronger faster than you get heavier, which is the
  question a changing bodyweight makes impossible to answer from load alone.
  Log a weigh-in or two and the toggle appears.
- **Bodyweight** — one reading per day, entered from **Log weight**.
- **Volume per session** and a **consistency grid** of the last ten weeks:
  amber for a day you trained (darker with more volume), a grey ring for a
  rest day, a red one for a missed day.

Tap or drag across any chart to read off a specific day.

## Files

```
index.html            markup only
style.css             all styling; the colour tokens are at the top
js/data.js            THE PROGRAM — exercise library and the four day templates
js/store.js           state shape, localStorage, and the domain logic
js/chart.js           the SVG charts on the Progress tab; no library
js/ui.js              everything that produces markup
js/app.js             event wiring, rest timer, boot
manifest.webmanifest  makes it installable as a home-screen app
sw.js                 offline cache, so a dead gym signal doesn't matter
icon.svg              app icon
build.mjs             optional: bundles everything into one file (see below)
```

The scripts are plain `<script>` tags rather than ES modules, so the app also
runs when you double-click `index.html`. Modules would require a web server.
Each file hangs itself off a shared `window.IL` namespace and they must load in
the order `index.html` lists them.

## Running it locally

Double-click `index.html`. That's it.

The service worker is skipped on `file://`, so offline mode won't engage — that
only matters once it's hosted.

## Changing the program

Edit `js/data.js`. The exercise library is `[group, name, type, sets, reps]`,
and `TEMPLATES` is the four days.

**These only affect a fresh start.** Once the app has saved a plan, it uses the
saved one. To pick up your edits, hit **Reset** at the bottom of the Log tab —
which also wipes your history, so do it before you have anything worth keeping.
Day-to-day changes are meant to happen in the app itself (Edit → swap, add,
remove, reorder), not in this file.

## Putting it on your phone

### GitHub Pages — yes, this is the right call

The app is pure static files, which is exactly what Pages serves. It's free,
it's HTTPS (required for the offline service worker), and the URL is stable.

```bash
git init
git add .
git commit -m "Iron Ledger"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
`main` / `/ (root)` → Save.** A minute later it's live at
`https://<you>.github.io/<repo>/`.

One thing to know: **a public repo means a public URL.** The code is public
either way; your training data never leaves your phone, so there's nothing
sensitive in the repo. If you'd rather the URL not be guessable, a private repo
with Pages needs a paid plan — Netlify Drop or Cloudflare Pages will host a
private-ish static site free instead. Drag the folder onto
[app.netlify.com/drop](https://app.netlify.com/drop) and you get a URL in about
ten seconds with no git at all.

### Install it to the home screen

Once it's on an HTTPS URL, open it on your phone:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Add to Home screen / Install app

It then launches fullscreen with no browser chrome, and works with no signal.

Two caveats worth knowing up front:

1. **iOS home-screen apps get their own storage bucket.** Data you entered in
   Safari won't appear in the installed app. Install it *first*, then start
   logging.
2. **iOS uses a screenshot for the home-screen icon** unless there's a PNG
   `apple-touch-icon`. `icon.svg` covers Android and desktop; if you want a
   proper icon on iOS, export a 180×180 PNG named `apple-touch-icon.png` into
   the root and add `<link rel="apple-touch-icon" href="apple-touch-icon.png">`
   to `index.html`.

### After you deploy an update

`sw.js` caches the app aggressively so it works offline. When you change any
file, bump the version at the top of `sw.js`:

```js
var CACHE = "iron-ledger-v4";   // was v3
```

Otherwise phones will keep serving the old copy. Your saved workouts are in
`localStorage` and are untouched by this.

## Getting your data off the phone

There's still no cloud copy — clearing site data or losing the phone loses
the log — so **Your data** at the bottom of the Log tab exists to get a copy
out. Nothing is uploaded anywhere; the files are built on the device and
handed to you.

| | |
|---|---|
| **Spreadsheet (CSV)** | One row per weight you lifted, so a drop set stays two rows. Opens in Excel, Numbers or Sheets. Weigh-ins and days off are in the same file. |
| **Full backup** | The entire save as JSON. This is the one that restores. |
| **Send it to myself…** | Opens the phone's share sheet with both files attached — mail them to yourself, drop them in Files, whatever. Only appears where the browser supports it, which in practice means your phone. |
| **Copy CSV** | Straight to the clipboard, for pasting into a spreadsheet on a desktop. |
| **Restore a backup** | Pick a backup file. It asks first, then replaces everything. |

Doing the "send it to myself" once a month is enough to never lose more than
a month.

Restoring runs the same migrations as loading, so a backup from an older
version of the app still works.

The old console incantation still works if you want it:

```js
copy(localStorage.getItem("ironLedger.v1"))
```

## The one-file build (optional)

```bash
node build.mjs
```

Writes `dist/iron-ledger.html` — the whole app inlined into a single file that
needs nothing but a browser — and `dist/artifact.html`, the same thing as a
fragment for publishing as a Claude Artifact.

You don't need this to develop or to host on Pages. It's only for handing
someone a single file.
