const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Fjerner HTML/XML-tagger og dekoder vanlige entiteter, normaliserer mellomrom. */
export function cleanText(input: string | undefined | null): string {
  if (!input) return "";
  return (
    input
      // Inline-formatering (kursiv, sub/sup osv.) fjernes uten mellomrom: <i>GUCY2D</i>-related
      .replace(/<\/?(i|b|u|em|strong|sub|sup|span|small)(\s[^>]*)?>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] === "#") {
          const code =
            e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1));
          return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
      })
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:)])/g, "$1")
      .replace(/\(\s+/g, "(")
      .trim()
  );
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + " …";
}

export function normalizeDoi(doi: string | undefined | null): string | undefined {
  if (!doi) return undefined;
  const d = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
  return d.startsWith("10.") ? d : undefined;
}
