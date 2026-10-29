import { describe, expect, spyOn, test } from "bun:test";
import { formatLogArguments } from "../../utils/log-format";

import {
  extractBatchWithSidecar,
  extractWithSidecar,
  getToolChoiceParams,
  parseToolCallResults,
} from "./salience-sidecar";

describe("getToolChoiceParams", () => {
  test("uses auto for DeepSeek sidecars regardless of provider casing or whitespace", () => {
    for (const provider of ["deepseek", "DeepSeek", " DEEPSEEK "]) {
      expect(getToolChoiceParams(provider)).toEqual({ tool_choice: "auto" });
    }
  });

  test("uses auto for Nano-GPT sidecars", () => {
    expect(getToolChoiceParams("nanogpt")).toEqual({ tool_choice: "auto" });
    expect(getToolChoiceParams("NanoGPT")).toEqual({ tool_choice: "auto" });
  });

  test("continues forcing tools for other OpenAI-compatible providers", () => {
    expect(getToolChoiceParams("openai")).toEqual({ tool_choice: "required" });
  });
});

describe("parseToolCallResults", () => {
  test("normalizes actual font colors and rejects invalid colors or usage types", () => {
    const result = parseToolCallResults([{ name: "extract_font_colors", args: { color_attributions: [
      { hex_color: "#abc", character_name: "Melina", usage_type: "thought" },
      { hex_color: "rgb(255, 0, 0)", character_name: "Melina", usage_type: "speech" },
      { hex_color: "rgb(999, 0, 0)", character_name: "Melina", usage_type: "thought" },
      { hex_color: "#invented", character_name: "Melina", usage_type: "thought" },
      { hex_color: "#abcdef", character_name: "Melina", usage_type: "invented" },
    ] } }]);
    expect(result.fontColors).toEqual([
      { hexColor: "#aabbcc", characterName: "Melina", usageType: "thought" },
      { hexColor: "#ff0000", characterName: "Melina", usageType: "speech" },
    ]);
  });
  test("filters low-signal sidecar junk while preserving supported extraction", () => {
    const result = parseToolCallResults([
      {
        name: "score_salience",
        args: {
          importance: 7,
          emotional_tones: ["tension", "joy"],
          narrative_flags: ["discovery"],
          key_facts: ["betrayal", "Melina promised to return", "THE MOOD"],
        },
      },
      {
        name: "extract_entities",
        args: {
          entities: [
            { name: "Melina", type: "character", role: "subject" },
            { name: "Barely", type: "character" },
            { name: "The Pale", type: "location" },
          ],
          discovered_aliases: [
            { canonical_name: "Melina", alias: "Mel", evidence: "Call me Mel" },
            { canonical_name: "AI", alias: "Guide" },
            { canonical_name: "Melina", alias: "Personal cost", evidence: "called her personal cost" },
            { canonical_name: "Melina", alias: "Among the crowd", evidence: "known as among the crowd" },
            { canonical_name: "Melina", alias: "Guide" },
          ],
          status_changes: [
            { entity: "Melina", change: "arrived", detail: "Melina arrived in Dustwell" },
            { entity: "Personal", change: "injured", detail: "Invalid noise" },
          ],
        },
      },
      {
        name: "extract_relationships",
        args: {
          relationships: [
            { source: "Melina", target: "Kael", type: "ally", label: "trusted allies", sentiment: 0.8 },
            { source: "Strange", target: "Kael", type: "ally", label: "hallucinated pair" },
            { source: "Melina", target: "Melina", type: "ally", label: "self reference" },
          ],
        },
      },
      {
        name: "extract_font_colors",
        args: {
          color_attributions: [
            { hex_color: "#ff9999", character_name: "Melina", usage_type: "speech" },
            { hex_color: "#aaaaaa", character_name: "Personal", usage_type: "thought" },
          ],
        },
      },
    ]);

    expect(result.score).toBe(0.7);
    expect(result.keyFacts).toEqual(["Melina promised to return"]);
    expect(result.entitiesPresent.map((entity) => entity.name)).toEqual(["Melina", "The Pale"]);
    expect(result.discoveredAliases).toEqual([
      { canonicalName: "Melina", alias: "Mel", evidence: "Call me Mel" },
    ]);
    expect(result.statusChanges).toEqual([
      { entity: "Melina", change: "arrived", detail: "Melina arrived in Dustwell" },
    ]);
    expect(result.relationshipsShown).toEqual([
      { source: "Melina", target: "Kael", type: "ally", label: "trusted allies", sentiment: 0.8 },
    ]);
    expect(result.fontColors).toEqual([
      { hexColor: "#ff9999", characterName: "Melina", usageType: "speech" },
    ]);
  });
});

