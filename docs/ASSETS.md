# Assets

Everything the workshop draws comes from `assets/`. The code never hardcodes a sprite, a station or a map coordinate. Add or change art by editing the files described here.

The world is 640 × 352 px at 1×, built on the 16 px grid of the Pixel Crawler pack. Characters stand about 30 px tall.

Every asset needs an entry in [`assets/CREDITS.md`](../assets/CREDITS.md) with its author, link and license.

## Layout

```
assets/
├─ characters/<id>/<id>.json    character manifest (the id is the folder name)
├─ characters/<id>/*.png        sheets used by that manifest
├─ stations/<id>.json           station manifest
├─ stations/*.png               station sheets
├─ tiles/*.png                  sheets used by the map scenery
├─ maps/workshop.json           the workshop map
└─ CREDITS.md
```

Ids use lowercase letters, digits, `-` and `_`. The server lists one character per folder that has a `<id>.json`. Other files in the folder can use dotted names (`brom.lpc.json`, `brom.credits.txt`) and are ignored.

Image paths must be relative, end in `.png` and never contain `..`.

## Character manifest

```jsonc
// assets/characters/brom/brom.json
{
  "name": { "en": "Brom", "pt-BR": "Brom" },
  "source": "lpc",
  "facing": "four", // "four" or "side"
  "image": "brom.png", // defaults for every animation
  "frame": { "width": 32, "height": 32 },
  "anchor": { "x": 16, "y": 30 }, // pixel of the frame that touches the floor
  "animations": {
    "idle": { "row": 22, "frames": 2, "fps": 2 },
    "walk": { "row": 8, "start": 1, "frames": 8, "fps": 10 },
    "work": { "row": 0, "frames": 7, "fps": 8 },
    "sit": { "row": 30, "start": 1, "frames": 1, "fps": 1 },
    "cheer": { "row": 34, "start": 2, "frames": 1, "fps": 1 },
  },
  "license": "See assets/CREDITS.md",
  "author": "Liberated Pixel Cup contributors",
}
```

All five poses are required:

| Pose    | Used when                                                       |
| ------- | --------------------------------------------------------------- |
| `idle`  | standing: thinking, reading, waiting, idle, visiting            |
| `walk`  | moving                                                          |
| `work`  | at the station with a tool running (write, terminal, web, plan) |
| `sit`   | sleeping or offline                                             |
| `cheer` | for a moment after the agent finishes                           |

Animation fields:

| Field                      | Default         | Meaning                                              |
| -------------------------- | --------------- | ---------------------------------------------------- |
| `image`, `frame`, `anchor` | top-level value | sheet, frame size and floor anchor of this animation |
| `row`                      | `0`             | first row of the animation                           |
| `start`                    | `0`             | first column                                         |
| `frames`                   | required        | number of frames, read left to right                 |
| `fps`                      | required        | playback speed; the animation loops                  |
| `hop`                      | `0`             | height in pixels of a small jump, used for cheering  |

`facing` tells how directions are stored:

- **`four`**: four rows per animation in the order north, west, south, east (the LPC generator layout). The renderer adds the direction to `row`.
- **`side`**: one row facing right. The renderer mirrors it when the character faces west and keeps the last side when it walks north or south (the Pixel Crawler layout).

Frames of different animations can have different sizes. The anchor keeps the feet in the same place. For example, Mortis idles in 32 × 32 frames anchored at (16, 31) and runs in 64 × 64 frames anchored at (30, 63).

### Adding an LPC character

1. Build it in the [Universal LPC Spritesheet Character Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/) and export the sheet, the credits and the JSON.
2. Downscale the sheet to 50% with nearest-neighbor sampling, so 64 px frames become 32 px.
3. Save it as `assets/characters/<id>/<id>.png`. Save the generator JSON as `<id>.lpc.json` and keep `<id>.credits.txt` and `<id>.credits.csv` next to it.
4. Copy an existing LPC manifest and change `name`. The row map of the downscaled sheets is in [`assets/characters/lpc-rows.md`](../assets/characters/lpc-rows.md).
5. Add the character's section to `assets/CREDITS.md`.

## Station manifest

```jsonc
// assets/stations/anvil.json
{
  "name": { "en": "Anvil" },
  "image": "stations/anvil.png", // relative to assets/
  "frame": { "width": 64, "height": 80 },
  "columns": 8, // frames per row of the sheet
  "frames": 35,
  "fps": 12,
  "anchor": { "x": 32, "y": 78 }, // pixel placed on the station's `at` point in the map
  "emit": { "x": 28, "y": 46 }, // where the particles come out
  "effect": "sparks",
}
```

