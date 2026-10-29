const BAY_COLUMNS = [0, 96, 288, 384];
const BAY_ROWS = [
  { y: 80, doorY: 144 },
  { y: 176, doorY: 176 },
];

function rawBay(x: number, y: number, doorY: number) {
  return {
    area: { x, y, width: 96, height: 64 },
    door: { x: x + 48, y: doorY },
    station: { x: x + 16, y: y + 32 },
    work: { x: x + 40, y: y + 32 },
    read: { x: x + 64, y: y + 24 },
    nap: { x: x + 72, y: y + 48 },
    guest: { x: x + 56, y: y + 52 },
  };
}

export function provisionalWorkshop() {
  return {
    width: 480,
    height: 272,
    tileSize: 16,
    corridorY: 160,
    bays: BAY_ROWS.flatMap(({ y, doorY }) => BAY_COLUMNS.map((x) => rawBay(x, y, doorY))),
  };
}
