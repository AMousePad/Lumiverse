import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDatabase, getDb, initDatabase } from "../src/db/connection";
import { DEFAULT_CORTEX_CONFIG, getCortexConfig, putCortexConfig } from "../src/services/memory-cortex/config";
import { curateEntityFactsWithLLM, processChunk } from "../src/services/memory-cortex";
import { runHeuristicAnalysis } from "../src/services/memory-cortex/heuristic-analysis";
import * as graph from "../src/services/memory-cortex/entity-graph";

beforeEach(async () => {
  closeDatabase(); initDatabase(":memory:");
  getDb().run("PRAGMA foreign_keys = OFF");
  getDb().run(await Bun.file(new URL("../src/db/baseline.sql", import.meta.url)).text());
});
afterEach(() => closeDatabase());

test("automatic cleanup preserves an unedited endpoint of a manually edited relationship", () => {
  const first = graph.upsertEntity("chat", { name: "Mara", type: "character", aliases: [], confidence: 1 }, "chunk", 1);
  const second = graph.upsertEntity("chat", { name: "Tovin", type: "character", aliases: [], confidence: 1 }, "chunk", 1);
  getDb().query("INSERT INTO memory_relations (id, chat_id, source_entity_id, target_entity_id, relation_type, user_edited_at, created_at, updated_at) VALUES ('edited', 'chat', ?, ?, 'ally', 1, 1, 1)").run(first, second);
  expect(graph.deleteEntityIfNotUserEdited(first)).toBe(false);
  expect(graph.getEntity(first)).not.toBeNull();
  expect(getDb().query("SELECT id FROM memory_relations WHERE id = 'edited'").get()).not.toBeNull();
});

test("fact curation sees overflow and preserves host-owned tags and source evidence", async () => {
  const id = graph.upsertEntity("chat", { name: "Mara", type: "character", aliases: [], confidence: 1 }, "chunk", 1);
  graph.addEntityFacts(id, ["Mara swore an oath."], "branch-a", 9, 2, { chunkId: "old", evidence: "Mara swore an oath." });
  const initial = graph.getEntity(id)!;
  const candidates = graph.mergeEntityFactCandidates(initial.facts, ["Mara found a key.", "Mara went for a walk."], null, 3);
  graph.addEntityFacts(id, ["Mara found a key.", "Mara went for a walk."], null, 3, 2);
  expect(graph.getEntity(id)!.facts).toHaveLength(2);
  let calls = 0;
  await curateEntityFactsWithLLM(id, candidates, 2, async (request) => {
    calls++; const prompt = JSON.parse(request.messages[1]!.content);
    expect(prompt.facts).toHaveLength(3);
    expect(prompt.facts[0].importance).toBe(9);
    return { content: '{"indices":[0,1]}' };
  }, "sidecar", DEFAULT_CORTEX_CONFIG, undefined, {
    ...initial.metadata.factEvidence, "mara found a key.": [{ chunkId: "new", evidence: "Mara found a key." }],
  });
  expect(calls).toBe(1);
  const current = graph.getEntity(id)!;
  expect(current.facts).toEqual(["[branch:branch-a] [i:9] Mara swore an oath.", "[i:3] Mara found a key."]);
  expect(current.metadata.factEvidence["mara found a key."][0].chunkId).toBe("new");
});

test("curation does not overwrite a user edit made during its request", async () => {
  const id = graph.upsertEntity("chat", { name: "Mara", type: "character", aliases: [], confidence: 1 }, "chunk", 1);
  graph.addEntityFacts(id, ["Mara found the key."], null, 7, 1);
  await curateEntityFactsWithLLM(id, ["Mara found the key.", "Mara returned home."], 1, async () => {
    getDb().query("UPDATE memory_entities SET user_edited_at = 2, facts = ? WHERE id = ?").run('["Manually curated fact"]', id);
    return { content: '{"indices":[1]}' };
  }, "sidecar", DEFAULT_CORTEX_CONFIG);
  expect(graph.getEntity(id)!.facts).toEqual(["Manually curated fact"]);
});

