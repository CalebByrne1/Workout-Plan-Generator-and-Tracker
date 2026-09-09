/* ==========================================================================
   chart.js — the small SVG charts on the Progress tab.

   No library. Everything here builds an <svg> string, drops it into a host
   element and wires one pointer handler for the readout.

   Charts are drawn at REAL PIXEL SIZE rather than scaled out of a fixed
   viewBox. A 640-wide viewBox squeezed onto a 360px phone would shrink the
   axis type to about six pixels, so instead we measure the host, draw to
   that width, and redraw on resize.

   Colour comes from CSS tokens via classes, never from hardcoded hex, so
   both themes are handled by style.css and nothing here needs to know which
   one is on.
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

var H = 190;                                  /* plot height, px            */
var PAD = { t:16, r:16, b:24, l:46 };

function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[c];
  });
}

/* --------------------------------------------------------------------------
   Scales
   -------------------------------------------------------------------------- */

/* A round number near span/count, so the axis only ever shows clean ticks —
   0 / 250 / 500, never 0 / 237 / 474. */
function niceStep(span, count){
  var raw = span / count;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var norm = raw / mag;
  return (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
}

/* Bars must grow from zero or their length lies about the data. A trend line
   doesn't: forcing zero onto a 185 → 205 lift flattens the whole story into
   one row of pixels, so lines get a padded window around their own range. */
function axis(min, max, zero){
  if(zero) min = 0;

  if(max === min){
    var nudge = Math.abs(max) * 0.1 || 1;
    max += nudge;
    if(!zero) min -= nudge;
  }else if(!zero){
    var pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
  }

  var step = niceStep(max - min, 4);
  var lo = zero ? 0 : Math.floor(min / step) * step;
  var hi = Math.ceil(max / step) * step;
  if(lo < 0 && min >= 0) lo = 0;               /* never invent negative load */
  if(hi <= lo) hi = lo + step;

  var ticks = [];
  for(var v = lo; v <= hi + step * 1e-6; v += step){
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return { lo:lo, hi:hi, ticks:ticks };
}

/* --------------------------------------------------------------------------
   Drawing
   -------------------------------------------------------------------------- */

function gridHTML(a, Y, w){
  return a.ticks.map(function(v){
    var y = Y(v);
    return '<line class="c-grid" x1="' + PAD.l + '" x2="' + (w - PAD.r) +
             '" y1="' + y + '" y2="' + y + '"></line>' +
           '<text class="c-tick" x="' + (PAD.l - 7) + '" y="' + (y + 3.5) + '" text-anchor="end">' +
             esc(a.fmt(v)) + '</text>';
  }).join("");
}

/* First, middle and last only. A label under every point is unreadable at
   phone width, and the readout carries the rest. */
function xLabelsHTML(pts, X, cfg){
  var picks = pts.length > 2
    ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
    : [0, pts.length - 1];
  var seen = {};

  return picks.map(function(i, n){
    if(seen[i]) return "";
    seen[i] = 1;
    var anchor = n === 0 ? "start" : (i === pts.length - 1 ? "end" : "middle");
    return '<text class="c-tick" x="' + X(pts[i], i).toFixed(1) + '" y="' + (H - 6) +
             '" text-anchor="' + anchor + '">' + esc(cfg.fmtX(pts[i].x)) + '</text>';
  }).join("");
}

function linePath(pts, X, Y){
  return pts.map(function(p, i){
    return (i ? "L" : "M") + X(p, i).toFixed(1) + " " + Y(p.y).toFixed(1);
  }).join(" ");
}

/* Square at the baseline, 4px rounded at the data end — the cap marks where
   the value stops without the whole mark turning into a lozenge. */
function barPath(x, y, w, bottom){
  var r = Math.min(4, w / 2, Math.max(0, bottom - y));
  return "M" + x + " " + bottom +
         "V" + (y + r) +
         "a" + r + " " + r + " 0 0 1 " + r + " " + (-r) +
         "h" + (w - r * 2) +
         "a" + r + " " + r + " 0 0 1 " + r + " " + r +
         "V" + bottom + "Z";
}

/* --------------------------------------------------------------------------
   draw(host, cfg)

     cfg.points   [{ x, y }]   x is a timestamp, y the value
     cfg.kind     "line" | "column"
     cfg.fmtY     axis tick     -> string
     cfg.fmtV     readout value -> string
     cfg.fmtX     timestamp     -> string
     cfg.empty    what to say when there isn't enough to plot
   -------------------------------------------------------------------------- */

function draw(host, cfg){
  if(!host) return;

  var pts = cfg.points || [];
  var need = cfg.kind === "column" ? 1 : 2;

  if(pts.length < need){
    host.innerHTML = '<p class="chart-empty">' + esc(cfg.empty || "Nothing to plot yet.") + '</p>';
    return;
  }

  var w = Math.max(260, Math.round(host.clientWidth || 320));
  var pw = w - PAD.l - PAD.r;
  var ph = H - PAD.t - PAD.b;

  var ys = pts.map(function(p){ return p.y; });
  var a = axis(Math.min.apply(null, ys), Math.max.apply(null, ys), cfg.kind === "column");
  a.fmt = cfg.fmtY;

  var Y = function(v){ return PAD.t + ph * (1 - (v - a.lo) / (a.hi - a.lo)); };

  var band = pw / pts.length;
  var thick = Math.max(3, Math.min(24, band - 2));   /* 2px gap between bars */
  var x0 = pts[0].x;
  var x1 = pts[pts.length - 1].x;

  var X = cfg.kind === "column"
    ? function(p, i){ return PAD.l + band * (i + 0.5); }
    : function(p){ return x1 === x0 ? PAD.l + pw / 2 : PAD.l + pw * (p.x - x0) / (x1 - x0); };

  var marks;

  if(cfg.kind === "column"){
    marks = pts.map(function(p, i){
      return '<path class="c-bar" data-hi="0" d="' +
        barPath((X(p, i) - thick / 2).toFixed(1), Y(p.y).toFixed(1), thick, Y(a.lo)) + '"></path>';
    }).join("");
  }else{
    var d = linePath(pts, X, Y);
    var base = Y(a.lo);
    var lastX = X(pts[pts.length - 1], pts.length - 1).toFixed(1);

    marks =
      '<path class="c-area" d="' + d + ' L' + lastX + ' ' + base +
        ' L' + X(pts[0], 0).toFixed(1) + ' ' + base + ' Z"></path>' +
      '<path class="c-line" d="' + d + '"></path>' +
      /* Intermediate dots only while they can still be told apart; past that
         they merge into a caterpillar and the bare line reads better. */
      (pts.length <= 12 ? pts.map(function(p, i){
        return '<circle class="c-dot" cx="' + X(p, i).toFixed(1) +
               '" cy="' + Y(p.y).toFixed(1) + '" r="4"></circle>';
      }).join("") : "") +
      '<circle class="c-dot end" cx="' + lastX +
        '" cy="' + Y(pts[pts.length - 1].y).toFixed(1) + '" r="4.5"></circle>';
  }

  var last = pts[pts.length - 1];

  host.innerHTML =
    '<div class="chart-read" data-read>' +
      '<b>' + esc(cfg.fmtV(last.y)) + '</b><span>' + esc(cfg.fmtX(last.x)) + '</span>' +
    '</div>' +
    '<svg class="chart" width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H +
      '" role="img" aria-label="' + esc(cfg.label || "chart") + '">' +
      gridHTML(a, Y, w) +
      marks +
      xLabelsHTML(pts, X, cfg) +
      '<g class="c-cross" data-cross hidden>' +
        '<line y1="' + PAD.t + '" y2="' + (H - PAD.b) + '"></line>' +
        '<circle r="5.5"></circle>' +
      '</g>' +
      '<rect x="' + PAD.l + '" y="' + PAD.t + '" width="' + pw + '" height="' + ph +
        '" fill="transparent" data-hit></rect>' +
    '</svg>';

  wire(host, pts, X, Y, cfg, band);
}

/* One pointer handler covers mouse and touch. Tapping or dragging across the
   plot moves the crosshair and rewrites the readout above it; leaving snaps
   back to the most recent point. */
function wire(host, pts, X, Y, cfg, band){
  var svg = host.querySelector("svg");
  var cross = host.querySelector("[data-cross]");
  var line = cross.querySelector("line");
  var dot = cross.querySelector("circle");
  var read = host.querySelector("[data-read]");
  var bars = host.querySelectorAll(".c-bar");

  function paintRead(p){
    read.innerHTML = '<b>' + esc(cfg.fmtV(p.y)) + '</b><span>' + esc(cfg.fmtX(p.x)) + '</span>';
  }

  function highlight(index){
    for(var b = 0; b < bars.length; b++) bars[b].dataset.hi = (b === index) ? "1" : "0";
  }

  function show(i){
    var p = pts[i];
    var x = X(p, i);
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", Y(p.y));
    cross.hidden = false;
    paintRead(p);
    highlight(i);
  }

  function reset(){
    cross.hidden = true;
    paintRead(pts[pts.length - 1]);
    highlight(-1);
  }

  function at(ev){
    var px = ev.clientX - svg.getBoundingClientRect().left;
    var best = 0;

    if(cfg.kind === "column"){
      best = Math.max(0, Math.min(pts.length - 1, Math.floor((px - PAD.l) / band)));
    }else{
      var nearest = Infinity;
      for(var i = 0; i < pts.length; i++){
        var gap = Math.abs(X(pts[i], i) - px);
        if(gap < nearest){ nearest = gap; best = i; }
      }
    }
    show(best);
  }

  svg.addEventListener("pointermove", at);
  svg.addEventListener("pointerdown", at);
  svg.addEventListener("pointerleave", reset);
}

IL.chart = { draw: draw, height: H };

})(window.IL);
