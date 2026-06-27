import type { Area } from "@/types";

export const AREAS: Area[] = [
  // ── Greater Accra ─────────────────────────────────────────────────────────
  { id: "spintex",       name: "Spintex Road",       region: "Greater Accra", district: "Ledzokuku Municipal",      kw: ["spintex", "baatsona", "community 18"] },
  { id: "adenta",        name: "Adenta · Madina",    region: "Greater Accra", district: "Adentan Municipal",        kw: ["adenta", "madina", "oyarifa", "teiman"] },
  { id: "accra-central", name: "Accra Central",      region: "Greater Accra", district: "Accra Metropolitan",       kw: ["accra central", "circle", "kwame nkrumah", "makola", "high street", "tudu"] },
  { id: "tema",          name: "Tema Motorway",      region: "Greater Accra", district: "Tema Metropolitan",        kw: ["tema", "ashaiman", "motorway", "community"] },
  { id: "kumasi-road",   name: "Kumasi Road",        region: "Greater Accra", district: "Ga West Municipal",        kw: ["kumasi road", "ofankor", "pokuase", "nsawam"] },
  { id: "haatso",        name: "Haatso · Atomic",    region: "Greater Accra", district: "Ga East Municipal",        kw: ["haatso", "atomic", "legon", "east legon", "university"] },
  { id: "liberation",    name: "Liberation Road",    region: "Greater Accra", district: "Accra Metropolitan",       kw: ["liberation", "airport", "labadi", "accra mall"] },
  { id: "ring-road",     name: "Ring Road",          region: "Greater Accra", district: "Accra Metropolitan",       kw: ["ring road", "ministries", "kokomlemle", "asylum down"] },
  { id: "kasoa",         name: "Kasoa Corridor",     region: "Greater Accra", district: "Awutu Senya East Municipal",kw: ["kasoa", "weija", "bortianor", "obom"] },
  { id: "achimota",      name: "Achimota · Ofankor", region: "Greater Accra", district: "Accra Metropolitan",       kw: ["achimota", "ofankor", "achimota forest"] },

  // ── Ashanti ───────────────────────────────────────────────────────────────
  { id: "kumasi-central",name: "Kumasi Central",     region: "Ashanti",       district: "Kumasi Metropolitan",      kw: ["kumasi central", "adum", "kejetia", "central market", "asafo"] },
  { id: "suame",         name: "Suame · Bantama",    region: "Ashanti",       district: "Suame Municipal",          kw: ["suame", "bantama", "manhyia", "roman hill"] },
  { id: "asokwa",        name: "Asokwa · Nhyiaeso",  region: "Ashanti",       district: "Asokwa Municipal",         kw: ["asokwa", "nhyiaeso", "airport roundabout", "sofoline"] },
  { id: "ejisu",         name: "Ejisu · Juaben",     region: "Ashanti",       district: "Ejisu Municipal",          kw: ["ejisu", "juaben", "juaben road", "konongo"] },

  // ── Western ───────────────────────────────────────────────────────────────
  { id: "takoradi",      name: "Takoradi",           region: "Western",       district: "Sekondi-Takoradi Metropolitan", kw: ["takoradi", "market circle", "effia", "kwesimintsim"] },
  { id: "sekondi",       name: "Sekondi",            region: "Western",       district: "Sekondi-Takoradi Metropolitan", kw: ["sekondi", "beach road", "essipon"] },
  { id: "tarkwa",        name: "Tarkwa · Bogoso",    region: "Western",       district: "Tarkwa-Nsuaem Municipal",  kw: ["tarkwa", "bogoso", "prestea"] },

  // ── Central ───────────────────────────────────────────────────────────────
  { id: "cape-coast",    name: "Cape Coast",         region: "Central",       district: "Cape Coast Metropolitan",  kw: ["cape coast", "pedu", "university of cape coast", "ucc", "abura"] },
  { id: "winneba",       name: "Winneba Road",       region: "Central",       district: "Effutu Municipal",         kw: ["winneba", "apam", "saltpond", "mankessim"] },

  // ── Eastern ───────────────────────────────────────────────────────────────
  { id: "koforidua",     name: "Koforidua",          region: "Eastern",       district: "New Juaben South Municipal",kw: ["koforidua", "juaben", "new juaben", "effiduase"] },
  { id: "nkawkaw",       name: "Nkawkaw · Suhum",   region: "Eastern",       district: "Kwahu West Municipal",     kw: ["nkawkaw", "suhum", "kwahu", "atibie"] },

  // ── Northern ──────────────────────────────────────────────────────────────
  { id: "tamale",        name: "Tamale",             region: "Northern",      district: "Tamale Metropolitan",      kw: ["tamale", "bolgatanga road", "savelugu", "sagnerigu"] },
  { id: "yendi",         name: "Yendi Road",         region: "Northern",      district: "Nanumba North Municipal",  kw: ["yendi", "bimbilla", "nanumba"] },

  // ── Upper East ────────────────────────────────────────────────────────────
  { id: "bolgatanga",    name: "Bolgatanga",         region: "Upper East",    district: "Bolgatanga Municipal",     kw: ["bolgatanga", "bolga", "navrongo", "bawku"] },

  // ── Volta ─────────────────────────────────────────────────────────────────
  { id: "ho",            name: "Ho",                 region: "Volta",         district: "Ho Municipal",             kw: ["ho", "volta road", "aflao", "keta", "akatsi"] },
];

export const REGIONS = [...new Set(AREAS.map(a => a.region))].sort();

export function matchAreasFromQuery(from: string, to: string): Area[] {
  const query = `${from} ${to}`.toLowerCase();
  return AREAS.filter(a => a.kw.some(k => query.includes(k)));
}

export function matchAreaFromAddress(address: string): Area | undefined {
  const lower = address.toLowerCase();
  return AREAS.find(a => a.kw.some(k => lower.includes(k)));
}
