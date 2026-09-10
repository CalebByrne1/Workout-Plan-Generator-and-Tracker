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

## The plan moves on its own

Finishing a session doesn't just save it — it sets up the next visit to that
day. Two things happen, and both are visible: every exercise carries a chip
saying what was decided and why, and a line above the day sums it up.

### Progressive overload

Double progression, applied per exercise from the sets you actually logged:

| What you did | What happens next time |
| --- | --- |
| Every planned set at the **top** of the rep range | **+1 weight step** on the bar |
| Everything **inside** the range | Same load — chase the top of the range |
| **Two or more** sets under the **bottom** of the range | **−10%**, rounded down to a step |
| Sets you simply didn't log | Nothing. A short session isn't too much weight |

Bodyweight movements have no bar to load, so clearing the top of the range
moves the **rep target** up by one instead (`6-10` becomes `7-11`). Hang plates
off yourself and it switches back to loading them.

Nothing here invents a number. Every decision comes from a set you logged,
which is why an empty log leaves the plan alone.

### Variety

Each row in a day is a **slot** with a job — "horizontal press", "hip hinge",
"calf". An exercise can only ever be replaced by another one with the same
**movement pattern** and the same **weight class**, so a heavy press is swapped
for another heavy press and never for a cable fly.

Three rules keep it from becoming a shuffle:

- **Age.** An exercise survives a few visits before it's eligible — nothing
  moves the week after it arrived. Compounds wait longest.
- **Recency.** The replacement is whichever candidate you've gone longest
  without doing, so you walk around the pool rather than bounce between two.
- **Restraint.** At most one or two slots change per visit, and never two heavy
  compounds at once. Walking in with no idea what any of it should weigh is
  the opposite of progressive overload.

Set the pace in **Log → Variety** (Off / Low / Medium / High), or hold a single
exercise still with **Edit → This slot → Keep**. Two days can never land on the
same exercise in the same week.

A swapped-in exercise opens at whatever your log says you last did on it. If
it's genuinely new, it opens blank and says so.

## Adding exercises

**Log → any exercise → Edit → Swap**, or **+ Add exercise**, then type a name.
If nothing in the library matches, you get **Add "…"**, which opens a short
form: body part, weight class, sets, reps, and **what job it does**.

That last field is the only one that isn't cosmetic — it's the movement pattern
rotation reads. Tag a hack squat as *Squat pattern* and it can stand in for the
V-squat, and the V-squat for it. Leave it blank and the exercise simply never
rotates, which is a fine answer for something you always want to do.

Your exercises sit in the same list as the built-ins with an **Edit** button
next to them. Giving one the same name as a built-in replaces it, which is how
you correct a rep target or a rest length you disagree with.

## Importing training you already did

**Log → + Past workouts.** Type up what you've already done — a notebook page,
months of it at once — in roughly the shorthand you'd write anyway:

```
2026-08-25 Upper A
Incline Smith Press 135x8 135x8 145x6
Barbell Bent-Over Row 155x8x3
Pull-Ups BWx9 BWx7
note: incline felt easy

8/27 Lower A
Hack Squat 250x8x4
Barbell RDL 185x8 185x8 195x6
```

- A line starting with a **date** starts a new day; what follows names the
  workout. `2026-08-25`, `8/25`, `8/25/26`, `Aug 25` and `yesterday` all work,
  and a bare month/day means the most recent one that isn't in the future.
- Every other line is one exercise: its name, then its sets.
- `135x8 135x8 145x6` — three sets · `155x8x3` — that set three times ·
  `185x5+155x3` — one set with a drop in it · `BWx9` — bodyweight ·
  `45 45 45` — reps with nothing on the bar.
- Spaces, commas, `lb` and `@` are all fine. Names match loosely, so
  "hack squat" finds the hack squat machine; anything genuinely new is added
  to your library.

A live preview shows what it will become **and which lines it couldn't read**,
before anything is written. An import you can't check is one you can't trust.

Imported sessions are indistinguishable from logged ones everywhere
downstream — charts, totals, "last time" lines. On commit, every working weight
in the rotation is re-derived from the log, so the plan opens where you
actually are rather than at zero. **Log → Re-seed** does the same thing on
demand.

## Files

```
index.html            markup only
style.css             all styling; the colour tokens are at the top
js/data.js            THE PROGRAM — exercise library and the four day templates
js/store.js           state shape, localStorage, and the domain logic
js/plan.js            progressive overload, auto-rotation, and the importer
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

## On a phone

The layout is built for a phone held in one hand, and a few things are nailed
down on purpose:

- **Double-tap never zooms.** `touch-action: manipulation` tells the browser
  the document has no double-tap gesture, so tapping **+** twice quickly is
  ten pounds rather than a zoom — and the 300ms wait-and-see delay before every
  tap registers goes with it.
- **Focusing a field never zooms.** Every input is at least 16px; Safari zooms
  the page to meet anything smaller and then leaves you scrolled sideways.
- **Buttons aren't selectable**, so a fast second tap can't start a selection
  or raise the magnifier.
- **Pinch-zoom still works.** It's deliberately left alone — it's the only way
  back for anyone who needs the text bigger, and nobody pinches by accident.

The steppers in the set logger update in place rather than rebuilding the
sheet, so holding down **+** keeps up with you.

## Running it locally

Double-click `index.html`. That's it.

The service worker is skipped on `file://`, so offline mode won't engage — that
only matters once it's hosted.

## Changing the program

Edit `js/data.js`. The exercise library is
`[group, name, type, sets, reps, pattern]`, `PATTERNS` is the list of jobs an
exercise can do, `VARIETY` is how fast rotation moves, and `TEMPLATES` is the
four days.

You don't need to touch this file to add an exercise — the app does that (see
**Adding exercises** above) and keeps it in your save file. Editing here is for
changing what a *fresh* install starts with.

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
