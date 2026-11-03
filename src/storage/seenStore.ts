export interface SeenRecord {
  id: string;
  source: string;
  /** ISO 8601. */
  firstSeen: string;
  /** Siste kjente studiestatus (kun kliniske studier), for å oppdage statusendringer. */
  status?: string;
}

export interface SeenStore {
  /** Henter kjente poster for gitte id-er. Ukjente id-er er ikke med i resultatet. */
  getMany(ids: string[]): Promise<Map<string, SeenRecord>>;
  /** Lagrer/oppdaterer poster (upsert). */
  markSeen(records: SeenRecord[]): Promise<void>;
  getLastSuccessfulRun(): Promise<Date | undefined>;
  setLastSuccessfulRun(when: Date): Promise<void>;
}

export class MemorySeenStore implements SeenStore {
  readonly records = new Map<string, SeenRecord>();
  lastRun: Date | undefined;

  async getMany(ids: string[]): Promise<Map<string, SeenRecord>> {
    const out = new Map<string, SeenRecord>();
    for (const id of ids) {
      const r = this.records.get(id);
      if (r) out.set(id, { ...r });
    }
    return out;
  }

  async markSeen(records: SeenRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, { ...r });
  }

  async getLastSuccessfulRun(): Promise<Date | undefined> {
    return this.lastRun;
  }

  async setLastSuccessfulRun(when: Date): Promise<void> {
    this.lastRun = when;
  }
}
