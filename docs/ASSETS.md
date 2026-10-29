# Assets

Everything the workshop draws comes from `assets/`. The code never hardcodes a sprite, a station or a map coordinate. Add or change art by editing the files described here.

The world is 480 × 272 px at 1×, built on the 16 px grid of the Pixel Crawler pack. Characters stand about 30 px tall.

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
  "station": "anvil", // id of assets/stations/<id>.json
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
4. Copy an existing LPC manifest and change `name` and `station`. The row map of the downscaled sheets is in [`assets/characters/lpc-rows.md`](../assets/characters/lpc-rows.md).
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
  "anchor": { "x": 32, "y": 78 }, // pixel placed on the bay's station point
  "emit": { "x": 28, "y": 46 }, // where the particles come out
  "effect": "sparks",
  "light": "#ffd76a",
}
```

| Field           | Default              | Meaning                                                                       |
| --------------- | -------------------- | ----------------------------------------------------------------------------- |
| `origin`        | `{ "x": 0, "y": 0 }` | top-left corner of frame 0, to crop a station out of a bigger sheet           |
| `columns`       | `frames`             | frames per row; frames are read row by row                                    |
| `frames`, `fps` | `1`                  | a static station has one frame                                                |
| `emit`          | top center           | particle origin inside the frame                                              |
| `effect`        | required             | `bubbles`, `sparks`, `magic`, `smoke`, `dust`, `embers`, `sawdust` or `paper` |
| `light`         | required             | color of the light the station casts, `#rgb`, `#rrggbb` or `#rrggbbaa`        |

Crop stations tightly: the `frame` box is what has to fit inside a bay. For example, the anvil sheet has 64 × 80 cells, but the anvil itself only uses rows 17 to 78, so its manifest says `"origin": { "x": 0, "y": 17 }`, `"frame": { "width": 64, "height": 62 }` and `"cell": { "width": 64, "height": 80 }`.

The station shows frame 0 while its owner is away. It animates, emits particles and lights up only while the owner works at it.

## Workshop map

`assets/maps/workshop.json` holds the geometry, the scenery and the lights. All coordinates are world pixels.

```jsonc
{
  "width": 480,
  "height": 272,
  "tileSize": 16,
  "corridorY": 160, // y of the walkway between the two rows
  "floor": "#6b4a2f", // fallback color under the scenery
  "bays": [/* exactly 8 */],
  "scenery": [/* drawn in order, behind everyone */],
  "lights": [{ "at": { "x": 240, "y": 74 }, "radius": 96, "color": "#ff9a3c", "flicker": 0.08 }],
  "embers": [{ "x": 240, "y": 72 }], // points that always emit embers (the fireplace)
}
```

Each bay has an `area` and six points, all inside the area:

| Point     | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `door`    | where the bay meets the corridor; routes between bays go door → corridor → door |
| `station` | where the station's `anchor` is placed                                          |
| `work`    | where the owner works, facing the station                                       |
| `read`    | where the owner reads or waits for approval                                     |
| `nap`     | where the owner sleeps                                                          |
| `guest`   | where a visitor stops                                                           |

Pillars stand on the left and right edges of every bay and take 8 px of each side. The usable part of a bay is its area minus those 8 px:

- any station, placed by its `anchor` on the `station` point, must fit inside the usable part, because any character can take any bay;
- the `work` point must leave room for the worker (16 px wide) between the station and the pillar;
- when idle, the owner wanders inside the usable part.

Scenery items are either a color fill:

```json
{ "color": "#1d1410", "area": { "x": 0, "y": 0, "width": 480, "height": 24 } }
```

or a crop of a sheet in `assets/`. Use `repeat` to tile it over an area and `flip` to mirror it:

```json
{
  "image": "tiles/interior-walls.png",
  "source": { "x": 320, "y": 96, "width": 16, "height": 48 },
  "at": { "x": 0, "y": 32 },
  "repeat": { "width": 480, "height": 48 }
}
```

Stations and adventurers are sorted by their feet, so someone standing behind a station is drawn behind it.

## Checking your changes

`npm test` includes `src/web/game/workshop-assets.test.ts`, which checks the shipped files:

- every character and station manifest is valid;
- every referenced sheet exists and every frame fits inside it;
- every station a character names exists;
- the map has 8 bays and every scenery crop fits its sheet;
- every station fits every bay without crossing a pillar or an edge, with the worker beside it.

To see the result, run `npm run dev` and open the page with `?demo` to get a workshop full of fake adventurers.
