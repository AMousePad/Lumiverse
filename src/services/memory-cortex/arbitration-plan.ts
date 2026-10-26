import { isPlausibleAlias } from "./alias-validation";
import { validateArbitrationVerdicts } from "./arbitration";
import type { ArbitrationCanonical, ArbitrationCandidate, ArbitrationVerdict, CortexArbitrationInput } from "./arbitration";
import type { DiscoveredAlias, ExtractedEntity, ExtractedRelationship, MemoryEntity } from "./types";

export interface CortexGraphPlan {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  aliases: DiscoveredAlias[];
}

export interface CortexCleanupAction {
  entityId: string;
  action: "reject" | "resolve";
  targetEntityId?: string;
}

/** Canonical hints and proposals retain identity by ID, never by model-written names. */
export function buildCortexArbitrationPlan(options: {
  passage: string;
  graph: CortexGraphPlan;
  knownEntities: MemoryEntity[];
  characterNames: string[];
  canonicalAliases?: Map<string, string>;
  existingEvidence?: Map<string, string[]>;
  gradeExisting: boolean;
}): { input: CortexArbitrationInput; apply: (verdicts: ArbitrationVerdict[]) => { graph: CortexGraphPlan; cleanup: CortexCleanupAction[] } } {
  const { knownEntities, passage } = options;
  const graph = { ...options.graph, aliases: [...options.graph.aliases] };
  for (const entity of graph.entities) {
    for (const alias of entity.aliases) {
      if (isPlausibleAlias(alias, entity.name) && !graph.aliases.some((a) => a.alias === alias && a.canonicalName === entity.name)) graph.aliases.push({ alias, canonicalName: entity.name });
    }
  }
  const canonicals: ArbitrationCanonical[] = [];
  const canonicalEntityIds = new Map<string, string>();
  const seen = new Set<string>();
  for (const entity of [...knownEntities, ...options.characterNames.map((name) => ({ name, aliases: [], id: undefined })),
    ...graph.entities.filter((e) => !e.provisional).map((e) => ({ name: e.name, aliases: [] as string[], id: undefined }))]) {
    if (seen.has(entity.name.toLowerCase())) continue;
    seen.add(entity.name.toLowerCase());
    const id = `c${canonicals.length}`;
    const aliases = [...entity.aliases, ...[...(options.canonicalAliases ?? [])].filter(([, name]) => name.toLowerCase() === entity.name.toLowerCase()).map(([alias]) => alias)];
    canonicals.push({ id, name: entity.name, aliases: [...new Set(aliases)] });
    if (entity.id) canonicalEntityIds.set(id, entity.id);
  }
  const shortlist = (name: string) => canonicals.filter((c) => c.name.toLowerCase() !== name.toLowerCase())
    .map((c) => ({ c, score: (options.characterNames.includes(c.name) ? 2 : 0)
      + (passage.toLowerCase().includes(c.name.toLowerCase()) ? 2 : 0)
      + (c.aliases.some((a) => a.toLowerCase() === name.toLowerCase()) ? 10 : 0)
      + (name.toLowerCase().split(/\W+/).some((w) => w.length >= 3 && c.name.toLowerCase().includes(w)) ? 4 : 0) }))
    .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 48).map(({ c }) => c.id);
  const cleanupEntities = options.gradeExisting ? knownEntities.filter((e) => e.userEditedAt == null) : [];
  const candidates: ArbitrationCandidate[] = [
    ...graph.entities.map((e, i): ArbitrationCandidate => ({ id: `e${i}`, kind: "entity", name: e.name, type: e.type,
      origin: e.provisional ? "noun_phrase" : "extraction", canonicalIds: shortlist(e.name) })),
    ...graph.relationships.map((r, i): ArbitrationCandidate => ({ id: `r${i}`, kind: "relationship", source: r.source, target: r.target, type: r.type, evidence: [r.label] })),
    ...graph.aliases.map((a, i): ArbitrationCandidate => ({ id: `a${i}`, kind: "alias", source: a.alias, target: a.canonicalName, evidence: a.evidence ? [a.evidence] : [] })),
    ...cleanupEntities.map((e, i): ArbitrationCandidate => ({ id: `x${i}`, kind: "existing", name: e.name, type: e.entityType,
      evidence: options.existingEvidence?.get(e.id) ?? [], canonicalIds: shortlist(e.name).filter((id) => canonicalEntityIds.has(id)) })),
  ];
  return {
    input: { passage, candidates, canonicals },
    apply(verdicts) {
      const byId = new Map(validateArbitrationVerdicts(verdicts, candidates).map((v) => [v.id, v]));
      const renames = new Map<string, string>();
      const aliases: DiscoveredAlias[] = graph.aliases.filter((_, i) => byId.get(`a${i}`)?.action === "keep");
      const entities = graph.entities.flatMap((e, i) => {
        const verdict = byId.get(`e${i}`);
        if (!verdict || verdict.action === "reject" || verdict.action === "defer") return [];
        const canonical = verdict.action === "resolve" ? canonicals.find((c) => c.id === verdict.canonicalId) : undefined;
        if (canonical) {
          renames.set(e.name.toLowerCase(), canonical.name);
          if (isPlausibleAlias(e.name, canonical.name)) aliases.push({ canonicalName: canonical.name, alias: e.name, evidence: "Arbitrated identity in source passage" });
          const known = knownEntities.find((k) => k.name === canonical.name);
          return [{ ...e, name: canonical.name, type: known?.entityType ?? graph.entities.find((target) => target.name === canonical.name)?.type ?? e.type, aliases: canonical.aliases, provisional: false }];
        }
        return [{ ...e, aliases: aliases.filter((a) => a.canonicalName.toLowerCase() === e.name.toLowerCase()).map((a) => a.alias), provisional: false }];
      });
      const uniqueEntities = new Map<string, ExtractedEntity>();
      for (const entity of entities) {
        const prior = uniqueEntities.get(entity.name.toLowerCase());
        uniqueEntities.set(entity.name.toLowerCase(), prior ? { ...entity, aliases: [...new Set([...prior.aliases, ...entity.aliases])], provisional: prior.provisional && entity.provisional } : entity);
      }
      const resolve = (name: string) => renames.get(name.toLowerCase()) ?? name;
      const relationships = graph.relationships.filter((_, i) => byId.get(`r${i}`)?.action === "keep")
        .map((r) => ({ ...r, source: resolve(r.source), target: resolve(r.target) }))
        .filter((r) => r.source.toLowerCase() !== r.target.toLowerCase() && uniqueEntities.has(r.source.toLowerCase()) && uniqueEntities.has(r.target.toLowerCase()));
      const cleanup = cleanupEntities.flatMap((e, i): CortexCleanupAction[] => {
        const verdict = byId.get(`x${i}`);
        if (uniqueEntities.has(e.name.toLowerCase())) return [];
        if (verdict?.action === "reject") return [{ entityId: e.id, action: "reject" }];
        const target = verdict?.canonicalId && canonicalEntityIds.get(verdict.canonicalId);
        return verdict?.action === "resolve" && target && target !== e.id ? [{ entityId: e.id, action: "resolve", targetEntityId: target }] : [];
      });
      return { graph: { entities: [...uniqueEntities.values()], relationships, aliases: aliases.map((a) => ({ ...a, canonicalName: resolve(a.canonicalName) })).filter((a) => uniqueEntities.has(a.canonicalName.toLowerCase())) }, cleanup };
    },
  };
}

/** Legacy passage-wide facts attach only to entities explicitly named in the fact. */
export function attributeFactsToEntities(facts: string[], entities: Array<{ name: string; aliases: string[] }>): Map<string, string[]> {
  const attributed = new Map<string, string[]>();
  for (const fact of facts) {
    for (const entity of entities) {
      const names = [entity.name, ...entity.aliases].filter(Boolean);
      if (!names.some((name) => new RegExp(`(?<![\\p{L}\\p{N}_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu").test(fact))) continue;
      attributed.set(entity.name, [...(attributed.get(entity.name) ?? []), fact]);
    }
  }
  return attributed;
}
