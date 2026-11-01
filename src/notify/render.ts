import type { Finding } from "../pipeline/types.js";
import { truncate } from "../pipeline/text.js";
import { digestSize, type Digest } from "./digest.js";
import {
  countryLabel,
  formatDate,
  isoWeek,
  phaseLabel,
  SOURCE_LABEL,
  statusLabel,
} from "./labels.js";

export interface RenderOptions {
  /** Land som fremheves og listes først (engelske navn som i ClinicalTrials.gov). */
  highlightCountries?: Set<string>;
  abstractLength?: number;
  maxCountries?: number;
}

export interface RenderedDigest {
  subject: string;
  text: string;
  html: string;
}

const DISCLAIMER =
  "Retina-radar gir informasjon, ikke medisinsk rådgivning. Vurderinger av behandling og " +
  "studiedeltakelse gjøres sammen med behandlende øyelege/genetiker.";

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function subjectFor(d: Digest): string {
  const week = isoWeek(new Date(d.generatedAt));
  const parts: string[] = [];
  if (d.trials.length) parts.push(plural(d.trials.length, "studie", "studier"));
  if (d.publications.length) {
    parts.push(plural(d.publications.length, "publikasjon", "publikasjoner"));
  }
  if (d.news.length) parts.push(plural(d.news.length, "nyhet", "nyheter"));
  const summary = parts.length ? parts.join(", ") : "ingen nye treff";
  const warn = d.failures.length ? " (noen kilder feilet)" : "";
  return `Retina-radar uke ${week}: ${summary}${warn}`;
}

interface Line {
  /** Merkelapp foran tittel, f.eks. «NY» eller «ENDRET STATUS». */
  badge?: string;
  title: string;
  url: string;
  meta: string[];
  countries?: { name: string; highlighted: boolean }[];
  moreCountries?: number;
  abstract?: string;
}

function countriesFor(f: Finding, o: RenderOptions) {
  const all = f.item.trial?.countries ?? [];
  const hl = o.highlightCountries ?? new Set<string>();
  const sorted = [...all].sort((a, b) => Number(hl.has(b)) - Number(hl.has(a)));
  const max = o.maxCountries ?? 8;
  return {
    countries: sorted.slice(0, max).map((c) => ({ name: countryLabel(c), highlighted: hl.has(c) })),
    moreCountries: Math.max(0, sorted.length - max),
  };
}

function toLine(f: Finding, o: RenderOptions): Line {
  const { item } = f;
  const meta: string[] = [SOURCE_LABEL[item.source] ?? item.source];
  if (item.date) meta.push(formatDate(item.date));
  let badge: string | undefined;

  if (item.type === "trial") {
    const phase = phaseLabel(item.trial?.phase);
    const status = statusLabel(item.trial?.status);
    if (phase) meta.push(phase);
    if (status) meta.push(status);
    if (item.trial?.sponsor) meta.push(`Sponsor: ${item.trial.sponsor}`);
    badge =
      f.kind === "status_changed"
        ? `ENDRET STATUS: ${statusLabel(f.previousStatus)} → ${status}`
        : "NY STUDIE";
  } else if (item.type === "preprint") {
    badge = "PREPRINT (ikke fagfellevurdert)";
  }

  const abstract = item.abstract ? truncate(item.abstract, o.abstractLength ?? 350) : undefined;
  return {
    ...(badge ? { badge } : {}),
    title: item.title,
    url: item.url,
    meta,
    ...(item.type === "trial" ? countriesFor(f, o) : {}),
    ...(abstract ? { abstract } : {}),
  };
}

function sections(d: Digest) {
  return [
    { heading: "Kliniske studier", findings: d.trials },
    { heading: "Publikasjoner og preprints", findings: d.publications },
    { heading: "Nyheter fra organisasjoner", findings: d.news },
  ].filter((s) => s.findings.length > 0);
}

export function renderText(d: Digest, o: RenderOptions = {}): string {
  const out: string[] = [subjectFor(d), ""];
  if (digestSize(d) === 0) out.push("Ingen nye treff siden forrige utsending.", "");

  for (const s of sections(d)) {
    out.push(`${s.heading.toUpperCase()} (${s.findings.length})`, "=".repeat(40), "");
    for (const f of s.findings) {
      const l = toLine(f, o);
      if (l.badge) out.push(`[${l.badge}]`);
      out.push(l.title, `  ${l.meta.join(" · ")}`);
      if (l.countries?.length) {
        const names = l.countries.map((c) => (c.highlighted ? `*${c.name}*` : c.name));
        if (l.moreCountries) names.push(`+${l.moreCountries} andre`);
        out.push(`  Land: ${names.join(", ")}`);
      }
      if (l.abstract) out.push(`  ${l.abstract}`);
      out.push(`  ${l.url}`, "");
    }
  }

  if (d.failures.length) {
    out.push("KILDER SOM FEILET", "");
    for (const f of d.failures) out.push(`- ${f.queryId} (${f.source}): ${f.message}`);
    out.push("Treff fra disse hentes på nytt ved neste kjøring.", "");
  }
  out.push("--", DISCLAIMER);
  return out.join("\n");
}

export function renderHtml(d: Digest, o: RenderOptions = {}): string {
  const e = escapeHtml;
  const body: string[] = [`<h1 style="font-size:20px">${e(subjectFor(d))}</h1>`];
  if (digestSize(d) === 0) body.push("<p>Ingen nye treff siden forrige utsending.</p>");

  for (const s of sections(d)) {
    body.push(
      `<h2 style="font-size:17px;margin-top:24px">${e(s.heading)} (${s.findings.length})</h2>`,
    );
    for (const f of s.findings) {
      const l = toLine(f, o);
      const parts: string[] = [];
      if (l.badge) {
        parts.push(
          `<div style="font-size:11px;font-weight:bold;color:#7a4b00;text-transform:uppercase">${e(l.badge)}</div>`,
        );
      }
      parts.push(`<div><a href="${e(l.url)}" style="font-weight:bold">${e(l.title)}</a></div>`);
      parts.push(`<div style="color:#555;font-size:13px">${e(l.meta.join(" · "))}</div>`);
      if (l.countries?.length) {
        const names = l.countries.map((c) => (c.highlighted ? `<b>${e(c.name)}</b>` : e(c.name)));
        if (l.moreCountries) names.push(`+${l.moreCountries} andre`);
        parts.push(`<div style="font-size:13px">Land: ${names.join(", ")}</div>`);
      }
      if (l.abstract) parts.push(`<p style="font-size:14px;margin:4px 0">${e(l.abstract)}</p>`);
      body.push(`<div style="margin:14px 0">${parts.join("\n")}</div>`);
    }
  }

  if (d.failures.length) {
    body.push(`<h2 style="font-size:17px;color:#a00">Kilder som feilet</h2><ul>`);
    for (const f of d.failures) {
      body.push(`<li>${e(f.queryId)} (${e(f.source)}): ${e(f.message)}</li>`);
    }
    body.push("</ul><p>Treff fra disse hentes på nytt ved neste kjøring.</p>");
  }
  body.push(`<hr><p style="color:#777;font-size:12px">${e(DISCLAIMER)}</p>`);

  return `<!DOCTYPE html>
<html lang="no"><head><meta charset="utf-8"><title>${e(subjectFor(d))}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;margin:auto;padding:16px;color:#222">
${body.join("\n")}
</body></html>`;
}

export function renderDigest(d: Digest, o: RenderOptions = {}): RenderedDigest {
  return { subject: subjectFor(d), text: renderText(d, o), html: renderHtml(d, o) };
}
