const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Inline-formatering (HTML og JATS) som fjernes uten mellomrom: <i>GUCY2D</i>-related */
const INLINE_TAG =
  /<\/?(i|b|u|em|strong|sub|sup|span|small|italic|bold|sc|underline|monospace)(\s[^<>]*)?>/gi;
/** Andre tagger (blokk-elementer) erstattes med mellomrom. Krever bokstav rett etter «<»,
 *  slik at tekst som «p < 0.05» ikke tolkes som en tagg. */
const BLOCK_TAG = /<\/?[a-z][\w:-]*(\s[^<>]*)?\/?>/gi;

function stripTags(s: string): string {
  return s.replace(INLINE_TAG, "").replace(BLOCK_TAG, " ");
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Fjerner HTML/XML-tagger og dekoder vanlige entiteter, normaliserer mellomrom. */
export function cleanText(input: string | undefined | null): string {
  if (!input) return "";
  // Tagger fjernes også etter dekoding, fordi noen kilder (Europe PMC) sender dem
  // HTML-kodet: «&lt;i&gt;GENE&lt;/i&gt;».
  return (
    stripTags(decodeEntities(stripTags(input)))
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:)])/g, "$1")
      .replace(/\(\s+/g, "(")
      // «PROM1 -Associated» (mellomrom fra fjernet tagg) → «PROM1-Associated»
      .replace(/(\w) +-(\w)/g, "$1-$2")
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
