/** Komposisjon: setter sammen konfig, kilder, lagring og varsling fra miljøet. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, expandQueries, loadConfig } from "./config/load.js";
import { loadSettings } from "./config/settings.js";
import { regionsToCountries } from "./notify/labels.js";
import { FileNotifier, SmtpNotifier, type Notifier } from "./notify/notifier.js";
import { runPipeline, type Logger, type RunResult } from "./pipeline/run.js";
import { createDefaultAdapters } from "./sources/index.js";
import { MemorySeenStore, type SeenStore } from "./storage/seenStore.js";
import { TableSeenStore } from "./storage/tableStore.js";

/** dist/src/app.js → <rot>/config */
const DEFAULT_CONFIG_DIR = fileURLToPath(new URL("../../config", import.meta.url));

export interface AppOptions {
  log: Logger;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  dryRun?: boolean;
  since?: Date;
  /** Bruk «sett»-register i minnet (ingen Table Storage). Kun for testing. */
  memoryStore?: boolean;
  /** Skriv varselet til fil i stedet for å sende e-post. */
  outDir?: string;
}

export async function runFromEnvironment(o: AppOptions): Promise<RunResult> {
  const env = o.env ?? process.env;
  const settings = loadSettings(env);
  const configDir = o.configDir ?? env.CONFIG_DIR ?? DEFAULT_CONFIG_DIR;
  const { queries, profile } = await loadConfig(configDir, env);
  if (!profile) o.log.warn("Ingen profil funnet (config/profile.json eller PROFILE_JSON).");
  const expanded = expandQueries(queries, profile);

  let store: SeenStore;
  if (o.memoryStore) {
    store = new MemorySeenStore();
  } else if (settings.tableConnection) {
    store = await TableSeenStore.create(settings.tableConnection);
  } else {
    throw new ConfigError(
      "TABLE_STORAGE_CONNECTION mangler. Bruk Azurite lokalt, eller --memory for en testkjøring.",
    );
  }

  const render = { highlightCountries: regionsToCountries(profile?.regions ?? []) };
  let notifier: Notifier;
  if (o.outDir) {
    notifier = new FileNotifier(o.outDir, render, (m) => o.log.info(m));
  } else if (settings.smtp) {
    notifier = new SmtpNotifier(settings.smtp, render);
  } else {
    const outDir = path.resolve("out");
    o.log.warn(`SMTP er ikke konfigurert; varselet skrives til ${outDir}.`);
    notifier = new FileNotifier(outDir, render, (m) => o.log.info(m));
  }

  return runPipeline({
    queries: expanded.queries,
    skippedQueries: expanded.skipped,
    adapters: createDefaultAdapters({
      ncbiApiKey: settings.ncbiApiKey,
      ncbiEmail: settings.ncbiEmail,
    }),
    store,
    notifier,
    log: o.log,
    overlapDays: settings.overlapDays,
    firstRunDays: settings.firstRunDays,
    maxLookbackDays: settings.maxLookbackDays,
    sendEmptyDigest: settings.sendEmptyDigest,
    dryRun: o.dryRun,
    since: o.since,
  });
}
