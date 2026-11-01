import { RestError, TableClient } from "@azure/data-tables";
import { toKeys } from "./keys.js";
import type { SeenRecord, SeenStore } from "./seenStore.js";

const DEFAULT_PREFIX = "Retinaradar";
const STATE_KEY = { partitionKey: "run", rowKey: "lastSuccessful" };
const CONCURRENCY = 16;

interface SeenEntity {
  partitionKey: string;
  rowKey: string;
  source: string;
  firstSeen: string;
  status?: string;
}

async function inChunks<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof RestError && err.statusCode === 404;
}

/**
 * «Sett»-register i Azure Table Storage. Bruker tilkoblingsstreng (Azurite lokalt:
 * "UseDevelopmentStorage=true"). Managed identity legges til når vi deployer.
 */
export class TableSeenStore implements SeenStore {
  private constructor(
    private readonly seen: TableClient,
    private readonly state: TableClient,
  ) {}

  /** @param tablePrefix Tabellnavn blir `<prefix>Seen` og `<prefix>State` (kun bokstaver/tall). */
  static async create(
    connectionString: string,
    tablePrefix = DEFAULT_PREFIX,
  ): Promise<TableSeenStore> {
    const opts = { allowInsecureConnection: connectionString.includes("UseDevelopmentStorage") };
    const seen = TableClient.fromConnectionString(connectionString, `${tablePrefix}Seen`, opts);
    const state = TableClient.fromConnectionString(connectionString, `${tablePrefix}State`, opts);
    await Promise.all([seen.createTable(), state.createTable()]);
    return new TableSeenStore(seen, state);
  }

  async getMany(ids: string[]): Promise<Map<string, SeenRecord>> {
    const out = new Map<string, SeenRecord>();
    await inChunks([...new Set(ids)], async (id) => {
      const { partitionKey, rowKey } = toKeys(id);
      try {
        const e = await this.seen.getEntity<SeenEntity>(partitionKey, rowKey);
        out.set(id, {
          id,
          source: e.source,
          firstSeen: e.firstSeen,
          ...(e.status ? { status: e.status } : {}),
        });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    });
    return out;
  }

  async markSeen(records: SeenRecord[]): Promise<void> {
    await inChunks(records, async (r) => {
      const entity: SeenEntity = {
        ...toKeys(r.id),
        source: r.source,
        firstSeen: r.firstSeen,
        ...(r.status ? { status: r.status } : {}),
      };
      await this.seen.upsertEntity(entity, "Replace");
    });
  }

  async getLastSuccessfulRun(): Promise<Date | undefined> {
    try {
      const e = await this.state.getEntity<{ value: string }>(
        STATE_KEY.partitionKey,
        STATE_KEY.rowKey,
      );
      return new Date(e.value);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async setLastSuccessfulRun(when: Date): Promise<void> {
    await this.state.upsertEntity({ ...STATE_KEY, value: when.toISOString() }, "Replace");
  }
}
