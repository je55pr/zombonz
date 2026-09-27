/** The playable maps, as the menu lists them (kept free of geometry so the menu chunk stays small). */
export const MAP_CATALOG = [
  { id: 'bunker', name: 'Bunker', blurb: 'Three rooms and a staircase. Where it all began.' },
  { id: 'asylum', name: 'Asylum', blurb: 'Two divided wings circle an open courtyard.' },
] as const;
export type MapId = typeof MAP_CATALOG[number]['id'];

export function isMapId(value: unknown): value is MapId {
  return MAP_CATALOG.some(map => map.id === value);
}
