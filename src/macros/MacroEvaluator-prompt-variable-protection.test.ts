import { beforeAll, describe, expect, test } from "bun:test";
import { initMacros, withPromptBlockContext } from "./index";
import { evaluate } from "./MacroEvaluator";
import { registry } from "./MacroRegistry";
import type { MacroEnv } from "./types";
import { macroInterceptorChain, type MacroInterceptorCtx } from "../spindle/macro-interceptor";

beforeAll(() => {
  initMacros();
});

function makeEnv(options: {
  promptVariables?: Record<string, string | number>;
  local?: Record<string, string>;
  chat?: Record<string, string>;
} = {}): MacroEnv {
  const promptVariables = options.promptVariables ?? { tone: "preset" };
  return {
    commit: true,
    names: {
      user: "User", char: "Character", group: "", groupNotMuted: "", notChar: "",
      charGroupFocused: "", groupOthers: "", groupMemberCount: "0", isGroupChat: "no",
      isNarrator: "no", groupLastSpeaker: "", groupCardMode: "solo",
    },
    character: {
      name: "Character", description: "", personality: "", scenario: "", persona: "",
      personaSubjectivePronoun: "", personaObjectivePronoun: "",
      personaPossessivePronoun: "", personaReflexivePronoun: "",
      personaPossessivePronounStandalone: "", mesExamples: "", mesExamplesRaw: "",
      systemPrompt: "", postHistoryInstructions: "", depthPrompt: "", creatorNotes: "",
      version: "", creator: "", firstMessage: "",
    },
    chat: {
      id: "chat", messageCount: 0, lastMessage: "", lastMessageName: "",
      lastUserMessage: "", lastCharMessage: "", lastMessageId: -1,
      firstIncludedMessageId: -1, lastSwipeId: 0, currentSwipeId: 0, rejectedSwipe: "",
    },
    system: {
      model: "test", maxPrompt: 0, maxContext: 0, maxResponse: 0,
      lastGenerationType: "normal", isMobile: false,
    },
    variables: {
      local: new Map(Object.entries(options.local ?? Object.fromEntries(
        Object.entries(promptVariables).map(([key, value]) => [key, String(value)]),
      ))),
      global: new Map(),
      chat: new Map(Object.entries(options.chat ?? {})),
    },
    dynamicMacros: {},
    extra: {
      promptVariables,
      promptVariableDefaults: promptVariables,
    },
  };
}

async function withInterceptor<T>(
  handler: (ctx: MacroInterceptorCtx) => string | { text: string },
  work: () => Promise<T>,
): Promise<T> {
  const unregister = macroInterceptorChain.register({
    extensionId: "test-lumirealm",
    priority: 100,
    handler: async (ctx) => handler(ctx),
  });
  try {
    return await work();
  } finally {
    unregister();
  }
}

