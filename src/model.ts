/** Felles datamodell for alle kilder. Se README pkt. 3. */
export type Source = "pubmed" | "europepmc" | "clinicaltrials" | "rss";
export type ItemType = "article" | "preprint" | "trial" | "news";

export interface TrialInfo {
  phase?: string;
  status?: string;
  countries?: string[];
  sponsor?: string;
}

export interface Relevance {
  score: number;
  reason: string;
  category: string;
}

export interface Item {
  /** F.eks. "pmid:12345678", "nct:NCT01234567", "doi:10.1000/xyz". */
  id: string;
  source: Source;
  type: ItemType;
  title: string;
  abstract?: string;
  url: string;
  /** Normalisert DOI (små bokstaver, uten prefiks) når kjent. Brukes til kryss-kilde-matching. */
  doi?: string;
  /** ISO 8601. */
  date: string;
  tags?: string[];
  trial?: TrialInfo;
  relevance?: Relevance;
}
