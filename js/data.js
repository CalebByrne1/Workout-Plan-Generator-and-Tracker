/* ==========================================================================
   data.js — the program itself.

   This is the file to edit when you want to change what the app starts with.
   Nothing here is behaviour; it is all content.

   Note: changing these only affects a FRESH start. Once the app has saved a
   plan to localStorage it uses that, so edits here won't show up until you
   hit Reset in the Log tab (or clear site data). Exercises you add from the
   phone live in the save file, not here — see store.libAll().
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

/* --------------------------------------------------------------------------
   Movement patterns

   A pattern is "what job does this exercise do in the session". It is the
   thing that makes auto-rotation safe: a slot can only ever be refilled by
   another exercise with the same pattern AND the same type, so a heavy press
   gets swapped for another heavy press and never for a cable fly.

   Pool = same pattern + same type. That's the whole rule. Add an exercise
   with an existing pattern and it joins that rotation automatically.
   -------------------------------------------------------------------------- */
var PATTERNS = [
  ["push-horiz","Horizontal press"],
  ["push-vert","Overhead press"],
  ["push-fly","Chest fly"],
  ["pull-horiz","Row"],
  ["pull-vert","Pulldown / pull-up"],
  ["delt-lat","Lateral raise"],
  ["delt-rear","Rear delt"],
  ["trap","Shrug"],
  ["curl","Biceps curl"],
  ["triceps","Triceps extension"],
  ["forearm","Forearm"],
  ["squat","Squat pattern"],
  ["hinge","Hip hinge"],
  ["lunge","Single leg"],
  ["quad-iso","Quad isolation"],
  ["ham-iso","Hamstring isolation"],
  ["glute","Glute"],
  ["abduct","Abduction"],
  ["adduct","Adduction"],
  ["calf","Calf"],
  ["core-flex","Trunk flexion"],
  ["core-brace","Bracing / anti-extension"],
  ["core-rot","Rotation"],
  ["carry","Loaded carry"]
];

var PATTERN_LABEL = {};
PATTERNS.forEach(function(p){ PATTERN_LABEL[p[0]] = p[1]; });

/* --------------------------------------------------------------------------
   Exercise library — everything at your gym, grouped by what it trains.

   [ group, name, type, default sets, default reps, pattern ]

   type drives the rest timer and how eagerly the exercise rotates:
     compound  heaviest movements, 3:00 rest, rotates slowly
     support   secondary movements, 1:30 rest
     small     arms / calves / abs,  1:30 rest
   -------------------------------------------------------------------------- */
