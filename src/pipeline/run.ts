import type { Query } from "../config/schema.js";
import type { Digest } from "../notify/digest.js";
import { buildDigest } from "../notify/digest.js";
import type { Notifier } from "../notify/notifier.js";
import type { AdapterRegistry } from "../sources/index.js";
import { runQuery } from "../sources/index.js";
import type { FetchWindow } from "../sources/types.js";
import type { SeenStore } from "../storage/seenStore.js";
import { mergeHits, type Hit } from "./dedupe.js";
import type { Finding, SourceFailure } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface RunOptions {
  queries: Query[];
  skippedQueries?: { id: string; reason: string }[];
  adapters: AdapterRegistry;
  store: SeenStore;
  notifier: Notifier;
  log: Logger;
  now?: Date;
  overlapDays: number;
  firstRunDays: number;
  maxLookbackDays: number;
  sendEmptyDigest: boolean;
  /** Hent og bygg varsel, men ikke send og ikke marker noe som sett. */
  dryRun?: boolean;
  /** Overstyr nedre datogrense (f.eks. for testing). */
  since?: Date;
}

export interface RunResult {
  window: { since: string; until: string };
  fetched: number;
  findings: number;
  failures: SourceFailure[];
  sent: boolean;
  dryRun: boolean;
  digest: Digest;
}

export function computeWindow(
  now: Date,
  lastRun: Date | undefined,
  o: Pick<RunOptions, "overlapDays" | "firstRunDays" | "maxLookbackDays" | "since">,
): FetchWindow {
  const earliest = new Date(now.getTime() - o.maxLookbackDays * DAY_MS);
  let since: Date;
  if (o.since) since = o.since;
  else if (lastRun) since = new Date(lastRun.getTime() - o.overlapDays * DAY_MS);
  else since = new Date(now.getTime() - o.firstRunDays * DAY_MS);
  if (!o.since && since < earliest) since = earliest;
  return { since, until: now };
}

export async function runPipeline(o: RunOptions): Promise<RunResult> {
  const now = o.now ?? new Date();
  const dryRun = o.dryRun ?? false;
  const lastRun = await o.store.getLastSuccessfulRun();
  const window = computeWindow(now, lastRun, o);
  o.log.info(
    `Henter ${o.queries.length} spørringer, ${window.since.toISOString()} – ${window.until.toISOString()}` +
      (dryRun ? " (dry run)" : ""),
  );
  for (const s of o.skippedQueries ?? []) o.log.info(`Hopper over ${s.id}: ${s.reason}`);

  // 1. Hent fra alle kilder. Én kilde som feiler stopper ikke de andre.
  const hits: Hit[] = [];
  const failures: SourceFailure[] = [];
  for (const q of o.queries) {
    try {
      const items = await runQuery(o.adapters, q, window);
      o.log.info(`${q.id}: ${items.length} treff`);
      hits.push(...items.map((item) => ({ item, priority: q.priority })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      o.log.error(`${q.id} feilet: ${message}`);
      failures.push({ queryId: q.id, source: q.source, message });
    }
  }

  // 2. Slå sammen duplikater og sammenlign med «sett»-registeret.
  const merged = mergeHits(hits);
  const seen = await o.store.getMany(merged.map((h) => h.item.id));
  const findings: Finding[] = [];
  for (const { item, priority } of merged) {
    const prev = seen.get(item.id);
    if (!prev) {
      findings.push({ item, kind: "new", priority });
    } else if (item.trial?.status && prev.status && prev.status !== item.trial.status) {
      findings.push({ item, kind: "status_changed", priority, previousStatus: prev.status });
    }
  }
  o.log.info(`${merged.length} unike treff, ${findings.length} nye/endrede`);

  // 3. Varsle, og marker som sett først etter vellykket sending.
  const digest = buildDigest(findings, failures, now);
  let sent = false;
  if (!dryRun) {
    if (findings.length > 0 || o.sendEmptyDigest || failures.length > 0) {
      await o.notifier.send(digest);
      sent = true;
    }
    await o.store.markSeen(
      findings.map(({ item }) => ({
        id: item.id,
        source: item.source,
        firstSeen: seen.get(item.id)?.firstSeen ?? now.toISOString(),
        ...(item.trial?.status ? { status: item.trial.status } : {}),
      })),
    );
    // Ved feil flyttes ikke «siste vellykkede kjøring», så neste vindu dekker hullet.
    if (failures.length === 0) await o.store.setLastSuccessfulRun(now);
  } else {
    await o.notifier.preview?.(digest);
  }

  return {
    window: { since: window.since.toISOString(), until: window.until.toISOString() },
    fetched: hits.length,
    findings: findings.length,
    failures,
    sent,
    dryRun,
    digest,
  };
}
