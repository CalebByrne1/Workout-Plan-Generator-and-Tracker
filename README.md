# Iron Ledger

A single-page workout tracker for a four-day upper/lower split, with nutrition
and a maintenance estimate worked out from your own numbers. Everything lives
in the browser's `localStorage` on the device you're using and works offline;
signing in is optional and syncs the same log to every device you use (see
**Sync across devices**). No server of its own and no dependencies — just
files a browser opens.

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
  bodyweight at the time (the 7-day average) is added in, because a chin-up at
  150lb and the same rep at 190lb are not the same lift. Anything you've never
  logged with a load charts your best set's *reps* instead, where that IS the
  progress.
- **× body** — the same trend divided by your 7-day average weight that week,
  so one heavy morning can't knock a point off it. It only rises when you get
  stronger faster than you get heavier, which is the question a changing
  bodyweight makes impossible to answer from load alone. Log a weigh-in or two
  and the toggle appears.
- **Bodyweight** — log daily from **Log weight**; the app leads with the
  **7-day average**, not the day's reading. Water, salt, carbs and a hard leg
  day move a single reading by a pound or three; averaging a week of them
  cancels most of that. The tile shows this week's average against last
  week's, and the chart draws the average as its line with each day's reading
  as a faint dot underneath — the noise stays visible without stealing the eye.
  No weigh-in in the last seven days and the tile shows your last reading with
  its date instead, rather than an average of nothing.
- **Volume per session** and a **consistency grid** of the last ten weeks:
  amber for a day you trained (darker with more volume), a grey ring for a
  rest day, a red one for a missed day.

Tap or drag across any chart to read off a specific day.

## Nutrition

At the top of the Progress tab. **Log food** takes the day's totals —
calories, protein, fiber — and **every field is optional**: a day with only
calories is a day with only calories, not a day of zero protein. A blank field
is "not logged"; a typed 0 is a real zero.

**The calorie target is a phase, not a number.** Each target has a start date
and an optional label (Cut, Maintain, Bulk) and holds until the next one
begins. Every day is judged against the target that was in force *on that
day*, so switching from a bulk at 3,000 to a cut at 2,200 changes nothing
about how your bulk days read. Change it with **Change** on the card; it
starts today by default, or backdate it if the phase really began earlier.
Your very first target reaches back to your earliest logged day, so days you
logged before setting one aren't left with nothing to compare against.

What you see:

- **Today** as a meter against the target — the part past the target runs on
  in the "over" colour — with the difference in words.
- **Calories vs target**: the last 14 days as bars above or below the target
  line. Days you didn't log are gaps, not zeros. Tap a bar for the numbers.
- **7-day averages** for calories, protein and fiber, each over only the days
  that field was actually logged, with the count shown ("165 g · 6 of 7 days").
- **Recent days** with exact numbers. Tap one to edit or clear it; for anything
  older, change the date in the food sheet.

Over and under are a *direction*, not a verdict — over is the aim on a bulk and
the thing to avoid on a cut — so the colours never change with the phase, and
the numbers always sit next to a word or a sign rather than relying on colour.
The two colours are checked for colour-blind separation in both themes.

### Maintenance, worked out from your own numbers

The **Maintenance** card estimates what you actually burn from what you ate and
what the scale did:

> maintenance ≈ average daily calories − (weight trend per day × 3,500 kcal/lb)

Averaging 2,300 kcal while losing half a pound a week (250 kcal a day of
deficit) puts maintenance around 2,550. It uses the **21 days through
yesterday** — today's food isn't finished, and a breakfast-only today would
drag the average down every morning.

How it avoids the usual traps:

- **Weight change is the slope of a line fitted through every weigh-in** in
  the window, not the last reading minus the first. Two single days are mostly
  water; a line through twenty isn't.
- **Calories average only the days you logged.** An unlogged day is unknown,
  not zero.
- **It shows nothing until it has enough**: at least 10 days with calories and
  6 weigh-ins spread over 10+ days. Until then it lists exactly what it's still
  missing. In the meantime an online calculator is the better guess.
- **It tells you how sure it is.** The ± is one standard error of the fitted
  slope in kilocalories — how far the scale wanders from its trend. More
  weigh-ins and a steadier scale narrow it; weighing in every third day
  roughly doubles it.