var LIB = [
  ["Chest","Incline Smith Press","compound",4,"6-8","push-horiz"],
  ["Chest","Flat Smith Press","compound",4,"6-8","push-horiz"],
  ["Chest","Incline Barbell Bench Press","compound",4,"6-8","push-horiz"],
  ["Chest","Flat Barbell Bench Press","compound",4,"6-8","push-horiz"],
  ["Chest","Incline DB Press","compound",4,"8-10","push-horiz"],
  ["Chest","Flat DB Press","compound",4,"8-12","push-horiz"],
  ["Chest","Decline Smith Press","compound",3,"8-10","push-horiz"],
  ["Chest","Seated Chest Press Machine","compound",3,"8-10","push-horiz"],
  ["Chest","Incline Chest Press Machine","compound",3,"8-10","push-horiz"],
  ["Chest","Dips","compound",3,"8-10","push-horiz"],
  ["Chest","Push-Ups","support",3,"12-20","push-horiz"],
  ["Chest","Chest Fly Machine","support",3,"12-15","push-fly"],
  ["Chest","Pec Deck","support",3,"12-15","push-fly"],
  ["Chest","Cable Fly (High to Low)","support",3,"12-15","push-fly"],
  ["Chest","Cable Fly (Low to High)","support",3,"12-15","push-fly"],
  ["Chest","Incline DB Fly","support",3,"12-15","push-fly"],

  ["Back","Barbell Bent-Over Row","compound",4,"6-8","pull-horiz"],
  ["Back","Pendlay Row","compound",4,"6-8","pull-horiz"],
  ["Back","T-Bar Row","compound",4,"8-10","pull-horiz"],
  ["Back","Chest-Supported DB Row","support",3,"8-10","pull-horiz"],
  ["Back","Single-Arm DB Row","support",3,"8-10","pull-horiz"],
  ["Back","Seated Cable Low Row","support",3,"8-10","pull-horiz"],
  ["Back","Chest-Supported Row Machine","support",3,"10-12","pull-horiz"],
  ["Back","Seated Row Machine","support",3,"10-12","pull-horiz"],
  ["Back","Landmine Row","support",3,"10-12","pull-horiz"],
  ["Back","Inverted Row","support",3,"10-15","pull-horiz"],
  ["Back","Pull-Ups","compound",4,"6-10","pull-vert"],
  ["Back","Chin-Ups","compound",4,"6-10","pull-vert"],
  ["Back","Neutral-Grip Pull-Ups","compound",4,"6-10","pull-vert"],
  ["Back","Cable Lat Pulldown","support",3,"8-10","pull-vert"],
  ["Back","Lat Pulldown Machine","support",3,"10-12","pull-vert"],
  ["Back","Close-Grip Lat Pulldown","support",3,"10-12","pull-vert"],
  ["Back","Single-Arm Lat Pulldown","support",3,"10-12","pull-vert"],
  ["Back","Straight-Arm Pulldown","small",3,"12-15","pull-vert"],
  ["Back","Rear Delt Fly Machine","small",3,"12-15","delt-rear"],
  ["Back","Cable Face Pull","small",3,"12-15","delt-rear"],
  ["Back","Bent-Over DB Rear Delt Fly","small",3,"12-15","delt-rear"],

  ["Shoulders","Seated Smith Shoulder Press","compound",3,"6-8","push-vert"],
  ["Shoulders","Seated DB Shoulder Press","compound",3,"8-10","push-vert"],
  ["Shoulders","Standing Barbell Overhead Press","compound",3,"6-8","push-vert"],
  ["Shoulders","Arnold Press","compound",3,"8-10","push-vert"],
  ["Shoulders","Shoulder Press Machine","support",3,"10-12","push-vert"],
  ["Shoulders","Cable Lateral Raise","small",3,"12-15","delt-lat"],
  ["Shoulders","DB Lateral Raise","small",3,"12-15","delt-lat"],
  ["Shoulders","Lateral Raise Machine","small",3,"12-15","delt-lat"],
  ["Shoulders","Upright Row","small",3,"10-12","delt-lat"],
  ["Shoulders","DB Shrugs","small",3,"12-15","trap"],
  ["Shoulders","Barbell Shrugs","small",3,"12-15","trap"],
  ["Shoulders","Smith Machine Shrugs","small",3,"12-15","trap"],

  ["Arms","DB Bicep Curl","small",3,"10-12","curl"],
  ["Arms","DB Hammer Curl","small",3,"10-12","curl"],
  ["Arms","Seated Preacher Curl","small",3,"10-12","curl"],
  ["Arms","Seated Preacher Hammer Curl","small",3,"10-12","curl"],
  ["Arms","Incline Seated DB Curl","small",3,"12-15","curl"],
  ["Arms","Cable Bicep Curl","small",3,"12-15","curl"],
  ["Arms","EZ-Bar Curl","small",3,"8-10","curl"],
  ["Arms","Barbell Curl","small",3,"8-10","curl"],
  ["Arms","Concentration Curl","small",3,"12-15","curl"],
  ["Arms","Reverse Curl","small",3,"12-15","curl"],
  ["Arms","Machine Preacher Curl","small",3,"10-12","curl"],
  ["Arms","Cable Tricep Pushdown","small",3,"10-12","triceps"],
  ["Arms","Rope Tricep Pushdown","small",3,"12-15","triceps"],
  ["Arms","Tricep Pushdown Machine","small",3,"12-15","triceps"],
  ["Arms","Overhead DB Tricep Extension","small",3,"12-15","triceps"],
  ["Arms","Overhead Cable Tricep Extension","small",3,"12-15","triceps"],
  ["Arms","EZ-Bar Skullcrusher","small",3,"10-12","triceps"],
  ["Arms","Bench Dips","small",3,"12-15","triceps"],
  ["Arms","DB Tricep Kickback","small",3,"12-15","triceps"],
  ["Arms","Close-Grip Bench Press","support",3,"8-10","triceps"],
  ["Arms","DB Wrist Curl","small",3,"15-20","forearm"],
  ["Arms","Reverse Wrist Curl","small",3,"15-20","forearm"],

  ["Legs","V-Squat Machine","compound",4,"6-8","squat"],
  ["Legs","Hack Squat Machine","compound",4,"6-8","squat"],
  ["Legs","Pendulum Squat","compound",4,"8-10","squat"],
  ["Legs","Barbell Back Squat","compound",4,"5-8","squat"],
  ["Legs","Barbell Front Squat","compound",4,"6-8","squat"],
  ["Legs","Smith Machine Squat","compound",4,"8-10","squat"],
  ["Legs","Belt Squat","compound",4,"8-10","squat"],
  ["Legs","Leg Press","compound",4,"10-12","squat"],
  ["Legs","Goblet Squat","support",3,"10-12","squat"],
  ["Legs","Barbell RDL","compound",4,"6-8","hinge"],
  ["Legs","DB RDL","compound",4,"8-10","hinge"],
  ["Legs","Barbell Deadlift","compound",4,"5-6","hinge"],
  ["Legs","Trap-Bar Deadlift","compound",4,"6-8","hinge"],
  ["Legs","Good Morning","support",3,"8-10","hinge"],
  ["Legs","Cable Pull-Through","support",3,"12-15","hinge"],
  ["Legs","45-Degree Back Extension","support",3,"12-15","hinge"],
  ["Legs","Bulgarian Split Squat","compound",3,"8-10","lunge"],
  ["Legs","Reverse Lunge","compound",3,"10-12","lunge"],
  ["Legs","Walking Lunge","compound",3,"10-12","lunge"],
  ["Legs","Split Squat","compound",3,"8-10","lunge"],
  ["Legs","DB Step-Up","compound",3,"10-12","lunge"],
  ["Legs","Leg Extension","support",3,"12-15","quad-iso"],
  ["Legs","Sissy Squat","support",3,"12-15","quad-iso"],
  ["Legs","Seated Leg Curl","support",3,"10-12","ham-iso"],
  ["Legs","Lying Leg Curl","support",3,"10-12","ham-iso"],
  ["Legs","Standing Leg Curl","support",3,"12-15","ham-iso"],
  ["Legs","Nordic Curl","support",3,"6-10","ham-iso"],
  ["Legs","Cable Kickback","small",3,"12-15","glute"],
  ["Legs","Barbell Hip Thrust","support",3,"8-12","glute"],
  ["Legs","Machine Hip Thrust","support",3,"10-12","glute"],
  ["Legs","Glute Kickback Machine","small",3,"12-15","glute"],
  ["Legs","Glute Bridge","small",3,"12-15","glute"],
  ["Legs","Abductor Machine","small",3,"12-15","abduct"],
  ["Legs","Cable Hip Abduction","small",3,"12-15","abduct"],
  ["Legs","Adductor Machine","small",3,"12-15","adduct"],
  ["Legs","Cable Hip Adduction","small",3,"12-15","adduct"],
  ["Legs","Calf Raise","small",4,"12-15","calf"],
  ["Legs","Standing Calf Raise","small",4,"12-15","calf"],
  ["Legs","Seated Calf Raise","small",4,"12-15","calf"],
  ["Legs","Leg Press Calf Raise","small",4,"12-15","calf"],
  ["Legs","Smith Machine Calf Raise","small",4,"12-15","calf"],

  ["Core","Cable Crunch","small",3,"12-15","core-flex"],
  ["Core","Machine Crunch","small",3,"12-15","core-flex"],
  ["Core","Decline Sit-Up","small",3,"12-15","core-flex"],
  ["Core","Captain's Chair Leg Raise","small",3,"12-15","core-flex"],
  ["Core","Hanging Leg Raise","small",3,"10-15","core-flex"],
  ["Core","Ab Wheel Rollout","small",3,"10-12","core-brace"],
  ["Core","Plank","small",3,"30-60","core-brace"],
  ["Core","Dead Bug","small",3,"10-12","core-brace"],
  ["Core","Pallof Press","small",3,"12-15","core-rot"],
  ["Core","Cable Woodchopper","small",3,"12-15","core-rot"],
  ["Core","Russian Twist","small",3,"15-20","core-rot"],
  ["Core","Farmer's Carry","small",3,"30-45","carry"],
  ["Core","Suitcase Carry","small",3,"30-45","carry"]
];

