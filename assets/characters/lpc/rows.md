# LPC spritesheet row map (Guildcraft)

Generated with the Universal LPC Spritesheet Character Generator on 2026-10-29.
Each `<id>.json` holds the `hash` and `url` needed to recreate the character.

**Scale:** the sheets in this folder were **downscaled to 50% with nearest neighbor** (sampling pixel `2x, 2y`) to match the Pixel Crawler art. The 64 px originals are kept outside the repository. Every measurement below uses the downscaled size.

## Standard area (same for all 6): y = 0–1727, 32x32 frames, 13 columns (416 px)

Each 4-row animation follows the order **N, W, S, E**. `hurt` and `climb` have a single row.
The "frames" column is the number of filled columns, starting at column 0.

| rows  | y (px) | animation      | frames | notes                                                     |
| ----- | ------ | -------------- | ------ | --------------------------------------------------------- |
| 0–3   | 0      | spellcast      | 7      |                                                           |
| 4–7   | 128    | thrust         | 8      |                                                           |
| 8–11  | 256    | walk           | 9      | frame 0 = standing                                        |
| 12–15 | 384    | slash          | 6      |                                                           |
| 16–19 | 512    | shoot          | 13     |                                                           |
| 20    | 640    | hurt           | 6      | single row (falls facing forward)                         |
| 21    | 672    | climb          | 6      | single row (facing away)                                  |
| 22–25 | 704    | idle           | 2      |                                                           |
| 26–29 | 832    | jump           | 5      |                                                           |
| 30–33 | 960    | sit            | 3      | 0 = alternate floor pose · **1 = on the floor** · **2 = on a chair** |
| 34–37 | 1088   | emote          | 3      | **2 = cheering** (arms up)                                |
| 38–41 | 1216   | run            | 8      |                                                           |
| 42–45 | 1344   | combat_idle    | 2      |                                                           |
| 46–49 | 1472   | backslash (1h) | 13     |                                                           |
| 50–53 | 1600   | halfslash (1h) | 6      |                                                           |

## Where the weapon shows up

Large weapons are **not** drawn on the standard thrust/slash rows. The weapon swing lives in the oversize blocks below, and the standard attack rows show the body empty-handed.

| id     | weapon          | visible in the standard area in                                        | oversize block                                          |
| ------ | --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| aldwin | simple staff    | **spellcast**, thrust, walk, hurt                                      | — (416x1728 sheet)                                      |
| brom   | hammer          | walk                                                                   | tool_hammer                                             |
| seren  | longsword       | walk, hurt                                                             | slash_oversize, slash_reverse_oversize, thrust_oversize |
| oren   | gnarled staff   | walk, hurt (not shown in spellcast)                                    | thrust_oversize                                         |
| faelan | bow + quiver    | walk, shoot, hurt (the quiver shows in spellcast/thrust/walk/slash/shoot/hurt) | walk_128                                        |
| amara  | mace            | walk, hurt                                                             | slash_oversize                                          |

## Extra blocks (below y = 1728), order N, W, S, E, 4 rows each

| id     | sheet size | block                  | start y | frame | frames/row | content                                                     |
| ------ | ---------- | ---------------------- | ------- | ----- | ---------- | ----------------------------------------------------------- |
| aldwin | 416x1728   | —                      | —       | —     | —          | —                                                           |
| brom   | 576x1984   | tool_hammer            | 1728    | 64x64 | 9          | hammer strike (slash reversed 5→0, for working at the station) |
| seren  | 768x2880   | slash_oversize         | 1728    | 96x96 | 6          | sword swing                                                 |
| seren  |            | slash_reverse_oversize | 2112    | 96x96 | 6          | backswing                                                   |
| seren  |            | thrust_oversize        | 2496    | 96x96 | 8          | thrust                                                      |
| oren   | 768x2112   | thrust_oversize        | 1728    | 96x96 | 8          | staff strike                                                |
| faelan | 576x1984   | walk_128               | 1728    | 64x64 | 9          | walk with the full bow visible (block name kept from the generator) |
| amara  | 576x2112   | slash_oversize         | 1728    | 96x96 | 6          | mace swing                                                  |

Row of each direction in a block: `y = start_y + dir * frame_size` (dir: N=0, W=1, S=2, E=3).
The character is centered in each 64 or 96 px frame. To align it with the 32 px frame, offset by (64−32)/2 = 16 px or (96−32)/2 = 32 px.
