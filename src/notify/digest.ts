import type { Finding, SourceFailure } from "../pipeline/types.js";

export interface Digest {
  generatedAt: string;
  trials: Finding[];
  publications: Finding[];
  news: Finding[];
  failures: SourceFailure[];
}

const byDateDesc = (a: Finding, b: Finding) => b.item.date.localeCompare(a.item.date);

function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort(
    (a, b) =>
      a.priority - b.priority ||
      // Statusendringer (f.eks. starter rekruttering) før helt nye studier med samme prioritet.
      Number(b.kind === "status_changed") - Number(a.kind === "status_changed") ||
      byDateDesc(a, b),
  );
}

export function buildDigest(findings: Finding[], failures: SourceFailure[], now: Date): Digest {
  return {
    generatedAt: now.toISOString(),
    trials: sortFindings(findings.filter((f) => f.item.type === "trial")),
    publications: sortFindings(
      findings.filter((f) => f.item.type === "article" || f.item.type === "preprint"),
    ),
    news: sortFindings(findings.filter((f) => f.item.type === "news")),
    failures,
  };
}

export function digestSize(d: Digest): number {
  return d.trials.length + d.publications.length + d.news.length;
}
