import { RestError, TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
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

/** Tilkobling: tilkoblingsstreng (Azurite lokalt) eller konto-URL med managed identity. */
export type TableTarget = { connectionString: string } | { accountUrl: string };

/**
 * «Sett»-register i Azure Table Storage. Lokalt brukes tilkoblingsstreng
 * ("UseDevelopmentStorage=true" for Azurite). I Azure brukes konto-URL
 * (https://<konto>.table.core.windows.net) og DefaultAzureCredential, dvs. funksjonsappens
 * managed identity, som trenger rollen «Storage Table Data Contributor».
 */
export class TableSeenStore implements SeenStore {
  private constructor(
    private readonly seen: TableClient,
    private readonly state: TableClient,
  ) {}

  /** @param tablePrefix Tabellnavn blir `<prefix>Seen` og `<prefix>State` (kun bokstaver/tall). */
  static async create(target: TableTarget, tablePrefix = DEFAULT_PREFIX): Promise<TableSeenStore> {
    const client = (table: string): TableClient => {
      if ("accountUrl" in target) {
        return new TableClient(target.accountUrl, table, new DefaultAzureCredential());
      }
      const allowInsecureConnection = target.connectionString.includes("UseDevelopmentStorage");
      return TableClient.fromConnectionString(target.connectionString, table, {
        allowInsecureConnection,
      });
    };
    const seen = client(`${tablePrefix}Seen`);
    const state = client(`${tablePrefix}State`);
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
