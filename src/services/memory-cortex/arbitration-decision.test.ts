import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { closeDatabase, getDb, initDatabase } from "../../db/connection";
import { evaluateDecision, evaluateDecisionAnswers } from "../decisions.service";
import * as secrets from "../secrets.service";
import { ProviderRequestError } from "../../utils/provider-errors";
import { arbitrateCortexCandidates, type CortexArbitrationInput } from "./arbitration";
import { DEFAULT_CORTEX_CONFIG, normalizeCortexConfig, putCortexConfig } from "./config";
import { processChunk } from "./index";
import { runHeuristicAnalysis } from "./heuristic-analysis";
import * as graph from "./entity-graph";

const originalFetch = globalThis.fetch;
const userId = "decision-recovery-user";
const profileId = "decision-recovery-profile";
const config = normalizeCortexConfig({ ...DEFAULT_CORTEX_CONFIG, enabled: true,
  consolidation: { ...DEFAULT_CORTEX_CONFIG.consolidation, enabled: false },
  sidecarReliability: { ...DEFAULT_CORTEX_CONFIG.sidecarReliability, arbitratesHeuristics: true, gradesExistingRecords: true },
  arbitration: { ...DEFAULT_CORTEX_CONFIG.arbitration, backend: "decision", connectionProfileId: profileId, timeoutMs: 100 },
});
const input: CortexArbitrationInput = { passage: "Mara returned; Tovin waited.", canonicals: [], candidates: [
  { id: "e0", kind: "entity", name: "Mara" },
  { id: "x3", kind: "existing", name: "Tovin" },
] };
let secretSpy: ReturnType<typeof spyOn>;
let requests: any[];

beforeEach(async () => {
  closeDatabase(); initDatabase(":memory:");
  const db = getDb(); db.run("PRAGMA foreign_keys = OFF");
  db.run(await Bun.file(new URL("../../db/baseline.sql", import.meta.url)).text());
  db.query("INSERT INTO decision_connections (id, user_id, name, provider, model, has_api_key, created_at, updated_at) VALUES (?, ?, 'Recovery test', 'openrouter', 'fixture-model', 1, 1, 1)").run(profileId, userId);
  secretSpy = spyOn(secrets, "getSecret").mockImplementation(async () => "fixture-key");
  requests = [];
});
afterEach(() => { globalThis.fetch = originalFetch; secretSpy.mockRestore(); closeDatabase(); });

/** Local fetch fixture exercises the native adapter, service, and Cortex gate. */
function provider(respond: (body: any, attempt: number, signal: AbortSignal) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: any, init: any) => {
    expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.headers.Authorization).toBe("Bearer fixture-key");
    const body = JSON.parse(init.body);
    requests.push(body);
    return respond(body, requests.length, init.signal);
  }) as typeof fetch;
}
function response(body: any, invalid: (id: string, candidate: any) => boolean = () => false) {
  return { model: body.model, answers: Object.fromEntries(Object.entries(body.questions).map(([id, raw]) => {
    const question = raw as any;
    const candidate = body.state.candidates.find((entry: any) => entry.id === id);
    const choice = candidate.kind === "existing" ? "reject" : "keep";
    const keys = Object.keys(question.criteria);
    const other = (1 - 0.98) / (keys.length - 1);
    return [id, { type: "choice", choice, confidence: 0.98,
      probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? 0.98 : invalid(id, candidate) ? 0.4 : other])) }];
  })) };
}
const evaluate = (signal?: AbortSignal) => arbitrateCortexCandidates({ userId, config, input, signal });

test("valid Decision answers need only one provider request", async () => {
  provider((body) => Response.json(response(body)));
  expect((await evaluate()).verdicts.map((verdict) => verdict.action)).toEqual(["keep", "reject"]);
  expect(requests).toHaveLength(1);
});

test("retries only invalid questions and recovers their native verdicts", async () => {
  provider((body, attempt) => Response.json(response(body, (id) => attempt === 1 && id === "x3")));
  const result = await evaluate();
  expect(result.verdicts.map((verdict) => verdict.action)).toEqual(["keep", "reject"]);
  expect(requests.map((request) => Object.keys(request.questions))).toEqual([["e0", "x3"], ["x3"]]);
  expect(requests[1].state).toEqual(requests[0].state);
  expect(result.verdicts[1]).toMatchObject({ confidence: 0.98, probability: 0.98 });
});

test("persistent invalid probabilities defer only that candidate without inventing probabilities", async () => {
  provider((body) => Response.json(response(body, (id) => id === "x3")));
  const result = await evaluate();
  expect(result.verdicts[0]).toMatchObject({ id: "e0", action: "keep", probability: 0.98 });
  expect(result.verdicts[1]).toEqual({ id: "x3", action: "defer" });
  expect(requests).toHaveLength(2);
});

test("an entirely invalid batch is deferred after one bounded retry", async () => {
  provider((body) => Response.json(response(body, () => true)));
  expect((await evaluate()).verdicts).toEqual([{ id: "e0", action: "defer" }, { id: "x3", action: "defer" }]);
  expect(requests).toHaveLength(2);
});