- **kg works too**: the factor becomes 7,700 kcal per kilo.

The number that matters most, though, is that **a consistent miscount cancels
out**. If you always undercount by 10%, the estimate comes back in your own
counting — which is exactly the unit your target needs, and something no
calculator can know. What it *can't* survive is inconsistency: skipping the
logging on big days makes intake look low, so maintenance reads low too. And a
sudden change — starting a cut, a new training block, a swing in carbs or salt
— moves water for a week or so; the estimate lags until the window rolls past
it.

The card also says how it compares week to week, and what it means for the
target you've set ("your 2,100 target is 380 below it — roughly losing 0.8 lb a
week if you hit it"). Once it's ready, the target sheet offers **Cut / Maintain
/ Bulk** starting points from it — maintenance −500, as is, and +250 — which
fill in the number and phase for you to adjust before saving.

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
js/vault.js           snapshots in IndexedDB, and asking for persistent storage
js/store.js           state shape, localStorage, and the domain logic
js/plan.js            progressive overload, auto-rotation, and the importer
js/sync.js            sign-in and sync with Supabase, over plain fetch
js/chart.js           the SVG charts on the Progress tab; no library
js/ui.js              everything that produces markup
js/app.js             event wiring, rest timer, boot
manifest.webmanifest  makes it installable as a home-screen app
sw.js                 offline cache, so a dead gym signal doesn't matter
icon.svg              app icon
build.mjs             optional: bundles everything into one file (see below)
package.json          npm scripts only — there are no dependencies
supabase/schema.sql   the sync table and its security rules — run once in Supabase
test/logic.mjs        the rules, run in Node with no browser
test/sync.mjs         several devices syncing through a fake Supabase
test/fake-supabase.js the fake: same HTTP, same security rules, no network
test/browser.mjs      serves the app and drives it in headless Chrome/Edge
test/harness.js       the in-page half of the browser tests
.github/workflows/    runs every suite on every push
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

**The rest timer survives a locked screen.** Phones suspend timers in the
background, so a countdown that works by ticking down once a second is wrong
the moment you pocket the phone. The timer stores when the rest *ends* and
derives the display from the clock, and it rechecks the moment you come back
to the app. A rest that ran out while you were away stops; if it ran out in
the last ninety seconds it also tells you so.

## Tests

```
npm test               build, then every suite
npm run test:logic     just the rules — fast, needs only Node
npm run test:sync      several devices syncing through a fake Supabase
npm run test:browser   the real app in headless Chrome or Edge
```

There is nothing to install; Node 22 or newer is the only requirement.

**test/logic.mjs** loads the data, store, plan and vault files into a bare
Node context and checks the arithmetic: progression, rotation, the import
parser, the weight trend and maintenance estimate, nutrition phases,
migrations from older saves, and that the vault degrades quietly when there is
no IndexedDB at all.

**test/sync.mjs** runs several copies of the app side by side — an iPhone, a
laptop, a tablet — each with its own storage, syncing through
`test/fake-supabase.js`, a stand-in that speaks the same HTTP as Supabase and
enforces the same rules as `supabase/schema.sql`. It covers conflicts both
ways, two devices writing at the same instant, edits landing mid-upload,
expired and revoked sessions, going offline, the "which data to keep?"
question, and a broken copy on the account being refused — and checks that
every copy that loses a conflict turns up in a snapshot. It never touches the
real project.

**test/browser.mjs** serves the repository over http — so IndexedDB, storage
and the service worker behave the way they do once deployed — and drives it in
a headless browser over the DevTools protocol: logging sets, the rest timer
through a simulated locked screen, building an exercise, importing, taking and
restoring snapshots, undoing a reset, the nutrition and maintenance cards, and
signing in to sync through the real screens against the fake server. It finds
Chrome or Edge on its own; set `CHROME_PATH` to point it elsewhere. With no
browser available it skips rather than fails.

All of them run on every push to GitHub (`.github/workflows/test.yml`).

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

## Keeping your data

Four layers, and it matters which one protects against what:

| | Protects against | Doesn't protect against |
|---|---|---|
| **Persistent storage** | The browser evicting the app's data to free up space | Clearing site data, losing the phone |
| **Snapshots** | A mistaken Reset, restoring the wrong file, a bad import | Clearing site data, losing the phone |
| **Sync** | Losing the phone, clearing site data, a second device | Deleting the data on purpose everywhere |
| **Exporting a copy** | Everything | Only as fresh as your last export |

**Persistent storage.** On launch the app asks the browser to mark its storage
as persistent. The browser decides whether to grant it — an app installed to
the home screen is the likeliest to get a yes — and the Data panel tells you
which answer you got. Worth checking once on your actual phone.

**Snapshots.** A whole copy of the save is kept in IndexedDB after every
finished session, and *before* anything that overwrites your log — reset,
restoring a backup, importing, rolling back. The last 20 are kept. Each one is
a **Restore** button in **Log → Snapshots**, and restoring snapshots the
current state first, so a rollback can itself be rolled back. They live on the
same device as the thing they back up: they are an undo button, not a backup.

**Sync and exporting** are the layers that survive losing the phone, so the
Data panel tracks when a copy last left the device — by sync or by export —
and says so plainly once it has been a month or more.

## Sync across devices

**Log → Sync.** Sign in with your email and the whole log — training, plan,
weigh-ins, food, your own exercises — is on every device you sign in on.
Nothing about using the app changes: it all still works offline, and each
device catches up when it's back.

**Signing in is by code.** Type your email, and a code arrives by email; type
that into the app. It's a code rather than a link because on an iPhone an app
added to the home screen doesn't share storage with Safari — a link would sign
Safari in, not the app. (A link still works on a computer, where it opens in
the same browser.)

**How it behaves:**

- Your whole save is one row in the account. A change on this device goes up
  a couple of seconds after you make it — logging three sets in a row is one
  upload — and anything waiting goes up the moment you switch away from the app.
- Coming back to the app checks whether another device changed anything, and
  takes it if this device had nothing new of its own. Only the revision number
  is fetched to check; the data itself only when there's something to take.
- **If both devices changed things offline, the newer copy wins, and the other
  is kept as a snapshot** on the device that lost — so a clash never throws
  anything away. The app tells you when it happens.
- **The first time a device with its own training meets an account with
  different training, it asks** which to keep, rather than silently overwriting
  either. Identical copies, or an empty side, never ask.
- Taking the account's copy always snapshots this device's first. If the other
  device had just been reset by mistake, that snapshot is what gets it back.
- Signing out keeps everything on the device. Sign back in to the same account
  and it carries on; changes made while signed out go up.

**Security.** The app talks to Supabase directly from the browser using the
project's *publishable* key, which is public by design. What keeps the data
private is on the server, in `supabase/schema.sql`: the table is granted to
signed-in users only, and row-level security lets each account read and write
exactly one row — its own. The server, not the device, numbers every write and
stamps its time, which is how two devices writing at once are caught.

### Setting it up (once)

1. **Run `supabase/schema.sql`** in the Supabase dashboard: SQL Editor → New
   query → paste the whole file → Run. It's safe to run again.
2. **Put the code in the sign-in emails.** In Authentication, open the email
   templates and add `{{ .Token }}` to both the **Magic link** and **Confirm
   signup** templates — a first-time address gets the second one. For example:

   ```html
   <h2>Your Iron Ledger sign-in code</h2>
   <p>Type this into the app:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Or, on a computer, <a href="{{ .ConfirmationURL }}">sign in with this link</a>.</p>
   ```

3. **Set the Site URL** (Authentication → URL Configuration) to where the app
   is hosted, so the link in the email comes back to it.

Supabase's built-in email sender only sends a few emails an hour — plenty for
one person; if you hit it, the app says so, and it clears in a few minutes.

## Getting your data off the phone

Sync keeps a copy on your account; **Your data** at the bottom of the Log tab
gets you a copy of your own, as files built on the device and handed to you.

| | |
|---|---|
| **Spreadsheet (CSV)** | One row per weight you lifted, so a drop set stays two rows. Opens in Excel, Numbers or Sheets. Weigh-ins, days off and food are in the same file — each food row carries the calorie target that was in force that day. |
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
