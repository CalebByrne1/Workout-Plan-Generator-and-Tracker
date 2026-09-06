/* ==========================================================================
   data.js — the program itself.

   This is the file to edit when you want to change what the app starts with.
   Nothing here is behaviour; it is all content.

   Note: changing these only affects a FRESH start. Once the app has saved a
   plan to localStorage it uses that, so edits here won't show up until you
   hit Reset in the Log tab (or clear site data).
   ========================================================================== */

window.IL = window.IL || {};

(function(IL){
"use strict";

/* --------------------------------------------------------------------------
   Exercise library — everything at your gym, grouped by what it trains.

   [ group, name, type, default sets, default reps ]

   type drives two defaults:
     compound  heaviest movements, 3:00 rest
     support   secondary movements, 1:30 rest
     small     arms / calves / abs,  1:30 rest
   -------------------------------------------------------------------------- */
var LIB = [
  ["Chest","Incline Smith Press","compound",4,"6-8"],
  ["Chest","Flat Smith Press","compound",4,"6-8"],
  ["Chest","Incline DB Press","compound",4,"8-10"],
  ["Chest","Flat DB Press","compound",4,"8-12"],
  ["Chest","Seated Chest Press Machine","compound",3,"8-10"],
  ["Chest","Chest Fly Machine","support",3,"12-15"],
  ["Chest","Dips","compound",3,"8-10"],

  ["Back","Barbell Bent-Over Row","compound",4,"6-8"],
  ["Back","Pull-Ups","compound",4,"6-10"],
  ["Back","Chest-Supported DB Row","support",3,"8-10"],
  ["Back","Cable Lat Pulldown","support",3,"8-10"],
  ["Back","Lat Pulldown Machine","support",3,"10-12"],
  ["Back","Seated Cable Low Row","support",3,"8-10"],
  ["Back","Chest-Supported Row Machine","support",3,"10-12"],

  ["Shoulders","Seated Smith Shoulder Press","compound",3,"6-8"],
  ["Shoulders","Seated DB Shoulder Press","compound",3,"8-10"],
  ["Shoulders","Shoulder Press Machine","support",3,"10-12"],
  ["Shoulders","Cable Lateral Raise","small",3,"12-15"],
  ["Shoulders","DB Shrugs","small",3,"12-15"],

  ["Arms","DB Bicep Curl","small",3,"10-12"],
  ["Arms","DB Hammer Curl","small",3,"10-12"],
  ["Arms","Seated Preacher Curl","small",3,"10-12"],
  ["Arms","Seated Preacher Hammer Curl","small",3,"10-12"],
  ["Arms","Incline Seated DB Curl","small",3,"12-15"],
  ["Arms","Cable Bicep Curl","small",3,"12-15"],
  ["Arms","Cable Tricep Pushdown","small",3,"10-12"],
  ["Arms","Tricep Pushdown Machine","small",3,"12-15"],
  ["Arms","Overhead DB Tricep Extension","small",3,"12-15"],
  ["Arms","DB Wrist Curl","small",3,"15-20"],

  ["Legs","V-Squat Machine","compound",4,"6-8"],
  ["Legs","Leg Press","compound",4,"10-12"],
  ["Legs","Barbell RDL","compound",4,"6-8"],
  ["Legs","Bulgarian Split Squat","compound",3,"8-10"],
  ["Legs","Leg Extension","support",3,"12-15"],
  ["Legs","Seated Leg Curl","support",3,"10-12"],
  ["Legs","Cable Kickback","small",3,"12-15"],
  ["Legs","Calf Raise","small",4,"12-15"],
  ["Legs","Abductor Machine","small",3,"12-15"],
  ["Legs","Adductor Machine","small",3,"12-15"],

  ["Core","Cable Crunch","small",3,"12-15"],
  ["Core","Captain's Chair Leg Raise","small",3,"12-15"],
  ["Core","Hanging Leg Raise","small",3,"10-15"]
];

/* Name -> details, so lookups don't scan the array. */
var LIB_BY_NAME = {};
LIB.forEach(function(row){
  LIB_BY_NAME[row[1]] = { group:row[0], type:row[2], sets:row[3], reps:row[4] };
});

/* Loaded by bodyweight — these show BW instead of a blank weight. */
var BODYWEIGHT = {
  "Pull-Ups":1,
  "Dips":1,
  "Hanging Leg Raise":1,
  "Captain's Chair Leg Raise":1
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

/* Defaults applied to an exercise typed in by hand, i.e. not in the library. */
var CUSTOM_DEFAULTS = { sets:3, reps:"10-12", type:"support" };

IL.data = {
  LIB: LIB,
  LIB_BY_NAME: LIB_BY_NAME,
  BODYWEIGHT: BODYWEIGHT,
  TEMPLATES: TEMPLATES,
  CUSTOM_DEFAULTS: CUSTOM_DEFAULTS
};

})(window.IL);