test("ingestion curation includes overflow facts and status changes from the same chunk", async () => {
  const config = putCortexConfig("facts-user", { ...DEFAULT_CORTEX_CONFIG, enabled: true,
    factManagement: { maxFactsPerEntity: 5, importanceThreshold: 0, autopilot: true },
    consolidation: { ...DEFAULT_CORTEX_CONFIG.consolidation, enabled: false },
  });
  const passage = "Mara found the key before she died.";
  getDb().query("INSERT INTO chats (id, user_id) VALUES ('facts-chat', 'facts-user')").run();
  getDb().query("INSERT INTO chat_chunks (id, chat_id, start_message_id, end_message_id, message_ids, content, token_count, message_count, created_at, updated_at) VALUES ('facts-chunk', 'facts-chat', 'm1', 'm1', '[]', ?, 20, 1, 1, 1)").run(passage);
  const id = graph.upsertEntity("facts-chat", { name: "Mara", type: "character", aliases: [], confidence: 1 }, "old", 1);
  graph.addEntityFacts(id, Array.from({ length: 5 }, (_, index) => `Mara kept promise ${index}.`), null, 7, 5);
  const heuristic = runHeuristicAnalysis({ cleanContent: passage, knownEntities: [], characterNames: ["Mara"], entityWhitelist: [], minConfidence: 0.5, entityExtractionFilters: config.entityExtractionFilters });
  let calls = 0;
  await processChunk({ chunkId: "facts-chunk", chatId: "facts-chat", userId: "facts-user", characterId: null, content: passage, messageIds: [], startMessageIndex: 0, endMessageIndex: 0, createdAt: 1 }, ["Mara"], async (request) => {
    calls++;
    expect(request.requestPurpose).toBe("fact curation");
    const input = JSON.parse(request.messages[1]!.content);
    expect(input.facts).toHaveLength(7);
    expect(input.facts[6].text).toBe("died: Mara died after finding the key.");
    return { content: '{"indices":[0,1,2,5,6]}' };
  }, "sidecar", undefined, heuristic, true, undefined, {
    score: 0.9, emotionalTags: [], narrativeFlags: [], entitiesPresent: [{ name: "Mara", type: "character" }],
    statusChanges: [{ entity: "Mara", change: "died", detail: "Mara died after finding the key." }],
    keyFacts: ["Mara found the key."], relationshipsShown: [], discoveredAliases: [], fontColors: [],
  });
  expect(calls).toBe(1);
  expect(graph.getEntity(id)!.facts.map(graph.stripFactTags)).toContain("died: Mara died after finding the key.");
});

test("partial arbitration updates preserve the selected connection and model", () => {
  putCortexConfig("config-user", { ...DEFAULT_CORTEX_CONFIG, arbitration: {
    ...DEFAULT_CORTEX_CONFIG.arbitration, backend: "decision", connectionProfileId: "decision-a", model: "model-a",
  } });
  putCortexConfig("config-user", { arbitration: { minConfidence: 0.9 } as any });
  expect(getCortexConfig("config-user").arbitration).toMatchObject({ backend: "decision", connectionProfileId: "decision-a", model: "model-a", minConfidence: 0.9 });
});

for (const change of ["source", "config"] as const) {
  test(`a ${change} edit during review prevents stale persistence`, async () => {
    const config = putCortexConfig("user", { ...DEFAULT_CORTEX_CONFIG, enabled: true,
      queryGeneration: { primary: { connectionProfileId: "reviewer", model: "fixture" }, secondary: null },
      sidecarReliability: { ...DEFAULT_CORTEX_CONFIG.sidecarReliability, arbitratesHeuristics: true },
      consolidation: { ...DEFAULT_CORTEX_CONFIG.consolidation, enabled: false },
    });
    const passage = 'Mara said, "I promise to return."';
    getDb().query("INSERT INTO chats (id, user_id) VALUES ('chat', 'user')").run();
    getDb().query("INSERT INTO chat_chunks (id, chat_id, start_message_id, end_message_id, message_ids, content, token_count, message_count, created_at, updated_at) VALUES ('chunk', 'chat', 'm1', 'm1', '[]', ?, 20, 1, 1, 1)").run(passage);
    const heuristic = runHeuristicAnalysis({ cleanContent: passage, knownEntities: [], characterNames: ["Mara"], entityWhitelist: [], minConfidence: 0.5, entityExtractionFilters: config.entityExtractionFilters });
    let reviewed = false;
    await processChunk({ chunkId: "chunk", chatId: "chat", userId: "user", characterId: null, content: passage, messageIds: [], startMessageIndex: 0, endMessageIndex: 0, createdAt: 1 }, ["Mara"], async (request) => {
      reviewed = true;
      if (change === "source") getDb().query("UPDATE chat_chunks SET content = 'Revised text' WHERE id = 'chunk'").run();
      else putCortexConfig("user", { arbitration: { ...config.arbitration, minConfidence: 0.95 } });
      const state = JSON.parse(request.messages[1]!.content);
      return { content: JSON.stringify({ verdicts: state.candidates.map((c: any) => ({ id: c.id, action: "keep" })) }) };
    }, "reviewer", undefined, heuristic, true);
    expect(reviewed).toBe(true);
    expect(graph.getEntities("chat")).toEqual([]);
    expect(getDb().query("SELECT id FROM memory_salience").all()).toEqual([]);
    expect((getDb().query("SELECT cortex_warmup_signature FROM chat_chunks WHERE id = 'chunk'").get() as any).cortex_warmup_signature).toBeNull();
  });
}
