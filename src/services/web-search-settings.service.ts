import * as settingsSvc from "./settings.service";
import * as secretsSvc from "./secrets.service";

export const WEB_SEARCH_SETTINGS_KEY = "webSearchSettings";
/** Legacy SearXNG key name; retained so existing installations keep working. */
export const WEB_SEARCH_API_KEY_SECRET = "web_search_api_key";
export const EXA_WEB_SEARCH_API_KEY_SECRET = "web_search_exa_api_key";
export const EXA_SEARCH_API_URL = "https://api.exa.ai/search";

export type WebSearchProvider = "searxng" | "exa";

function apiKeySecretForProvider(provider: WebSearchProvider): string {
  return provider === "exa" ? EXA_WEB_SEARCH_API_KEY_SECRET : WEB_SEARCH_API_KEY_SECRET;
}

export interface WebSearchSettings {
  enabled: boolean;
  provider: WebSearchProvider;
  apiUrl: string;
  requestTimeoutMs: number;
  defaultResultCount: number;
  maxResultCount: number;
  maxPagesToScrape: number;
  maxCharsPerPage: number;
  language: string;
  safeSearch: 0 | 1 | 2;
  engines: string[];
  /** Allow the primary model to call Lumiverse's selected web-search provider. */
  inlineToolEnabled: boolean;
  hasApiKey: boolean;
}

export interface WebSearchSettingsInput {
  enabled?: boolean;
  provider?: WebSearchProvider;
  apiUrl?: string;
  requestTimeoutMs?: number;
  defaultResultCount?: number;
  maxResultCount?: number;
  maxPagesToScrape?: number;
  maxCharsPerPage?: number;
  language?: string;
  safeSearch?: 0 | 1 | 2;
  engines?: string[];
  inlineToolEnabled?: boolean;
  apiKey?: string | null;
}

const DEFAULT_SETTINGS: Omit<WebSearchSettings, "hasApiKey"> = {
  enabled: false,
  provider: "searxng",
  apiUrl: "",
  requestTimeoutMs: 15_000,
  defaultResultCount: 3,
  maxResultCount: 5,
  maxPagesToScrape: 3,
  maxCharsPerPage: 3_000,
  language: "all",
  safeSearch: 1,
  engines: [],
  inlineToolEnabled: false,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeApiUrl(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.apiUrl;
  return value.trim().replace(/\/$/, "");
}

function normalizeProvider(value: unknown): WebSearchProvider {
  return value === "exa" ? "exa" : "searxng";
}

function normalizeLanguage(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.language;
  const trimmed = value.trim();
  return trimmed || DEFAULT_SETTINGS.language;
}

function normalizeEngines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const engines: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    engines.push(trimmed);
    if (engines.length >= 20) break;
  }
  return engines;
}

function normalizeBaseSettings(raw: Partial<WebSearchSettingsInput> | null | undefined): Omit<WebSearchSettings, "hasApiKey"> {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const provider = normalizeProvider(merged.provider);
  const defaultResultCount = clampInt(merged.defaultResultCount, 1, 10, DEFAULT_SETTINGS.defaultResultCount);
  const maxResultCount = clampInt(merged.maxResultCount, defaultResultCount, 20, DEFAULT_SETTINGS.maxResultCount);

  return {
    enabled: !!merged.enabled,
    provider,
    // Exa's public search endpoint is fixed. Do not let a stale SearXNG URL
    // get used when a client switches providers without resetting apiUrl.
    apiUrl: provider === "exa" ? EXA_SEARCH_API_URL : normalizeApiUrl(merged.apiUrl),
    requestTimeoutMs: clampInt(merged.requestTimeoutMs, 5_000, 120_000, DEFAULT_SETTINGS.requestTimeoutMs),
    defaultResultCount,
    maxResultCount,
    maxPagesToScrape: clampInt(merged.maxPagesToScrape, 1, 10, DEFAULT_SETTINGS.maxPagesToScrape),
    maxCharsPerPage: clampInt(merged.maxCharsPerPage, 500, 20_000, DEFAULT_SETTINGS.maxCharsPerPage),
    language: normalizeLanguage(merged.language),
    safeSearch: clampInt(merged.safeSearch, 0, 2, DEFAULT_SETTINGS.safeSearch) as 0 | 1 | 2,
    engines: normalizeEngines(merged.engines),
    inlineToolEnabled: merged.inlineToolEnabled === true,
  };
}

export function normalizeWebSearchSettings(
  raw: Partial<WebSearchSettingsInput> | null | undefined,
  hasApiKey: boolean,
): WebSearchSettings {
  return {
    ...normalizeBaseSettings(raw),
    hasApiKey,
  };
}

export async function getWebSearchSettings(userId: string): Promise<WebSearchSettings> {
  const row = settingsSvc.getSetting(userId, WEB_SEARCH_SETTINGS_KEY);
  const normalized = normalizeBaseSettings((row?.value as Partial<WebSearchSettingsInput> | undefined) ?? undefined);
  const hasApiKey = await secretsSvc.validateSecret(userId, apiKeySecretForProvider(normalized.provider));
  return { ...normalized, hasApiKey };
}

export async function getWebSearchApiKey(userId: string, provider: WebSearchProvider = "searxng"): Promise<string | null> {
  return secretsSvc.getSecret(userId, apiKeySecretForProvider(provider));
}

export async function putWebSearchSettings(userId: string, input: WebSearchSettingsInput): Promise<WebSearchSettings> {
  const current = settingsSvc.getSetting(userId, WEB_SEARCH_SETTINGS_KEY)?.value as Partial<WebSearchSettingsInput> | undefined;
  const merged = normalizeBaseSettings({ ...current, ...input });

  settingsSvc.putSetting(userId, WEB_SEARCH_SETTINGS_KEY, merged);

  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      await secretsSvc.putSecret(userId, apiKeySecretForProvider(merged.provider), trimmed);
    } else {
      secretsSvc.deleteSecret(userId, apiKeySecretForProvider(merged.provider));
    }
  } else if (input.apiKey === null) {
    secretsSvc.deleteSecret(userId, apiKeySecretForProvider(merged.provider));
  }

  return getWebSearchSettings(userId);
}