test("live and batch extraction receive the same thought-channel rules and configured markers", async () => {
  const prompts: Array<{ system: string; user: string }> = [];
  const generate: Parameters<typeof extractWithSidecar>[1] = async (request) => {
    prompts.push({ system: request.messages[0]!.content, user: request.messages[1]!.content });
    const entry = { importance: 2, emotional_tones: [], narrative_flags: [], key_facts: [], entities_present: [],
      relationships_shown: [], status_changes: [], color_attributions: [], discovered_aliases: [] };
    return { content: JSON.stringify(request.requestPurpose === "batch extraction" ? { results: [{ ...entry, index: 0 }, { ...entry, index: 1 }] } : entry) };
  };
  const options = { thoughtDelimiters: { prefix: "[private]", suffix: "[/private]" } };
  await extractWithSidecar("Quiet weather.", generate, "fixture", options);
  await extractBatchWithSidecar([{ index: 0, content: "Quiet weather." }, { index: 1, content: "Clear skies." }], generate, "fixture", options);
  expect(prompts).toHaveLength(2);
  for (const prompt of prompts) {
    expect(prompt.system).toContain("a thought/italic wrapper takes precedence over quotation marks");
    expect(prompt.system).toContain("report both usage types");
    expect(prompt.system).toContain("standalone first-person thought paragraph continues");
    expect(prompt.system).toContain("including message prefixes, supplied aliases, and unambiguous pronouns");
    expect(prompt.system).toContain("Include both resolved endpoints in entities_present");
    expect(prompt.system).toContain("serves = subordinate to superior");
    expect(prompt.user).toContain(JSON.stringify(options.thoughtDelimiters));
  }
});

test("live and batch extraction retain configured participants alongside known entities", async () => {
  const prompts: Array<{ system: string; user: string }> = [];
  const generate: Parameters<typeof extractWithSidecar>[1] = async (request) => {
    prompts.push({ system: request.messages[0]!.content, user: request.messages[1]!.content });
    const entry = { importance: 2, emotional_tones: [], narrative_flags: [], key_facts: [], entities_present: [],
      relationships_shown: [], status_changes: [], color_attributions: [], discovered_aliases: [] };
    return { content: JSON.stringify(request.requestPurpose === "batch extraction" ? { results: [{ ...entry, index: 0 }, { ...entry, index: 1 }] } : entry) };
  };
  const options = { characterNames: ["Mara", "Prolix"],
    participants: [{ name: "Mara", role: "character" as const }, { name: "Prolix", role: "user" as const }],
    knownEntities: [{ name: "Inn", type: "location", aliases: [] }],
  };
  const content = '[CHARACTER | Mara]: "I have a crush on you."';
  await extractWithSidecar(content, generate, "fixture", options);
  await extractBatchWithSidecar([{ index: 0, content }, { index: 1, content }], generate, "fixture", options);
  for (const prompt of prompts) {
    expect(prompt.user).toContain("<known_entities>");
    expect(prompt.user).toContain("<known_characters>\nMara, Prolix");
    expect(prompt.user).toContain('"name":"Prolix","role":"user"');
    expect(prompt.system).toContain("A love interest is a relationship even before a formal partnership");
  }
});

test("generative extraction cannot request or return candidate-review verdicts", async () => {
  const requests: Array<Parameters<Parameters<typeof extractWithSidecar>[1]>[0]> = [];
  const extraction = { importance: 2, emotional_tones: [], narrative_flags: [], key_facts: [], entities_present: [],
    relationships_shown: [], status_changes: [], color_attributions: [], discovered_aliases: [], grading: { rejected_existing_entities: ["Mara"] } };
  const generate: Parameters<typeof extractWithSidecar>[1] = async (request) => {
    requests.push(request);
    return { content: JSON.stringify(request.requestPurpose === "batch extraction" ? { results: [{ ...extraction, index: 0 }, { ...extraction, index: 1 }] } : extraction) };
  };
  const single = await extractWithSidecar("Quiet weather.", generate, "fixture");
  const batch = await extractBatchWithSidecar([{ index: 0, content: "Quiet weather." }, { index: 1, content: "Clear skies." }], generate, "fixture");
  expect(single).not.toHaveProperty("gradedHeuristics");
  expect(batch.every((result) => result?.score === 0.2)).toBe(true);
  for (const request of requests) {
    expect(request.messages[0]!.content).not.toContain("arbiter");
    expect(JSON.stringify(request.tools)).not.toContain("grading");
    expect(JSON.stringify(request.tools)).not.toContain("grade_heuristic_candidates");
  }
});

