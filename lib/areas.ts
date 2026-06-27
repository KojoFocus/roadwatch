import type { Area } from "@/types";

export const AREAS: Area[] = [
  { id: "spintex",       name: "Spintex Road",      region: "Greater Accra", kw: ["spintex", "baatsona", "community 18"] },
  { id: "adenta",        name: "Adenta · Madina",   region: "Greater Accra", kw: ["adenta", "madina", "oyarifa", "teiman"] },
  { id: "accra-central", name: "Accra Central",     region: "Greater Accra", kw: ["accra central", "circle", "kwame nkrumah", "makola", "high street", "tudu"] },
  { id: "tema",          name: "Tema Motorway",     region: "Greater Accra", kw: ["tema", "ashaiman", "motorway", "community"] },
  { id: "kumasi-road",   name: "Kumasi Road",       region: "Greater Accra", kw: ["kumasi", "ofankor", "pokuase", "nsawam", "suhum"] },
  { id: "haatso",        name: "Haatso · Atomic",   region: "Greater Accra", kw: ["haatso", "atomic", "legon", "east legon", "university"] },
  { id: "liberation",    name: "Liberation Road",   region: "Greater Accra", kw: ["liberation", "airport", "labadi", "accra mall"] },
  { id: "ring-road",     name: "Ring Road",         region: "Greater Accra", kw: ["ring road", "ministries", "kokomlemle", "asylum down"] },
  { id: "kasoa",         name: "Kasoa Corridor",    region: "Central Region", kw: ["kasoa", "weija", "bortianor", "obom"] },
  { id: "achimota",      name: "Achimota · Ofankor",region: "Greater Accra", kw: ["achimota", "ofankor", "achimota forest"] },
];

export function matchAreasFromQuery(from: string, to: string): Area[] {
  const query = `${from} ${to}`.toLowerCase();
  return AREAS.filter(a => a.kw.some(k => query.includes(k)));
}

export function matchAreaFromAddress(address: string): Area | undefined {
  const lower = address.toLowerCase();
  return AREAS.find(a => a.kw.some(k => lower.includes(k)));
}