/* Name -> details, so lookups don't scan the array. */
var LIB_BY_NAME = {};
LIB.forEach(function(row){
  LIB_BY_NAME[row[1]] = {
    group:row[0], name:row[1], type:row[2],
    sets:row[3], reps:row[4], pattern:row[5]
  };
});

/* Loaded by bodyweight — these show BW instead of a blank weight, and their
   progression adds reps rather than plates until you start hanging weight
   off yourself. */
var BODYWEIGHT = {
  "Pull-Ups":1,
  "Chin-Ups":1,
  "Neutral-Grip Pull-Ups":1,
  "Dips":1,
  "Push-Ups":1,
  "Inverted Row":1,
  "Bench Dips":1,
  "Hanging Leg Raise":1,
  "Captain's Chair Leg Raise":1,
  "Ab Wheel Rollout":1,
  "Plank":1,
  "Dead Bug":1,
  "Nordic Curl":1,
  "Sissy Squat":1,
  "Glute Bridge":1,
  "45-Degree Back Extension":1
};

/* --------------------------------------------------------------------------
   The rotation: Upper A, Lower A, Upper B, Lower B.

   A days are heavy — 6-8 on the compounds.
   B days trade the bar for dumbbells and machines and push the reps up.
   Supporting work sits at 8-12, arms/calves/abs at 10-15.

   plan entries are [ exercise name, sets, target reps ].
   -------------------------------------------------------------------------- */
