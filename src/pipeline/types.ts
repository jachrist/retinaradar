import type { Item } from "../model.js";

export type FindingKind = "new" | "status_changed";

export interface Finding {
  item: Item;
  kind: FindingKind;
  /** Prioriteten (1 = høyest) til den beste spørringen som fant treffet. */
  priority: number;
  /** Forrige studiestatus når kind = "status_changed". */
  previousStatus?: string;
}

export interface SourceFailure {
  queryId: string;
  source: string;
  message: string;
}
