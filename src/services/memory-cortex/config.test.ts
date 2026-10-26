import { expect, test } from "bun:test";
import { DEFAULT_CORTEX_CONFIG, isCortexEnabledForChat, normalizeCortexConfig } from "./config";

test("legacy retry settings are discarded while configured fallback connections survive", () => {
  const legacy = {
    ...DEFAULT_CORTEX_CONFIG,
    sidecarReliability: { ...DEFAULT_CORTEX_CONFIG.sidecarReliability, maxRetries: 10, retryDelayMs: 500 },
    queryGeneration: {
      primary: { connectionProfileId: "primary", model: "test" },
      secondary: { connectionProfileId: "secondary", model: "test" },
    },
  };
  const config = normalizeCortexConfig(legacy);
  expect(config.sidecarReliability).not.toHaveProperty("maxRetries");
  expect(config.sidecarReliability).not.toHaveProperty("retryDelayMs");
  expect(config.queryGeneration).toMatchObject(legacy.queryGeneration);
});

test("candidate review and existing-record cleanup require an explicit boolean opt-in", () => {
  expect(DEFAULT_CORTEX_CONFIG.sidecarReliability.arbitratesHeuristics).toBe(false);
  expect(DEFAULT_CORTEX_CONFIG.sidecarReliability.gradesExistingRecords).toBe(false);
  expect(normalizeCortexConfig({ enabled: true }).sidecarReliability).toMatchObject({
    arbitratesHeuristics: false, gradesExistingRecords: false,
  });

  for (const value of [undefined, null, false, "false", "true", 0, 1, {}, [], true]) {
    const sidecarReliability = {
      ...DEFAULT_CORTEX_CONFIG.sidecarReliability,
      arbitratesHeuristics: value,
      gradesExistingRecords: value,
    } as unknown as typeof DEFAULT_CORTEX_CONFIG.sidecarReliability;
    expect(normalizeCortexConfig({ sidecarReliability }).sidecarReliability).toMatchObject({
      arbitratesHeuristics: value === true, gradesExistingRecords: value === true,
    });
  }
});

test("chat Cortex opt-out inherits global config unless explicitly disabled", () => {
  expect(isCortexEnabledForChat({ enabled: true }, {})).toBe(true);
  expect(isCortexEnabledForChat({ enabled: true }, { cortex_settings: {} })).toBe(true);
  expect(isCortexEnabledForChat({ enabled: true }, { cortex_settings: { enabled: false } })).toBe(false);
  expect(isCortexEnabledForChat({ enabled: true }, { cortex_settings: { enabled: true } })).toBe(true);
  expect(isCortexEnabledForChat({ enabled: false }, { cortex_settings: { enabled: true } })).toBe(false);
  expect(isCortexEnabledForChat({ enabled: true }, { temporary: true })).toBe(false);
  expect(isCortexEnabledForChat({ enabled: true }, { temporary: true, cortex_settings: { enabled: true } })).toBe(false);
});