| Field           | Default              | Meaning                                                                       |
| --------------- | -------------------- | ----------------------------------------------------------------------------- |
| `origin`        | `{ "x": 0, "y": 0 }` | top-left corner of frame 0, to crop a station out of a bigger sheet           |
| `columns`       | `frames`             | frames per row; frames are read row by row                                    |
| `frames`, `fps` | `1`                  | a static station has one frame                                                |
| `emit`          | top center           | particle origin inside the frame                                              |
| `effect`        | required             | `bubbles`, `sparks`, `magic`, `smoke`, `dust`, `embers`, `sawdust` or `paper` |

Crop stations tightly: the `frame` box is what the map has to make room for. For example, the anvil sheet has 64 × 80 cells, but the anvil itself only uses rows 17 to 78, so its manifest says `"origin": { "x": 0, "y": 17 }`, `"frame": { "width": 64, "height": 62 }` and `"cell": { "width": 64, "height": 80 }`.

Stations are furniture of the map, not of a character. Each agent takes a random free station when it joins. The station shows frame 0 while nobody works there. It animates and emits particles only while its agent works at it.

## Workshop map

`assets/maps/workshop.json` holds the geometry and the scenery. All coordinates are world pixels.

```jsonc
{
  "width": 640,
  "height": 352,
  "tileSize": 16,
  "floor": "#6b4a2f", // fallback color under the scenery
  "stations": [/* at least 8, one per agent */],
  "obstacles": [/* rectangles nobody walks through */],
  "spots": [/* where agents read, nap and spend idle time */],
  "scenery": [/* drawn in order */],
  "embers": [{ "x": 320, "y": 72 }], // points that always emit embers (the fireplace)
}
```

Each station places a station manifest in the room:

```json
{ "id": "anvil", "at": { "x": 64, "y": 150 }, "work": { "x": 106, "y": 148 } }
```

| Field  | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| `id`   | the station manifest, `assets/stations/<id>.json`               |
| `at`   | where the manifest's `anchor` is placed                         |
| `work` | where the agent stands while it works there, facing the station |

The same id can appear more than once. Add an obstacle under the bottom of every station so people walk around it instead of through it.

### Obstacles and walking

Agents walk on a grid of 8 px cells. A cell is blocked when any rectangle in `obstacles` touches it, so cover the walls, the edges of the room, the stations and the feet of the furniture. Leave the rest free: agents wander over every open cell when they are idle, and find their way around the blocked ones.

Keep `work` points and spots on open cells. A spot may sit on a bed or a rug that is not an obstacle; the agent walks to the nearest open cell and steps onto it.

### Spots

```json
{ "kind": "nap", "at": { "x": 563, "y": 250 }, "facing": "south" }
```

| `kind`   | Used when                                                            |
| -------- | -------------------------------------------------------------------- |
| `read`   | the agent reads files or waits for your approval; idle agents browse |
| `nap`    | the agent is starting, sleeping or offline; idle agents take a nap   |
| `hearth` | an idle agent warms up by the fire                                   |
| `table`  | an idle agent sits at the table                                      |

An idle agent keeps busy on its own: it wanders, visits the hearth, a bookshelf or the table, naps, or walks over to chat with another idle agent. The choice is weighted and avoids repeating the last plan; plans whose spots are all taken are skipped.

`facing` is `north`, `west`, `south` or `east` (default `south`). Each spot holds one agent. When all `read` or `nap` spots are taken, a busy agent stays at its station.

### Scenery

Scenery items are either a color fill:

```json
{ "color": "#1d1410", "area": { "x": 0, "y": 0, "width": 640, "height": 24 } }
```

or a crop of a sheet in `assets/`. Use `repeat` to tile it over an area and `flip` to mirror it:

```json
{
  "image": "tiles/interior-walls.png",
  "source": { "x": 320, "y": 96, "width": 16, "height": 48 },
  "at": { "x": 0, "y": 32 },
  "repeat": { "width": 640, "height": 48 }
}
```

Scenery without `depth` is drawn first, behind everyone: floors, walls, rugs. Give standing furniture a `depth`, usually the y of its feet, so it is sorted with the stations and the adventurers. Everything sorted is drawn by its feet, so someone standing behind a bookshelf is drawn behind it.

## Checking your changes

`npm test` includes `src/web/game/workshop-assets.test.ts`, which checks the shipped files:

- every character and station manifest is valid;
- every referenced sheet exists and every frame fits inside it;
- the map has a known station for every agent, each inside the world and on its own obstacle;
- every `work` point and spot can be reached from every station;
- every scenery crop fits its sheet.

To see the result, run `npm run dev` and open the page with `?demo` to get a workshop full of fake adventurers.