describe("extractBatchWithSidecar", () => {
  test("a failed batch does not fan out into more provider requests", async () => {
    let calls = 0;
    const result = await extractBatchWithSidecar([
      { index: 0, content: "Mara found the map." },
      { index: 1, content: "Tovin crossed the river." },
    ], async () => {
      calls++;
      throw new Error("429 rate limited");
    }, "sidecar-test");
    expect(calls).toBe(1);
    expect(result).toEqual([null, null]);
  });

  test("missing passages stay null without re-extraction", async () => {
    let calls = 0;
    const result = await extractBatchWithSidecar([
      { index: 0, content: "Mara found the map." },
      { index: 1, content: "Tovin crossed the river." },
    ], async () => {
      calls++;
      return { content: JSON.stringify([{ index: 0, importance: 5, entities_present: [], key_facts: [], emotional_tones: [], narrative_flags: [], relationships_shown: [], status_changes: [], color_attributions: [], discovered_aliases: [] }]) };
    }, "sidecar-test");
    expect(calls).toBe(1);
    expect(result[0]?.score).toBe(0.5);
    expect(result[1]).toBeNull();
  });

  test("rejects an unexpected tool for a single passage", async () => {
    const result = await extractBatchWithSidecar([
      { index: 0, content: "Mara found the missing map." },
    ], async () => ({
      content: "",
      tool_calls: [
        undefined as never,
        {
          name: "analyze_passage_batch",
          args: {
            results: [{
              index: 0,
              importance: 5,
              emotional_tones: [],
              narrative_flags: [],
              key_facts: [],
              entities_present: [],
              relationships_shown: [],
              status_changes: [],
              color_attributions: [],
              discovered_aliases: [],
            }],
          },
        },
      ],
    }), "sidecar-test");

    expect(result[0]).toBeNull();
  });

  test("uses one structured batch tool call and maps results by passage index", async () => {
    let toolNames: string[] = [];
    const result = await extractBatchWithSidecar([
      { index: 0, content: "Mara found the missing map." },
      { index: 1, content: "Tovin admitted selling it." },
    ], async (options) => {
      toolNames = (options.tools ?? []).map((tool) => tool.name);
      return {
        content: "",
        tool_calls: [{
          name: "analyze_passage_batch",
          args: {
            results: [
              {
                index: 1,
                importance: 7,
                emotional_tones: ["tension"],
                narrative_flags: ["confession"],
                key_facts: ["Tovin admitted he sold the missing map"],
                entities_present: [{ name: "Tovin", type: "character", role: "subject" }],
                relationships_shown: [],
                status_changes: [],
                color_attributions: [],
                discovered_aliases: [],
              },
              {
                index: 0,
                importance: 5,
                emotional_tones: [],
                narrative_flags: ["discovery"],
                key_facts: ["Mara discovered that the map was missing"],
                entities_present: [{ name: "Mara", type: "character", role: "subject" }],
                relationships_shown: [],
                status_changes: [],
                color_attributions: [],
                discovered_aliases: [],
              },
            ],
          },
        }],
      };
    }, "sidecar-test");

    expect(toolNames).toEqual(["analyze_passage_batch"]);
    expect(result.map((entry) => entry?.score)).toEqual([0.5, 0.7]);
    expect(result[0]?.entitiesPresent[0]?.name).toBe("Mara");
    expect(result[1]?.entitiesPresent[0]?.name).toBe("Tovin");
  });
});

describe("extraction completeness", () => {
  test("a salience-only response cannot warm a chunk", async () => {
    await expect(extractWithSidecar("Mara found the map.", async () => ({ content: "", tool_calls: [
      { name: "score_salience", args: { importance: 7, emotional_tones: [], narrative_flags: [], key_facts: [] } },
    ] }), "test", { throwOnFailure: true })).rejects.toThrow("Incomplete extraction tool");
  });
  test("a complete empty JSON extraction succeeds", async () => {
    const result = await extractWithSidecar("Quiet weather.", async () => ({ content: JSON.stringify({ importance: 2, emotional_tones: [], narrative_flags: [], key_facts: [], entities_present: [], relationships_shown: [], status_changes: [], color_attributions: [], discovered_aliases: [] }) }), "test", { throwOnFailure: true });
    expect(result?.score).toBe(0.2);
  });
});

