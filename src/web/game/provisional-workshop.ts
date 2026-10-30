const STATION_COLUMNS = [48, 128, 208, 288, 368];
const STATION_ROWS = [128, 304];

export function provisionalWorkshop() {
  return {
    width: 480,
    height: 352,
    tileSize: 16,
    stations: STATION_ROWS.flatMap((y) =>
      STATION_COLUMNS.map((x) => ({ id: 'anvil', at: { x, y }, work: { x: x + 28, y } })),
    ),
    obstacles: [
      { x: 0, y: 0, width: 480, height: 80 },
      ...STATION_ROWS.flatMap((y) =>
        STATION_COLUMNS.map((x) => ({ x: x - 16, y: y - 12, width: 32, height: 12 })),
      ),
    ],
    spots: [
      { kind: 'read', at: { x: 440, y: 120 }, facing: 'north' },
      { kind: 'read', at: { x: 440, y: 200 } },
      { kind: 'nap', at: { x: 440, y: 280 } },
      { kind: 'nap', at: { x: 440, y: 320 } },
      { kind: 'hearth', at: { x: 240, y: 200 }, facing: 'north' },
      { kind: 'table', at: { x: 240, y: 240 }, facing: 'east' },
    ],
  };
}
