import { describe, expect, test } from "bun:test";

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
