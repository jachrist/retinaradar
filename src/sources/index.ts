import type { Query } from "../config/schema.js";
import type { Item } from "../model.js";
import { createClinicalTrialsAdapter } from "./clinicaltrials.js";
import { createEuropePmcAdapter } from "./europepmc.js";
import { createPubmedAdapter } from "./pubmed.js";
import type { FetchWindow, SourceAdapter } from "./types.js";

export type AdapterRegistry = {
  [S in Query["source"]]?: SourceAdapter<Extract<Query, { source: S }>>;
};

export function createDefaultAdapters(opts: {
  ncbiApiKey?: string;
  ncbiEmail?: string;
}): AdapterRegistry {
  return {
    pubmed: createPubmedAdapter({ apiKey: opts.ncbiApiKey, email: opts.ncbiEmail }),
    europepmc: createEuropePmcAdapter(),
    clinicaltrials: createClinicalTrialsAdapter(),
  };
}

export function runQuery(
  adapters: AdapterRegistry,
  query: Query,
  window: FetchWindow,
): Promise<Item[]> {
  const adapter = adapters[query.source] as SourceAdapter<Query> | undefined;
  if (!adapter) throw new Error(`Ingen adapter for kilde «${query.source}»`);
  return adapter.fetchNew(query, window);
}
