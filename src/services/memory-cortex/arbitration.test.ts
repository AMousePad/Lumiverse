import { describe, expect, test } from "bun:test";
import { arbitrateCortexCandidates, buildArbitrationBatches, validateArbitrationVerdicts, type CortexArbitrationInput } from "./arbitration";
import { attributeFactsToEntities, buildCortexArbitrationPlan } from "./arbitration-plan";
import { DEFAULT_CORTEX_CONFIG, normalizeCortexConfig } from "./config";
import { getCortexStructuralSignature } from "./index";

const input: CortexArbitrationInput = { passage: "Mara, known as Red, promised to protect Tovin.", canonicals: [{ id: "c0", name: "Mara", aliases: ["Red"] }], candidates: [
  { id: "e0", kind: "entity", name: "Red", canonicalIds: ["c0"] },
  { id: "e1", kind: "entity", name: "Tovin" },
] };

describe("Cortex arbitration contract", () => {
  test("pages every candidate including candidates beyond old prompt caps", () => {
    const candidates = Array.from({ length: 257 }, (_, i) => ({ id: `e${i}`, kind: "entity" as const, name: `Name${i}` }));
    const batches = buildArbitrationBatches({ ...input, candidates });
    expect(batches).toHaveLength(9);
    expect(batches.flatMap((b) => Object.keys(b.questions))).toEqual(candidates.map((c) => c.id));
    expect(() => buildArbitrationBatches({ ...input, passage: "x".repeat(900_000) })).toThrow("budget");
  });
  test("rejects missing, duplicate, foreign and invented-target verdicts", () => {
    for (const verdicts of [[], [{ id: "e0", action: "keep" }, { id: "e0", action: "keep" }],
      [{ id: "e0", action: "resolve", canonicalId: "invented" }, { id: "e1", action: "keep" }],
      [{ id: "foreign", action: "reject" }, { id: "e1", action: "keep" }]]) {
      expect(() => validateArbitrationVerdicts(verdicts, input.candidates)).toThrow();
    }
  });
  test("an incomplete legacy reviewer fails over without accepting omitted candidates", async () => {
    const config = normalizeCortexConfig({ ...DEFAULT_CORTEX_CONFIG, queryGeneration: {
      primary: { connectionProfileId: "bad", model: "bad" }, secondary: { connectionProfileId: "good", model: "good" },
    } });
    const calls: string[] = [];
    const result = await arbitrateCortexCandidates({ userId: "test", config, input, generate: async (options) => {
      calls.push(options.connectionId);
      return { content: JSON.stringify({ verdicts: options.connectionId === "bad" ? [] : [
        { id: "e0", action: "resolve", canonicalId: "c0" }, { id: "e1", action: "keep" },
      ] }) };
    } });
    expect(calls).toEqual(["bad", "good"]);
    expect(result.verdicts[0]?.canonicalId).toBe("c0");
  });
  test("a cancelled review does not invoke fallback", async () => {
    const controller = new AbortController();
    const config = normalizeCortexConfig({ ...DEFAULT_CORTEX_CONFIG, queryGeneration: {
      primary: { connectionProfileId: "primary", model: null }, secondary: { connectionProfileId: "fallback", model: null },
    } });
    let calls = 0;
    await expect(arbitrateCortexCandidates({ userId: "test", config, input, signal: controller.signal, generate: async () => {
      calls++; controller.abort(); return { content: "{}" };
    } })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  test("legacy configs remain optional and relevant settings invalidate warmup", () => {
    const config = normalizeCortexConfig({ enabled: true });
    expect(config.sidecarReliability.arbitratesHeuristics).toBe(false);
    expect(config.arbitration.backend).toBe("sidecar");
    const enabled = { ...config, sidecarReliability: { ...config.sidecarReliability, arbitratesHeuristics: true } };
    const signature = getCortexStructuralSignature(enabled);
    expect(getCortexStructuralSignature({ ...enabled, arbitration: { ...enabled.arbitration, backend: "decision" } })).not.toBe(signature);
    expect(getCortexStructuralSignature({ ...enabled, arbitration: { ...enabled.arbitration, minConfidence: 0.9 } })).not.toBe(signature);
    expect(getCortexStructuralSignature({ ...enabled, nonProseScaffoldTags: ["hud"] })).not.toBe(signature);
  });
});

test("the plan gates provisional entities, attached aliases and relationship endpoints", () => {
  const plan = buildCortexArbitrationPlan({ passage: input.passage, knownEntities: [], characterNames: ["Mara"], gradeExisting: false, graph: {
    entities: [{ name: "Mara", type: "character", aliases: ["Red"], confidence: 0.9 }, { name: "Tovin", type: "concept", aliases: [], confidence: 0.5, provisional: true }],
    aliases: [], relationships: [{ source: "Mara", target: "Tovin", type: "ally", label: "protection promise", sentiment: 0.8 }],
  } });
  expect(plan.input.candidates.map((c) => c.kind)).toEqual(["entity", "entity", "relationship", "alias"]);
  const result = plan.apply(plan.input.candidates.map((candidate) => ({ id: candidate.id, action: candidate.id === "e0" || candidate.kind === "relationship" ? "keep" : "defer" })));
  expect(result.graph.entities.map((e) => e.name)).toEqual(["Mara"]);
  expect(result.graph.entities[0]?.aliases).toEqual([]);
  expect(result.graph.relationships).toEqual([]);
  expect(result.graph.aliases).toEqual([]);
});

test("facts attach to explicit names and aliases with word boundaries", () => {
  const result = attributeFactsToEntities(["Mara saved Tovin.", "Red promised to return.", "It was quiet.", "Marathon continued."], [
    { name: "Mara", aliases: ["Red"] }, { name: "Tovin", aliases: [] },
  ]);
  expect(result.get("Mara")).toEqual(["Mara saved Tovin.", "Red promised to return."]);
  expect(result.get("Tovin")).toEqual(["Mara saved Tovin."]);
});

test("new alias proposals cannot become canonical hints before review", () => {
  const plan = buildCortexArbitrationPlan({ passage: "Red met Mara.", knownEntities: [], characterNames: [], gradeExisting: false,
    canonicalAliases: new Map([["M", "Mara"]]), graph: {
      entities: [{ name: "Mara", type: "character", aliases: ["Invented"], confidence: 0.9 },
        { name: "Red", type: "concept", aliases: [], confidence: 0.5, provisional: true }], aliases: [], relationships: [],
    } });
  expect(plan.input.canonicals[0]?.aliases).toEqual(["M"]);
  const result = plan.apply(plan.input.candidates.map((c) => c.id === "e1"
    ? { id: c.id, action: "resolve", canonicalId: "c0" }
    : { id: c.id, action: c.kind === "alias" ? "reject" : "keep" }));
  expect(result.graph.entities[0]?.aliases).not.toContain("Invented");
  expect(result.graph.aliases.map((a) => a.alias)).toEqual(["Red"]);
});

test("ambiguous accepted aliases cannot redirect a relationship endpoint", () => {
  const plan = buildCortexArbitrationPlan({ passage: "Mara and Tovin both use Red. Red mentors Voss.", knownEntities: [], characterNames: [], gradeExisting: false,
    graph: { entities: ["Mara", "Tovin", "Voss"].map((name) => ({ name, type: "character", aliases: [], confidence: 0.9 })),
      relationships: [{ source: "Red", target: "Voss", type: "mentor", label: "mentor", sentiment: 0.3 }],
      aliases: [{ canonicalName: "Mara", alias: "Red" }, { canonicalName: "Tovin", alias: "Red" }],
    } });
  expect(plan.apply(plan.input.candidates.map((candidate) => ({ id: candidate.id, action: "keep" }))).graph.relationships).toEqual([]);
});

test("color claims are reviewed independently and follow only accepted character identities", () => {
  const plan = buildCortexArbitrationPlan({ passage: '*<font color="#abc">Red thought of home.</font>*',
    knownEntities: [], characterNames: ["Mara"], gradeExisting: false, graph: {
      entities: [{ name: "Red", type: "character", aliases: [], confidence: 0.8 }], relationships: [], aliases: [],
      colors: [{ hexColor: "#aabbcc", entityName: "Red", usageType: "thought", confidence: 0.8, evidence: ['*<font color="#abc">Red thought of home.</font>*'] }],
    } });
  const candidate = plan.input.candidates.find((entry) => entry.kind === "color")!;
  expect(candidate).toMatchObject({ id: "f0", name: "Red", hexColor: "#aabbcc", type: "thought" });
  const verdicts = [{ id: "e0", action: "resolve" as const, canonicalId: "c0" }, { id: "f0", action: "keep" as const }];
  expect(plan.apply(verdicts).graph.colors?.[0]?.entityName).toBe("Mara");
  for (const action of ["reject", "defer"] as const) {
    expect(plan.apply([{ ...verdicts[0]! }, { id: "f0", action }]).graph.colors).toEqual([]);
  }
  expect(plan.apply([{ id: "e0", action: "reject" }, { id: "f0", action: "keep" }]).graph.colors).toEqual([]);
  expect(() => plan.apply([verdicts[0]!])).toThrow("Incomplete");
});
