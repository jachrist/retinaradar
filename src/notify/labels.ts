/** Norske visningsnavn for verdier fra kildene. */

const STATUS: Record<string, string> = {
  RECRUITING: "Rekrutterer",
  NOT_YET_RECRUITING: "Ikke startet rekruttering",
  ENROLLING_BY_INVITATION: "Rekrutterer etter invitasjon",
  ACTIVE_NOT_RECRUITING: "Pågår, rekrutterer ikke",
  COMPLETED: "Fullført",
  SUSPENDED: "Midlertidig stanset",
  TERMINATED: "Avsluttet før tiden",
  WITHDRAWN: "Trukket",
  UNKNOWN: "Ukjent status",
};

export function statusLabel(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return STATUS[status] ?? status;
}

export function phaseLabel(phase: string | undefined): string | undefined {
  if (!phase) return undefined;
  const parts = phase
    .split("/")
    .map((p) => (p === "EARLY_PHASE1" ? "tidlig 1" : p.replace(/^PHASE/, "")));
  return `Fase ${parts.join("/")}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  pubmed: "PubMed",
  europepmc: "Europe PMC",
  clinicaltrials: "ClinicalTrials.gov",
  rss: "Nyhetsstrøm",
};

const NORWEGIAN_COUNTRY: Record<string, string> = {
  Norway: "Norge",
  Sweden: "Sverige",
  Denmark: "Danmark",
  Finland: "Finland",
  Iceland: "Island",
  Germany: "Tyskland",
  France: "Frankrike",
  Netherlands: "Nederland",
  "United Kingdom": "Storbritannia",
  "United States": "USA",
  Spain: "Spania",
  Italy: "Italia",
  Belgium: "Belgia",
  Switzerland: "Sveits",
};

const CODE_TO_COUNTRY: Record<string, string> = {
  NO: "Norway",
  SE: "Sweden",
  DK: "Denmark",
  FI: "Finland",
  IS: "Iceland",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  GB: "United Kingdom",
  UK: "United Kingdom",
  US: "United States",
  ES: "Spain",
  IT: "Italy",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  IE: "Ireland",
  PL: "Poland",
  PT: "Portugal",
  CZ: "Czechia",
};

/** EU/EØS + Sveits og Storbritannia, slik de skrives i ClinicalTrials.gov. */
const EUROPE = [
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czechia",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Iceland",
  "Ireland",
  "Italy",
  "Latvia",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Norway",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
  "Switzerland",
  "United Kingdom",
];

/** Gjør profilens regionkoder (f.eks. ["NO","SE","EU"]) om til landnavn som i studiedata. */
export function regionsToCountries(regions: string[]): Set<string> {
  const out = new Set<string>();
  for (const r of regions) {
    const code = r.trim().toUpperCase();
    if (code === "EU" || code === "EUROPE") EUROPE.forEach((c) => out.add(c));
    else if (CODE_TO_COUNTRY[code]) out.add(CODE_TO_COUNTRY[code]);
  }
  return out;
}

export function countryLabel(country: string): string {
  return NORWEGIAN_COUNTRY[country] ?? country;
}

/** dd.mm.åååå fra ISO-dato; returnerer input uendret hvis den ikke kan tolkes. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const ym = /^(\d{4})-(\d{2})$/.exec(iso);
  return ym ? `${ym[2]}.${ym[1]}` : iso;
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
