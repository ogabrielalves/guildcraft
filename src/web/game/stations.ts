export const EFFECTS = [
  'bubbles',
  'sparks',
  'magic',
  'smoke',
  'dust',
  'embers',
  'sawdust',
  'paper',
] as const;
export type Effect = (typeof EFFECTS)[number];

export const LIGHTS = {
  hearth: '#ff9a3c',
  window: '#9fc3ff',
  orange: '#ff8a2a',
  violet: '#b07cff',
  yellow: '#ffd76a',
} as const;

export interface StationProfile {
  effect: Effect;
  light: string;
}

const PROFILES = new Map<string, StationProfile>(
  Object.entries({
    mortis: { effect: 'magic', light: LIGHTS.violet },
    corvin: { effect: 'dust', light: LIGHTS.yellow },
    lyra: { effect: 'smoke', light: LIGHTS.yellow },
    aldwin: { effect: 'bubbles', light: LIGHTS.violet },
    brom: { effect: 'sparks', light: LIGHTS.yellow },
    seren: { effect: 'embers', light: LIGHTS.orange },
    oren: { effect: 'bubbles', light: LIGHTS.violet },
    faelan: { effect: 'sawdust', light: LIGHTS.yellow },
    amara: { effect: 'paper', light: LIGHTS.yellow },
  }),
);

export const DEFAULT_STATION: StationProfile = { effect: 'dust', light: LIGHTS.yellow };

export function stationOf(skin: string): StationProfile {
  return PROFILES.get(skin) ?? DEFAULT_STATION;
}