describe("sidecar failure diagnostics", () => {
  const emptyExtraction = { importance: 2, emotional_tones: [], narrative_flags: [], key_facts: [], entities_present: [],
    relationships_shown: [], status_changes: [], color_attributions: [], discovered_aliases: [] };

  test("request failures retain the error and identify the connection and operation", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("fetch failed", { cause: new Error("ECONNRESET") });
    try {
      const result = await extractWithSidecar("private passage", async () => { throw error; }, "connection-1", { logTag: "rebuild:batch-3" });
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[1]).toBe(error);
      const text = formatLogArguments(warn.mock.calls[0]!);
      for (const detail of ["rebuild:batch-3", "connection=connection-1", "stage=request", "elapsed=", "fetch failed", "ECONNRESET"]) {
        expect(text).toContain(detail);
      }
      expect(text).not.toContain("private passage");
    } finally { warn.mockRestore(); }
  });

  test("an unparseable single response is diagnosed even when returning null", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await extractWithSidecar("private passage", async () => ({ content: "private invalid output" }), "connection-1");
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      const text = formatLogArguments(warn.mock.calls[0]!);
      expect(text).toContain("stage=response validation");
      expect(text).toContain("no tool_calls and no parseable JSON");
      expect(text).toContain("content_chars=22");
      expect(text).toContain("tool_calls=[]");
      expect(text).not.toContain("private invalid output");
      expect(text).not.toContain("private passage");
    } finally { warn.mockRestore(); }
  });

  test("strict extraction preserves the original typed failure for fallback classification", async () => {
    const error = Object.assign(new Error("interactive inference preempted sidecar"), { code: "INFERENCE_PREEMPTED" });
    await expect(extractWithSidecar("passage", async () => { throw error; }, "connection-1", { throwOnFailure: true })).rejects.toBe(error);
  });

  test("strict validation identifies the missing tool and the tools actually received", async () => {
    await expect(extractWithSidecar("passage", async () => ({ content: "", tool_calls: [
      { name: "score_salience", args: { importance: 2, emotional_tones: [], narrative_flags: [], key_facts: [] } },
    ] }), "connection-1", { throwOnFailure: true })).rejects.toThrow('extract_entities (expected exactly one call; received tools=["score_salience"])');
  });

  test("batch diagnostics distinguish invalid, duplicate and missing passage results", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await extractBatchWithSidecar(
        Array.from({ length: 4 }, (_, index) => ({ index, content: "private passage" })),
        async () => ({ content: "", tool_calls: [{ name: "analyze_passage_batch", args: { results: [
          { ...emptyExtraction, index: 0 },
          { ...emptyExtraction, index: 1, importance: "bad" },
          { ...emptyExtraction, index: 2 },
          { ...emptyExtraction, index: 2 },
        ] } }] }), "connection-1", { logTag: "rebuild:batch-3" },
      );
      expect(result.map((entry) => entry?.score ?? null)).toEqual([0.2, null, null, null]);
      expect(warn).toHaveBeenCalledTimes(1);
      const text = formatLogArguments(warn.mock.calls[0]!);
      for (const detail of ["rebuild:batch-3", "connection=connection-1", "3/4", "index: 1", "Invalid or missing importance", "Duplicate passage index", "Missing passage result", 'tool_calls=["analyze_passage_batch"]']) {
        expect(text).toContain(detail);
      }
      expect(text).not.toContain("private passage");
    } finally { warn.mockRestore(); }
  });

  test("an unparseable batch reports response shape without dumping response text", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await extractBatchWithSidecar([{ index: 0, content: "passage" }, { index: 1, content: "passage" }],
        async () => ({ content: "private invalid output" }), "connection-1");
      expect(result).toEqual([null, null]);
      const text = formatLogArguments(warn.mock.calls[0]!);
      expect(text).toContain("No parseable batch results");
      expect(text).toContain("content_chars=22 tool_calls=[]");
      expect(text).not.toContain("private invalid output");
    } finally { warn.mockRestore(); }
  });

  test("batch request failures retain nested causes", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("fetch failed", { cause: new Error("socket closed") });
    try {
      const result = await extractBatchWithSidecar([{ index: 0, content: "passage" }, { index: 1, content: "passage" }],
        async () => { throw error; }, "connection-1");
      expect(result).toEqual([null, null]);
      expect(warn.mock.calls[0]?.[1]).toBe(error);
      const text = formatLogArguments(warn.mock.calls[0]!);
      expect(text).toContain("connection=connection-1 stage=request");
      expect(text).toContain("socket closed");
    } finally { warn.mockRestore(); }
  });
});
