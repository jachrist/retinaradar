import { ConfigError } from "./load.js";

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string[];
}

export interface Settings {
  tableConnection: string | undefined;
  ncbiApiKey: string | undefined;
  ncbiEmail: string | undefined;
  smtp: SmtpSettings | undefined;
  /** Dager bakover fra forrige vellykkede kjøring som hentes på nytt (dedup fjerner duplikater). */
  overlapDays: number;
  /** Dager bakover ved første kjøring. */
  firstRunDays: number;
  /** Maks antall dager bakover uansett, f.eks. etter lang nedetid. */
  maxLookbackDays: number;
  /** Send e-post også når det ikke er nye treff (livstegn). */
  sendEmptyDigest: boolean;
}

function intSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} må være et heltall ≥ 0`);
  return n;
}

function opt(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function readSmtp(env: NodeJS.ProcessEnv): SmtpSettings | undefined {
  const names = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_TO"] as const;
  const present = names.filter((n) => opt(env, n));
  if (present.length === 0) return undefined;
  const missing = names.filter((n) => !opt(env, n));
  if (missing.length > 0) {
    throw new ConfigError(`SMTP er delvis konfigurert, mangler: ${missing.join(", ")}`);
  }
  const user = opt(env, "SMTP_USER")!;
  return {
    host: opt(env, "SMTP_HOST")!,
    port: intSetting(env, "SMTP_PORT", 465),
    user,
    password: opt(env, "SMTP_PASSWORD")!,
    from: opt(env, "MAIL_FROM") ?? user,
    to: opt(env, "MAIL_TO")!
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    tableConnection: opt(env, "TABLE_STORAGE_CONNECTION"),
    ncbiApiKey: opt(env, "NCBI_API_KEY"),
    ncbiEmail: opt(env, "NCBI_EMAIL"),
    smtp: readSmtp(env),
    overlapDays: intSetting(env, "OVERLAP_DAYS", 14),
    firstRunDays: intSetting(env, "FIRST_RUN_DAYS", 30),
    maxLookbackDays: intSetting(env, "MAX_LOOKBACK_DAYS", 90),
    sendEmptyDigest: (opt(env, "SEND_EMPTY_DIGEST") ?? "true").toLowerCase() !== "false",
  };
}