var TEMPLATES = [
  {
    id:"UA", name:"Upper A", tag:"Heavy press & pull",
    plan:[
      ["Incline Smith Press",4,"6-8"],
      ["Barbell Bent-Over Row",4,"6-8"],
      ["Seated Smith Shoulder Press",3,"6-8"],
      ["Cable Lat Pulldown",3,"8-10"],
      ["Cable Lateral Raise",3,"12-15"],
      ["DB Bicep Curl",3,"10-12"],
      ["Cable Tricep Pushdown",3,"10-12"],
      ["Cable Crunch",3,"12-15"]
    ]
  },
  {
    id:"LA", name:"Lower A", tag:"Heavy squat & hinge",
    plan:[
      ["V-Squat Machine",4,"6-8"],
      ["Barbell RDL",4,"6-8"],
      ["Bulgarian Split Squat",3,"8-10"],
      ["Seated Leg Curl",3,"10-12"],
      ["Calf Raise",4,"12-15"],
      ["Abductor Machine",3,"12-15"]
    ]
  },
  {
    id:"UB", name:"Upper B", tag:"Dumbbell & machine volume",
    plan:[
      ["Flat DB Press",4,"8-12"],
      ["Pull-Ups",4,"6-10"],
      ["Seated DB Shoulder Press",3,"8-10"],
      ["Chest-Supported DB Row",3,"8-10"],
      ["Chest Fly Machine",3,"12-15"],
      ["Seated Preacher Hammer Curl",3,"10-12"],
      ["Overhead DB Tricep Extension",3,"12-15"],
      ["DB Shrugs",3,"12-15"],
      ["Hanging Leg Raise",3,"10-15"]
    ]
  },
  {
    id:"LB", name:"Lower B", tag:"Volume & single leg",
    plan:[
      ["Leg Press",4,"10-12"],
      ["Seated Leg Curl",3,"12-15"],
      ["Leg Extension",3,"12-15"],
      ["Cable Kickback",3,"12-15"],
      ["Adductor Machine",3,"15-20"],
      ["Calf Raise",4,"15-20"],
      ["Captain's Chair Leg Raise",3,"12-15"]
    ]
  }
];

/* Defaults applied to an exercise typed in by hand, i.e. not in the library.
   An empty pattern means "don't auto-rotate this" — there is nothing to
   rotate it with until you tell the app what job it does. */
var CUSTOM_DEFAULTS = {
  sets:3, reps:"10-12", type:"support", pattern:"", group:"My exercises"
};

/* --------------------------------------------------------------------------
   How much variety, and how fast

   cap       most slots that may change on one visit to a day
   compound  visits a compound must survive before it becomes eligible
   other     the same, for support and small work
   -------------------------------------------------------------------------- */
var VARIETY = {
  off:    { cap:0, compound:99, other:99, label:"Off" },
  low:    { cap:1, compound:4,  other:3,  label:"Low" },
  medium: { cap:2, compound:3,  other:2,  label:"Medium" },
  high:   { cap:3, compound:2,  other:1,  label:"High" }
};

IL.data = {
  LIB: LIB,
  LIB_BY_NAME: LIB_BY_NAME,
  BODYWEIGHT: BODYWEIGHT,
  TEMPLATES: TEMPLATES,
  CUSTOM_DEFAULTS: CUSTOM_DEFAULTS,
  PATTERNS: PATTERNS,
  PATTERN_LABEL: PATTERN_LABEL,
  VARIETY: VARIETY
};

})(window.IL);