test("recovered answers still must meet the confidence and selected-probability thresholds", async () => {
  for (const field of ["confidence", "probability"]) {
    requests = [];
    provider((body, attempt) => {
      const value = response(body, (id) => attempt === 1 && id === "x3");
      if (attempt === 2) {
        const answer = value.answers.x3;
        if (field === "confidence") answer.confidence = 0.5;
        else answer.probabilities = { keep: 0.2, reject: 0.6, defer: 0.2 };
      }
      return Response.json(value);
    });
    const result = await evaluate();
    expect(result.verdicts[0].action).toBe("keep");
    expect(result.verdicts[1].action).toBe("defer");
    expect(requests).toHaveLength(2);
  }
});

test("a failed repair request defers its candidates and retains already valid answers", async () => {
  for (const failure of ["http", "envelope", "timeout"]) {
    requests = [];
    provider(async (body, attempt, signal) => {
      if (attempt === 1) return Response.json(response(body, (id) => id === "x3"));
      if (failure === "http") return Response.json({ error: "Temporary failure" }, { status: 503 });
      if (failure === "envelope") return Response.json({ model: body.model, answers: {} });
      return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    expect((await evaluate()).verdicts.map((verdict) => verdict.action)).toEqual(["keep", "defer"]);
    expect(requests).toHaveLength(2);
  }
});

test("caller cancellation and authentication errors during recovery still abort the chunk", async () => {
  const controller = new AbortController();
  provider((body, attempt) => {
    if (attempt === 2) controller.abort();
    return Response.json(response(body, (id) => attempt === 1 && id === "x3"));
  });
  await expect(evaluate(controller.signal)).rejects.toThrow();
  requests = [];
  provider((body, attempt) => attempt === 1 ? Response.json(response(body, (id) => id === "x3"))
    : Response.json({ error: "Invalid credential" }, { status: 401 }));
  await expect(evaluate()).rejects.toThrow("401");
});

test("an incomplete initial response still fails and a foreign profile cannot be used", async () => {
  provider((body) => Response.json({ model: body.model, answers: {} }));
  await expect(evaluate()).rejects.toThrow("invalid Decision answers");
  expect(requests).toHaveLength(1);
  await expect(evaluateDecisionAnswers("another-user", { state: input.passage, questions: { q: { type: "noul", instructions: "Present?" } }, connection_id: profileId })).rejects.toThrow("not found");
  expect(requests).toHaveLength(1);
});

test("the public Decision service remains strict and preserves the typed error code", async () => {
  provider((body) => Response.json(response(body, (id) => id === "x3")));
  try {
    await evaluateDecision(userId, { connection_id: profileId, state: JSON.parse(JSON.stringify({ candidates: input.candidates })), questions: {
      x3: { type: "choice", instructions: "Retain?", criteria: { keep: null, reject: null, defer: null } },
    } });
    throw new Error("Expected invalid response rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({ code: "invalid_decision_response", retryable: true });
    expect((error as Error).message).toContain("sum=1.78");
  }
});

test("an invalid cleanup answer preserves its record while the chunk completes normally", async () => {
  const chatId = "decision-recovery-chat";
  const chunkId = "decision-recovery-chunk";
  const db = getDb();
  putCortexConfig(userId, config);
  db.query("INSERT INTO chats (id, user_id) VALUES (?, ?)").run(chatId, userId);
  db.query("INSERT INTO chat_chunks (id, chat_id, start_message_id, end_message_id, message_ids, content, token_count, message_count, created_at, updated_at) VALUES (?, ?, 'm1', 'm1', '[]', ?, 20, 1, 1, 1)").run(chunkId, chatId, input.passage);
  const tovinId = graph.upsertEntity(chatId, { name: "Tovin", type: "character", aliases: [], confidence: 1 }, "previous", 1);
  const heuristic = runHeuristicAnalysis({ cleanContent: input.passage, knownEntities: [], characterNames: ["Mara", "Tovin"], entityWhitelist: [], minConfidence: 0.5, entityExtractionFilters: config.entityExtractionFilters });
  heuristic.entities = [{ name: "Mara", type: "character", aliases: [], confidence: 1, mentionRole: "subject" }];
  heuristic.relationships = [];
  heuristic.aliases = [];
  provider((body) => Response.json(response(body, (_, candidate) => candidate.kind === "existing")));
  await processChunk({ chunkId, chatId, userId, characterId: null, content: input.passage, messageIds: [], startMessageIndex: 0, endMessageIndex: 0, createdAt: 1 },
    ["Mara", "Tovin"], undefined, undefined, undefined, heuristic, true);
  expect(graph.findEntityByName(chatId, "Mara")).not.toBeNull();
  expect(graph.getEntity(tovinId)?.name).toBe("Tovin");
  expect(db.query("SELECT id FROM memory_salience WHERE chunk_id = ?").get(chunkId)).not.toBeNull();
  expect((db.query("SELECT cortex_warmup_signature FROM chat_chunks WHERE id = ?").get(chunkId) as any).cortex_warmup_signature).toBeTruthy();
  expect(requests).toHaveLength(2);
});
