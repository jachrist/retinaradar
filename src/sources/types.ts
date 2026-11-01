import type { Query } from "../config/schema.js";
import type { Item, Source } from "../model.js";

export interface FetchWindow {
  /** Inklusiv nedre grense. */
  since: Date;
  /** Inklusiv øvre grense. */
  until: Date;
}

export type FetchFn = typeof fetch;

export interface SourceAdapter<Q extends Query = Query> {
  source: Source;
  fetchNew(query: Q, window: FetchWindow): Promise<Item[]>;
}