function lumiLikeHandler(seen: string[]): (ctx: MacroInterceptorCtx) => { text: string } {
  return (ctx) => {
    seen.push(ctx.template);
    let text = ctx.template;

    // Model the problematic behavior: bare host reads are interpreted against
    // the extension's persisted chat state if they reach the interceptor.
    text = text.replace(/\{\{(?:var::tone|\.tone|getvar::tone)\}\}/g, "realm-chat");
    text = text.replace(/\{\{risu_getvar::realmOnly\}\}/g, "realm-script");

    // Model LumiRealm's raw Risu conditional scanner. The host should provide
    // the concrete preset value while leaving this surrounding syntax intact.
    text = text.replace(
      /\{\{#if (true|false|1|0)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_all, condition: string, body: string) =>
        condition === "true" || condition === "1" ? body : "",
    );
    return { text };
  };
}

describe("prompt-variable protection before extension macro interceptors", () => {
  test("resolves var, dot shorthand, and getvar before an interceptor can shadow them", async () => {
    const seen: string[] = [];
    const env = makeEnv({
      promptVariables: { tone: "preset-value" },
      local: { tone: "preset-value" },
      chat: { tone: "realm-chat" },
    });

    const text = await withInterceptor(lumiLikeHandler(seen), async () =>
      (await evaluate(
        "{{var::tone}}|{{.tone}}|{{getvar::tone}}|{{risu_getvar::realmOnly}}",
        env,
        registry,
      )).text,
    );

    expect(seen[0]).toBe(
      "preset-value|preset-value|preset-value|{{risu_getvar::realmOnly}}",
    );
    expect(text).toBe("preset-value|preset-value|preset-value|realm-script");
  });

  test("preserves surrounding Risu syntax while resolving nested preset reads", async () => {
    const seen: string[] = [];
    const env = makeEnv({
      promptVariables: { enabled: "true" },
      local: { enabled: "true" },
      chat: { enabled: "false" },
    });

    const text = await withInterceptor(lumiLikeHandler(seen), async () =>
      (await evaluate(
        "{{#if {{var::enabled}}}}VAR{{/if}}|{{#if {{.enabled}}}}DOT{{/if}}",
        env,
        registry,
      )).text,
    );

    expect(seen[0]).toBe("{{#if true}}VAR{{/if}}|{{#if true}}DOT{{/if}}");
    expect(text).toBe("VAR|DOT");
  });

  test("changes interceptor input when the preset instance value changes", async () => {
    const seen: string[] = [];
    await withInterceptor((ctx) => {
      seen.push(ctx.template);
      return { text: ctx.template };
    }, async () => {
      expect((await evaluate("{{var::tone}}", makeEnv({ promptVariables: { tone: "A" } }), registry)).text).toBe("A");
      expect((await evaluate("{{var::tone}}", makeEnv({ promptVariables: { tone: "B" } }), registry)).text).toBe("B");
    });

    expect(seen).toEqual(["A", "B"]);
  });

  test("uses the current block's instance when another block defines the same key", async () => {
    const seen: string[] = [];
    const env = makeEnv({
      promptVariables: { tone: "later-block" },
      local: { tone: "later-block" },
    });
    env.extra.promptVariablesByBlock = {
      "preset-block": { tone: "preset-instance" },
      "extension-block": { tone: "extension-instance" },
    };
    env.extra.promptVariableDefaultsByBlock = env.extra.promptVariablesByBlock;

    const text = await withInterceptor(lumiLikeHandler(seen), () =>
      withPromptBlockContext(
        env,
        { id: "preset-block", role: "system", position: "pre_history", depth: 0 },
        async () => (await evaluate("{{var::tone}}/{{.tone}}", env, registry)).text,
      ),
    );

    expect(seen).toEqual(["preset-instance/preset-instance"]);
    expect(text).toBe("preset-instance/preset-instance");
    expect(env.variables.local.get("tone")).toBe("later-block");
  });

  test("protects a preset variable read from a different block", async () => {
    const seen: string[] = [];
    const env = makeEnv({
      promptVariables: { words_target: 850, cot_mode: 0 },
      local: { words_target: "850", cot_mode: "0" },
    });
    env.extra.promptVariablesByBlock = {
      "length-target": { words_target: 850 },
      "full-cot": { cot_mode: 0 },
    };
    env.extra.promptVariableDefaultsByBlock = env.extra.promptVariablesByBlock;

    const template = "{{floor::{{calc::{{var::words_target}} / 100}}}} to {{ceil::{{calc::{{var::words_target}} / 75}}}}";
    const text = await withInterceptor((ctx) => {
      seen.push(ctx.template);
      return {
        text: ctx.template.includes("{{var::words_target}}")
          ? "0 to 0"
          : ctx.template,
      };
    }, () =>
      withPromptBlockContext(
        env,
        { id: "full-cot", role: "system", position: "pre_history", depth: 0 },
        async () => (await evaluate(template, env, registry)).text,
      ),
    );

    expect(seen).toEqual([
      "{{floor::{{calc::850 / 100}}}} to {{ceil::{{calc::850 / 75}}}}",
    ]);
    expect(text).toBe("8 to 12");
  });

  test("does not pre-resolve undeclared extension variables", async () => {
    const seen: string[] = [];
    const env = makeEnv({
      promptVariables: { tone: "preset" },
      local: { tone: "preset", realmOnly: "host-local" },
      chat: { realmOnly: "realm-script" },
    });

    const text = await withInterceptor((ctx) => {
      seen.push(ctx.template);
      return { text: ctx.template.replace("{{getvar::realmOnly}}", "realm-script") };
    }, async () => (await evaluate("{{getvar::realmOnly}}", env, registry)).text);

    expect(seen).toEqual(["{{getvar::realmOnly}}"]);
    expect(text).toBe("realm-script");
  });

  test("leaves a key untouched when the same template mutates it", async () => {
    const seen: string[] = [];
    const env = makeEnv({
      promptVariables: { tone: "preset" },
      local: { tone: "preset" },
    });

    const text = await withInterceptor((ctx) => {
      seen.push(ctx.template);
      return { text: ctx.template };
    }, async () =>
      (await evaluate("{{setvar::tone::runtime}}{{var::tone}}/{{.tone}}", env, registry)).text,
    );

    expect(seen[0]).toBe("{{setvar::tone::runtime}}{{var::tone}}/{{.tone}}");
    expect(text).toBe("runtime/runtime");
  });
});
