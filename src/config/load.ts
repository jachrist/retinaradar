import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ProfileSchema, QueriesFileSchema, type Profile, type Query } from "./schema.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

const GENE_PLACEHOLDER = "{GENE}";

function parseWith<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ConfigError(`Ugyldig ${label}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

async function readJson(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file} er ikke gyldig JSON: ${(err as Error).message}`);
  }
}

export function parseQueries(data: unknown): Query[] {
  return parseWith(QueriesFileSchema, data, "queries.json").queries;
}

export function parseProfile(data: unknown): Profile {
  return parseWith(ProfileSchema, data, "profil");
}

export interface LoadedConfig {
  queries: Query[];
  /** Undefined hvis verken PROFILE_JSON eller config/profile.json finnes. */
  profile: Profile | undefined;
}

/**
 * Leser config/queries.json og profilen. Profilen kan komme fra miljøvariabelen
 * PROFILE_JSON (nyttig i Azure, der filen ikke deployes) eller fra config/profile.json.
 */
export async function loadConfig(
  configDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedConfig> {
  const queriesData = await readJson(path.join(configDir, "queries.json"));
  if (queriesData === undefined) {
    throw new ConfigError(`Fant ikke ${path.join(configDir, "queries.json")}`);
  }
  const queries = parseQueries(queriesData);

  let profileData: unknown;
  if (env.PROFILE_JSON) {
    try {
      profileData = JSON.parse(env.PROFILE_JSON);
    } catch (err) {
      throw new ConfigError(`PROFILE_JSON er ikke gyldig JSON: ${(err as Error).message}`);
    }
  } else {
    profileData = await readJson(path.join(configDir, "profile.json"));
  }
  const profile = profileData === undefined ? undefined : parseProfile(profileData);
  return { queries, profile };
}

function containsPlaceholder(query: Query): boolean {
  const text = typeof query.query === "string" ? query.query : JSON.stringify(query.query);
  return text.includes(GENE_PLACEHOLDER);
}

function replaceGene<T>(value: T, gene: string): T {
  if (typeof value === "string") return value.replaceAll(GENE_PLACEHOLDER, gene) as T;
  if (Array.isArray(value)) return value.map((v) => replaceGene(v, gene)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceGene(v, gene)]),
    ) as T;
  }
  return value;
}

export interface ExpandedQueries {
  queries: Query[];
  /** ID-er til spørringer som ble hoppet over, med begrunnelse. */
  skipped: { id: string; reason: string }[];
}

/**
 * Filtrerer bort deaktiverte spørringer og erstatter {GENE} med hvert gen i profilen
 * (én spørring per gen, id "<id>-<gen>"). Spørringer med {GENE} hoppes over uten gener.
 */
export function expandQueries(queries: Query[], profile: Profile | undefined): ExpandedQueries {
  const out: Query[] = [];
  const skipped: ExpandedQueries["skipped"] = [];
  const genes = profile?.genes ?? [];

  for (const q of queries) {
    if (!q.enabled) {
      skipped.push({ id: q.id, reason: "deaktivert" });
      continue;
    }
    if (!containsPlaceholder(q)) {
      out.push(q);
      continue;
    }
    if (genes.length === 0) {
      skipped.push({ id: q.id, reason: "ingen gener i profilen" });
      continue;
    }
    for (const gene of genes) {
      out.push({ ...replaceGene(q, gene), id: `${q.id}-${gene.toLowerCase()}` });
    }
  }
  return { queries: out, skipped };
}
