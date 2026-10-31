# Assets

Everything the workshop draws comes from `assets/`. The code never hardcodes a sprite, a station or a map coordinate. Add or change art by editing the files described here.

The world is the Tavern Guild, a 944 × 768 px compound at 1× (59 × 48 tiles of 16 px) composed from the Pixel Crawler pack. Characters stand about 30 px tall.

Every asset needs an entry in [`assets/CREDITS.md`](../assets/CREDITS.md) with its author, link and license.

## Layout

```
assets/
├─ characters/<id>/<id>.json    character manifest (the id is the folder name)
├─ characters/<id>/*.png        sheets used by that manifest
├─ stations/<id>.json           station manifest
├─ stations/*.png               station sheets
├─ maps/workshop.json           the workshop map
├─ maps/tavern-guild.png        the map's background art
├─ maps/tavern-guild-front.png  tall props cut out of the background, drawn in front of people
├─ ui/*.png                     nine-slice frames used by the interface
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

When the map's background already shows a station, a manifest is only needed to animate it. Its frame 0 must match the background pixel for pixel at the station's place, so the animation plays on top of the drawing without a seam. The tests check this.

## Workshop map

`assets/maps/workshop.json` holds the geometry and the scenery. All coordinates are world pixels.

```jsonc
{
  "width": 944,
  "height": 768,
  "tileSize": 16,
  "floor": "#2f4a26", // fallback color under the scenery
  "view": { "x": 64, "y": 64, "width": 816, "height": 656 }, // what the camera frames first
  "house": { "x": 104, "y": 104, "width": 736, "height": 448 }, // the building floor; everything outside is drawn slightly darker, and stations, spots, wander points, routes and zones must all sit inside it (the entrance may not)
  "entrance": { "x": 496, "y": 840 }, // where new recruits walk in from
  "collision": ["....##.." /* one string per row of tiles */],
  "obstacles": [/* extra rectangles nobody walks through */],
  "stations": [/* at least 8, one per agent */],
  "spots": [/* where agents read, nap and spend idle time */],
  "wander": [/* points idle agents stroll to */],
  "routes": [/* paths idle agents walk along */],
  "zones": [/* named areas each villager stays in */],
  "scenery": [/* drawn in order */],
  "embers": [{ "x": 630, "y": 192 }], // points that always emit embers (the fireplaces)
}
```

| Field       | Default       | Meaning                                                                                 |
| ----------- | ------------- | --------------------------------------------------------------------------------------- |
| `view`      | the whole map | area the camera fits to the screen on load; wheel zoom and drag pan stay inside the map |
| `entrance`  | none          | an agent that is still starting appears here and walks to its place                     |
| `collision` | none          | the walking grid, see below                                                             |
| `wander`    | `[]`          | points an idle agent picks when it goes for a walk                                      |
| `routes`    | `[]`          | lists of at least two points; an idle agent may walk one from start to end              |

Each station is either a manifest placed in the map or a station already drawn into the background:

```json
{ "id": "anvil", "at": { "x": 1007, "y": 280 }, "work": { "x": 1007, "y": 300 } }
```

```json
{ "effect": "embers", "at": { "x": 946, "y": 186 }, "work": { "x": 946, "y": 228 } }
```

| Field    | Meaning                                                                           |
| -------- | --------------------------------------------------------------------------------- |
| `id`     | the station manifest, `assets/stations/<id>.json`; its `anchor` is placed on `at` |
| `effect` | for a station drawn into the background: its particles, which come out of `at`    |
| `at`     | where the station is; the agent faces it while it works                           |
| `work`   | where the agent stands while it works there                                       |

A station needs `id`, `effect` or both; `effect` overrides the manifest's. The same id can appear more than once.

### Collision and walking

`collision` has one string per row of tiles: `height / tileSize` rows of `width / tileSize` characters, where `#` is blocked and `.` is free. Each blocked tile becomes an obstacle, and `obstacles` can add more rectangles on top.

Agents walk on a grid of 8 px cells. A cell is blocked when any obstacle touches it. Open cells that can't be reached from the largest open area are closed too, so nobody gets stuck in a pocket between trees. Cover the walls, the water, the feet of the furniture and the stations, so people walk around them.

Keep `work` points on open cells. Spots, wander points and route points may sit on a bench, a stump or a bed: the agent walks to the nearest open cell and steps onto it.

The Tavern Guild's grid came with the map and was checked against the image: the forest border, the top rows and the tiles behind the kitchen oven were closed by hand.

