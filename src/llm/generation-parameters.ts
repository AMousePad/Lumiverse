import type { GenerationParameters } from "./types";

const PENALTY_PARAMETERS = [
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty",
] as const;

/** Disabled penalties must be omitted, including values from custom bodies or request overrides. */
export function omitDisabledPenalties(parameters?: GenerationParameters): GenerationParameters {
  const params = { ...parameters };
  for (const key of PENALTY_PARAMETERS) {
    if (params[key] == null || params[key] === 0) delete params[key];
  }
  return params;
}
