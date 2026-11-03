import type { Item } from "../model.js";

/** Når samme id kommer fra flere kilder, foretrekkes kilden med lavest indeks. */
const SOURCE_PREFERENCE = ["pubmed", "clinicaltrials", "europepmc", "rss"];

export interface Hit {
  item: Item;
  priority: number;
}

/**
 * Slår sammen treff med samme id (fra ulike spørringer/kilder). Beholder posten fra
 * foretrukket kilde, men fyller inn manglende abstract/DOI fra de andre, og beholder
 * beste (laveste) prioritet.
 */
export function mergeHits(hits: Hit[]): Hit[] {
  const byId = new Map<string, Hit>();
  for (const hit of hits) {
    const existing = byId.get(hit.item.id);
    if (!existing) {
      byId.set(hit.item.id, { item: { ...hit.item }, priority: hit.priority });
      continue;
    }
    const rank = (i: Item) => SOURCE_PREFERENCE.indexOf(i.source);
    const [winner, other] =
      rank(hit.item) < rank(existing.item) ? [hit.item, existing.item] : [existing.item, hit.item];
    byId.set(hit.item.id, {
      item: {
        ...winner,
        abstract: winner.abstract ?? other.abstract,
        doi: winner.doi ?? other.doi,
      },
      priority: Math.min(existing.priority, hit.priority),
    });
  }
  // Fjern undefined-felt som spredningen over kan ha introdusert.
  return [...byId.values()].map((h) => ({
    ...h,
    item: Object.fromEntries(
      Object.entries(h.item).filter(([, v]) => v !== undefined),
    ) as unknown as Item,
  }));
}