### Zones

```json
{ "id": "kitchen", "areas": [{ "x": 112, "y": 112, "width": 224, "height": 208 }] }
```

A zone is a named union of rectangles. A station, spot, wander point or route belongs to the first zone that contains it (a station by its `work` point, a route by its first point). A villager lives in the zone of its station: it walks, idles, wanders, patrols, naps and chats only inside it, on a walking grid cut to the zone's areas. It may leave its zone only to walk in from the `entrance` the first time, and to visit another agent that sent it a message; then it walks straight back home.

The Tavern Guild has five zones: `kitchen`, `storage`, `hall`, `alchemy` and `guild`, all inside the house, and the loader rejects any station, spot, wander point, route or zone outside it. Villagers never stay outside: they only cross the porch to walk in from the `entrance`. The kitchen and the storage room are separate zones because a shelf blocks the passage between them in the art. Without `zones`, villagers walk the whole map. Each zone also has a `sign` point, the fixed spot where the wooden sign with the project folder name hangs while a project lives there (the top-center of the sign; it never moves with the villagers). Without a `sign`, the sign falls back to the station.

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

An idle agent keeps busy on its own: it strolls to a `wander` point or along a `route`, visits the hearth, a bookshelf or the table, naps, or walks over to chat with another idle agent. The choice is weighted and avoids repeating the last plan; plans whose spots are all taken are skipped.

`facing` is `north`, `west`, `south` or `east` (default `south`). Each spot holds one agent. When all `read` or `nap` spots are taken, a busy agent stays at its station.

### Scenery

The Tavern Guild is one image drawn behind everything:

```json
{
  "image": "maps/tavern-guild.png",
  "source": { "x": 0, "y": 0, "width": 944, "height": 768 },
  "at": { "x": 0, "y": 0 }
}
```

Scenery items are either a color fill:

```json
{ "color": "#1d1410", "area": { "x": 0, "y": 0, "width": 640, "height": 24 } }
```

or a crop of a sheet in `assets/`. Use `repeat` to tile it over an area and `flip` to mirror it:

```json
{
  "image": "maps/walls.png",
  "source": { "x": 320, "y": 96, "width": 16, "height": 48 },
  "at": { "x": 0, "y": 32 },
  "repeat": { "width": 640, "height": 48 }
}
```

Scenery without `depth` is drawn first, behind everyone: floors, walls, rugs. Give standing furniture a `depth`, usually the y of its feet, so it is sorted with the stations and the adventurers. Everything sorted is drawn by its feet, so someone standing behind a bookshelf is drawn behind it.

Because the Tavern Guild is one flat image, its tall props (trees, the oven and hoods, shelves, counters, lantern posts, the gallows and so on) are also cut out into `maps/tavern-guild-front.png`. Each one is a scenery crop with the prop's exact silhouette, placed where it already is in the background, with the y of its foot as `depth`. Someone whose feet are above that line walks behind the prop; someone below it walks in front. The crops were made with the map's own builder, so their pixels match the background exactly (the tests check this). Benches stay out, so nappers sit on them, and so do the three stations that already have an animated sprite.

## Interface frames

The side menu is drawn with two crops of the pack, used as CSS nine-slice frames (`border-image`) at 2×, with `image-rendering: pixelated`:

| File                 | Slices (top right bottom left, px) | Used for              |
| -------------------- | ---------------------------------- | --------------------- |
| `ui/slate-frame.png` | 5 6 4 6                            | the side menu's board |
| `ui/wood-button.png` | 4 4 4 4                            | the menu's buttons    |

The slices keep the wooden edges and corners; the flat middle stretches. Keep new frames at integer scales so the pixels stay crisp.

## Checking your changes

`npm test` includes `src/web/game/workshop-assets.test.ts`, which checks the shipped files:

- every character and station manifest is valid;
- every referenced sheet exists and every frame fits inside it;
- the map has a station for every agent, each inside the world with an open `work` point; manifest stations stand on their own obstacle;
- every `work` point, spot, wander point, route point and the entrance can be reached from every station;
- every `work` point, spot, wander point and route lies in a zone, and each route stays in one zone;
- every zone has a station and a spot or wander point, and everything in it can be reached without leaving it;
- the background image has the map's size and the collision grid covers it;
- every station manifest's frame 0 matches the background where it is placed;
- the start view is inside the map;
- every scenery crop fits its sheet.

To see the result, run `npm run dev` and open the page with `?demo` to get a workshop full of fake adventurers.
