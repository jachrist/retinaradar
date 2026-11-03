import { z } from "zod";

const base = {
  id: z.string().regex(/^[a-z0-9-]+$/, "id kan kun inneholde a-z, 0-9 og bindestrek"),
  priority: z.number().int().min(1).max(5).default(3),
  enabled: z.boolean().default(true),
};

export const TrialQuerySchema = z
  .object({
    cond: z.string().min(1).optional(),
    term: z.string().min(1).optional(),
    overallStatus: z.array(z.string().regex(/^[A-Z_]+$/)).optional(),
  })
  .refine((q) => q.cond ?? q.term, "Minst én av cond/term må være satt");

export const QuerySchema = z.discriminatedUnion("source", [
  z.object({ ...base, source: z.literal("pubmed"), query: z.string().min(1) }),
  z.object({ ...base, source: z.literal("europepmc"), query: z.string().min(1) }),
  z.object({ ...base, source: z.literal("clinicaltrials"), query: TrialQuerySchema }),
]);

export const QueriesFileSchema = z.object({
  queries: z.array(QuerySchema),
});

export const ProfileSchema = z.object({
  genes: z
    .array(z.string().regex(/^[A-Za-z0-9-]+$/, "Gensymbol kan kun inneholde bokstaver, tall og -"))
    .default([]),
  diagnosis: z.string().optional(),
  /** Landkoder (ISO 3166-1 alpha-2) eller "EU" for å fremheve studiesteder. */
  regions: z.array(z.string()).default([]),
});

export type Query = z.infer<typeof QuerySchema>;
export type TrialQuery = z.infer<typeof TrialQuerySchema>;
export type Profile = z.infer<typeof ProfileSchema>;
