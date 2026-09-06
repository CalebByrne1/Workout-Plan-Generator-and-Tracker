/* ==========================================================================
   build.mjs — bundle the split files back into one self-contained page.

     node build.mjs

   Writes two things into dist/:

     iron-ledger.html   a standalone page with the CSS and JS inlined. Email
                        it, drop it on a USB stick, open it off the desktop —
                        it needs nothing but a browser.
     artifact.html      the same page as a fragment (no <html>/<head>/<body>),
                        which is the format the Claude Artifact publisher wants.

   You do NOT need this to develop or to host on GitHub Pages — just edit the
   real files and refresh. This exists so the one-file copies stay in sync.
   ========================================================================== */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = import.meta.dirname;
const SCRIPTS = ["js/data.js", "js/store.js", "js/ui.js", "js/app.js"];

const read = (p) => readFile(join(ROOT, p), "utf8");

const html = await read("index.html");
const css = await read("style.css");
const js = (await Promise.all(SCRIPTS.map(read))).join("\n\n");

/* Lines that only make sense when the app is served as separate files. */
const DROP = [
  /<link rel="manifest"/,
  /<link rel="icon"/,
  /name="apple-mobile-web-app/,
  /<script src="js\//
];

let standalone = html
  .replace(
    /<link rel="stylesheet" href="style\.css">/,
    `<style>\n${css}\n</style>`
  )
  .replace(/<!--\s*\n\s*Plain <script> tags[\s\S]*?-->\n/, "")
  .split("\n")
  .filter((line) => !DROP.some((re) => re.test(line)))
  .join("\n")
  .replace(/<\/body>/, `<script>\n${js}\n</script>\n</body>`);

/* The artifact publisher supplies its own document skeleton, so hand it
   everything from the <title> down, minus the wrapper tags. */
const fragment = standalone
  .slice(standalone.indexOf("<title>"), standalone.lastIndexOf("</body>"))
  .split("\n")
  .filter((line) => !/^\s*<\/?(head|body)>\s*$/.test(line))
  .join("\n")
  .trim();

await mkdir(join(ROOT, "dist"), { recursive: true });
await writeFile(join(ROOT, "dist/iron-ledger.html"), standalone);
await writeFile(join(ROOT, "dist/artifact.html"), fragment);

const kb = (s) => (s.length / 1024).toFixed(1) + " kB";
console.log(`dist/iron-ledger.html  ${kb(standalone)}`);
console.log(`dist/artifact.html     ${kb(fragment)}`);
