/**
 * UI-driven SillyTavern migration orchestrator.
 *
 * Wraps st-importer.ts functions with a MigrationLogger that emits WebSocket
 * progress events instead of console output. Prevents concurrent migrations
 * via an in-memory lock.
 */

import { eventBus } from "../ws/bus";
import { EventType } from "../ws/events";
import { scanSTData, readConnectionsFromDisk, readProxiesFromDisk, readSecretsFromDisk } from "./st-reader";
import type { MigrationLogger } from "./st-reader";
import {
  importCharacters,
  importWorldBooks,
  importPersonas,
  importChats,
  importGroupChats,
} from "./st-importer";
import type { FileSystem } from "../file-connections/types";
import { LocalFileSystem } from "../file-connections/providers/local";
import * as connectionsSvc from "../services/connections.service";
import * as secretsSvc from "../services/secrets.service";
import { getDb } from "../db/connection";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MigrationScope {
  characters: boolean;
  worldBooks: boolean;
  personas: boolean;
  chats: boolean;
  groupChats: boolean;
  connections: boolean;
  repairExisting?: boolean;
  dryRun?: boolean;
}

export interface MigrationResults {
  characters?: { imported: number; skipped: number; failed: number };
  world_books?: { imported: number; failed: number; total_entries: number };
  personas?: { imported: number; failed: number; avatars_uploaded: number };
  chats?: { imported: number; failed: number; total_messages: number };
  group_chats?: { imported: number; failed: number; skipped: number; total_messages: number };
  connections?: { imported: number; repaired: number; skipped: number; failed: number; dry_run: boolean };
}

interface ConnectionCandidate {
  name: string;
  provider: string;
  api_url: string;
  model: string;
  api_key?: string;
  metadata: Record<string, unknown>;
}

const normalized = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalizedName = (value: unknown) => normalized(value).replace(/\s+/g, " ");

function inferProvider(api: string, apiUrl: string): string {
  const value = api.toLowerCase();
  const url = apiUrl.toLowerCase();
  if (value === "claude") return "anthropic";
  if (value === "google" || value === "makersuite") return "google";
  if (value === "vertexai") return "google_vertex";
  if (value === "openai") return url.includes("api.openai.com") || !url ? "openai" : "custom";
  if (value === "infermaticai") return "infermatic";
  for (const [needle, provider] of [["openrouter.ai", "openrouter"], ["api.deepseek.com", "deepseek"], ["api.groq.com", "groq"], ["api.mistral.ai", "mistral"], ["api.x.ai", "xai"], ["api.fireworks.ai", "fireworks"], ["api.perplexity.ai", "perplexity"], ["electronhub", "electronhub"], ["siliconflow", "siliconflow"], ["nano-gpt.com", "nanogpt"], ["chutes.ai", "chutes"], ["infermatic", "infermatic"], ["pollinations.ai", "pollinations_text"]] as const) {
    if (url.includes(needle)) return provider;
  }
  return value === "openrouter" || value === "groq" || value === "mistral" ? value : "custom";
}

function connectionKey(value: Pick<ConnectionCandidate, "name" | "provider" | "api_url" | "model">): string {
  return [value.name, value.provider, value.api_url.replace(/\/+$/, ""), value.model]
    .map((part) => part.trim().toLowerCase()).join("\0");
}

function secretLookup(secrets: Record<string, Array<{ id?: string; value?: string; active?: boolean }>>) {
  const byId = new Map<string, string>();
  const activeByCategory = new Map<string, string>();
  for (const [category, entries] of Object.entries(secrets)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) if (normalized(entry.id) && normalized(entry.value)) byId.set(normalized(entry.id), normalized(entry.value));
    const selected = entries.find((entry) => entry?.active && normalized(entry.value)) ?? entries.find((entry) => normalized(entry.value));
    if (selected && normalized(selected.value)) activeByCategory.set(category, normalized(selected.value));
  }
  return { byId, activeByCategory };
}

function resolveProfileSecret(profile: any, provider: string, lookup: ReturnType<typeof secretLookup>): string | undefined {
  const id = normalized(profile["secret-id"]);
  if (id && lookup.byId.has(id)) return lookup.byId.get(id);
  const api = normalized(profile.api).toLowerCase();
  const categories = [`api_key_${api}`, `api_key_${provider}`];
  if (provider === "anthropic") categories.push("api_key_claude");
  if (provider === "google") categories.push("api_key_makersuite", "api_key_makersuite_custom");
  if (provider === "google_vertex") categories.push("api_key_vertexai", "vertexai_service_account_json");
  if (provider === "custom") categories.push("api_key_custom", "api_key_generic");
  return categories.map((category) => lookup.activeByCategory.get(category)).find(Boolean);
}

export async function importSTConnections(userId: string, dataDir: string, options: { repairExisting?: boolean; dryRun?: boolean }, logger: MigrationLogger, fs: FileSystem): Promise<{ imported: number; repaired: number; skipped: number; failed: number; dry_run: boolean }> {
  const [profiles, proxies, secrets] = await Promise.all([readConnectionsFromDisk(dataDir, fs), readProxiesFromDisk(dataDir, fs), readSecretsFromDisk(dataDir, fs)]);
  const lookup = secretLookup(secrets);
  const candidates: ConnectionCandidate[] = [];
  let skipped = 0;
  for (const profile of profiles) {
    if (normalized(profile.mode).toLowerCase() === "tc") { skipped++; continue; }
    const name = normalizedName(profile.name);
    const api_url = normalized(profile["api-url"]);
    if (!name || !api_url) { skipped++; continue; }
    const provider = inferProvider(normalized(profile.api), api_url);
    candidates.push({ name, provider, api_url, model: normalized(profile.model), api_key: resolveProfileSecret(profile, provider, lookup), metadata: { source: "sillytavern", source_kind: "connection_profile", st_profile_id: normalized(profile.id) || undefined, st_api: normalized(profile.api) || undefined, st_mode: normalized(profile.mode) || undefined, st_direct_api_url: api_url, st_proxy_name: normalizedName(profile.proxy) || undefined, st_preset: normalized(profile.preset) || undefined } });
  }
  for (const proxy of proxies) {
    const proxyName = normalizedName(proxy.name);
    const api_url = normalized(proxy.url);
    if (!proxyName || proxyName.toLowerCase() === "none" || !api_url) { skipped++; continue; }
    candidates.push({ name: `Proxy: ${proxyName}`, provider: inferProvider("custom", api_url), api_url, model: "", api_key: normalized(proxy.password) || undefined, metadata: { source: "sillytavern", source_kind: "reverse_proxy", st_proxy_name: proxyName } });
  }
  const existing = getDb().query("SELECT * FROM connection_profiles WHERE user_id = ?").all(userId).map((row: any) => ({ ...row, metadata: JSON.parse(row.metadata) }));
  const existingKeys = new Set(existing.map(connectionKey));
  const seen = new Set<string>();
  const planned = candidates.filter((candidate) => {
    const key = connectionKey(candidate);
    if (existingKeys.has(key) || seen.has(key)) { skipped++; return false; }
    seen.add(key); return true;
  });
  if (options.dryRun) return { imported: planned.length, repaired: 0, skipped, failed: 0, dry_run: true };

  const createdIds: string[] = [];
  const repaired: Array<{ profile: any; secret: string | null }> = [];
  let imported = 0;
  let repairedCount = 0;
  try {
    for (let index = 0; index < planned.length; index++) {
      logger.progress("Importing connections", index + 1, planned.length);
      const candidate = planned[index];
      const sourceKind = candidate.metadata.source_kind;
      const repairTarget = options.repairExisting ? existing.find((profile) => profile.metadata?.source === "sillytavern" && profile.metadata?.source_kind === sourceKind && ((sourceKind === "connection_profile" && candidate.metadata.st_profile_id && profile.metadata.st_profile_id === candidate.metadata.st_profile_id) || (sourceKind === "reverse_proxy" && profile.metadata.st_proxy_name === candidate.metadata.st_proxy_name))) : undefined;
      if (repairTarget) {
        repaired.push({ profile: repairTarget, secret: repairTarget.has_api_key ? await secretsSvc.getSecret(userId, connectionsSvc.connectionSecretKey(repairTarget.id)) : null });
        await connectionsSvc.updateConnection(userId, repairTarget.id, { ...candidate, is_default: false });
        repairedCount++;
      } else {
        const created = await connectionsSvc.createConnection(userId, { ...candidate, is_default: false });
        createdIds.push(created.id);
        imported++;
      }
    }
    return { imported, repaired: repairedCount, skipped, failed: 0, dry_run: false };
  } catch {
    for (const id of createdIds) {
      getDb().query("DELETE FROM connection_profiles WHERE id = ? AND user_id = ?").run(id, userId);
      secretsSvc.deleteSecret(userId, connectionsSvc.connectionSecretKey(id));
    }
    for (const snapshot of repaired.reverse()) {
      const { profile } = snapshot;
      await connectionsSvc.updateConnection(userId, profile.id, { name: profile.name, provider: profile.provider, api_url: profile.api_url, model: profile.model, preset_id: profile.preset_id, is_default: profile.is_default, metadata: profile.metadata, api_key: snapshot.secret ?? "" });
    }
    logger.error("Connection migration failed and was rolled back");
    throw new Error("Connection migration failed");
  }
}

export interface MigrationProgressSnapshot {
  phase: string;
  label: string;
  current: number;
  total: number;
  updatedAt: number;
}

export interface MigrationLogSnapshot {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

interface MigrationState {
  migrationId: string;
  callerUserId: string;
  targetUserId: string;
  phase: string;
  startedAt: number;
  results: MigrationResults | null;
  error: string | null;
  completed: boolean;
  progress: MigrationProgressSnapshot | null;
  recentLogs: MigrationLogSnapshot[];
}

const MAX_RECENT_LOGS = 200;
const PROGRESS_EMIT_INTERVAL_MS = 150;

// ─── In-memory lock ─────────────────────────────────────────────────────────

const activeMigrations = new Map<string, MigrationState>();
let currentMigrationId: string | null = null;

export function getActiveMigration(): MigrationState | null {
  if (!currentMigrationId) return null;
  return activeMigrations.get(currentMigrationId) ?? null;
}

export function getLastMigration(): MigrationState | null {
  let latest: MigrationState | null = null;
  for (const state of activeMigrations.values()) {
    if (state.completed && (!latest || state.startedAt > latest.startedAt)) {
      latest = state;
    }
  }
  return latest;
}

export function isMigrationRunning(): boolean {
  return currentMigrationId !== null;
}

// ─── Logger factory ─────────────────────────────────────────────────────────

function createWsLogger(migrationId: string, callerUserId: string): MigrationLogger {
  let lastProgressEmit: MigrationProgressSnapshot | null = null;

  const appendLog = (level: "info" | "warn" | "error", message: string) => {
    const state = activeMigrations.get(migrationId);
    if (!state) return;
    state.recentLogs.push({ level, message, timestamp: Date.now() });
    if (state.recentLogs.length > MAX_RECENT_LOGS) {
      state.recentLogs.splice(0, state.recentLogs.length - MAX_RECENT_LOGS);
    }
  };

  const updateProgress = (phase: string, label: string, current: number, total: number) => {
    const progress: MigrationProgressSnapshot = {
      phase,
      label,
      current,
      total,
      updatedAt: Date.now(),
    };

    const state = activeMigrations.get(migrationId);
    if (state) state.progress = progress;

    const shouldEmit = !lastProgressEmit
      || progress.phase !== lastProgressEmit.phase
      || progress.label !== lastProgressEmit.label
      || progress.current <= 1
      || progress.current >= progress.total
      || progress.updatedAt - lastProgressEmit.updatedAt >= PROGRESS_EMIT_INTERVAL_MS;

    if (!shouldEmit) return;

    lastProgressEmit = progress;
    eventBus.emit(EventType.MIGRATION_PROGRESS, {
      migrationId,
      phase: progress.phase,
      label: progress.label,
      current: progress.current,
      total: progress.total,
    }, callerUserId);
  };

  return {
    info(message: string) {
      appendLog("info", message);
      eventBus.emit(EventType.MIGRATION_LOG, { migrationId, level: "info", message }, callerUserId);
    },
    warn(message: string) {
      appendLog("warn", message);
      eventBus.emit(EventType.MIGRATION_LOG, { migrationId, level: "warn", message }, callerUserId);
    },
    error(message: string) {
      appendLog("error", message);
      eventBus.emit(EventType.MIGRATION_LOG, { migrationId, level: "error", message }, callerUserId);
    },
    progress(label: string, current: number, total: number) {
      const state = activeMigrations.get(migrationId);
      updateProgress(state?.phase ?? "unknown", label, current, total);
    },
  };
}

// ─── Default filesystem singleton ──────────────────────────────────────────

const defaultFs = new LocalFileSystem();

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function executeMigration(
  migrationId: string,
  callerUserId: string,
  targetUserId: string,
  dataDir: string,
  scope: MigrationScope,
  fs: FileSystem = defaultFs,
): Promise<void> {
  const startTime = Date.now();
  let importedCharacterCount = 0;
  let characterImportAttempted = false;

  const state: MigrationState = {
    migrationId,
    callerUserId,
    targetUserId,
    phase: "starting",
    startedAt: startTime,
    results: null,
    error: null,
    completed: false,
    progress: null,
    recentLogs: [],
  };

  activeMigrations.set(migrationId, state);
  currentMigrationId = migrationId;

  const logger = createWsLogger(migrationId, callerUserId);

  // Helper to emit phase transitions so the frontend always tracks state
  const setPhase = (phase: string) => {
    state.phase = phase;
    state.progress = {
      phase,
      label: phase,
      current: 0,
      total: 0,
      updatedAt: Date.now(),
    };
    eventBus.emit(EventType.MIGRATION_PROGRESS, {
      migrationId,
      phase,
      label: phase,
      current: 0,
      total: 0,
    }, callerUserId);
  };

  try {
    if (!(await fs.exists(dataDir))) {
      throw new Error(`Data directory no longer exists: ${dataDir}`);
    }

    setPhase("scanning");
    logger.info("Scanning SillyTavern data directory...");
    const counts = await scanSTData(dataDir, fs);
    const results: MigrationResults = {};

    if (scope.connections && (counts.connections > 0 || counts.proxies > 0)) {
      setPhase("connections");
      logger.info("Importing SillyTavern connections...");
      const connectionResult = await importSTConnections(targetUserId, dataDir, scope, logger, fs);
      results.connections = connectionResult;
      logger.info(`Connections: ${connectionResult.imported} imported, ${connectionResult.repaired} repaired, ${connectionResult.skipped} skipped`);
    }

    // Characters (needed first for filenameToId mapping)
    let filenameToId = new Map<string, string>();
    if (scope.characters && counts.characters > 0) {
      characterImportAttempted = true;
      setPhase("characters");
      logger.info(`Importing ${counts.characters} characters...`);
      const charResult = await importCharacters(targetUserId, dataDir, logger, fs);
      filenameToId = charResult.filenameToId;
      results.characters = {
        imported: charResult.imported,
        skipped: charResult.skipped,
        failed: charResult.failed,
      };
      importedCharacterCount = charResult.imported;
      logger.info(`Characters: ${charResult.imported} imported, ${charResult.skipped} skipped, ${charResult.failed} failed`);
    }

    // World Books
    let worldBookNameToId = new Map<string, string>();
    if (scope.worldBooks && counts.worldBooks > 0) {
      setPhase("worldBooks");
      logger.info(`Importing ${counts.worldBooks} world books...`);
      const wbResult = await importWorldBooks(targetUserId, dataDir, logger, fs);
      worldBookNameToId = wbResult.nameToId;
      results.world_books = {
        imported: wbResult.imported,
        failed: wbResult.failed,
        total_entries: wbResult.totalEntries,
      };
      logger.info(`World books: ${wbResult.imported} imported (${wbResult.totalEntries} entries), ${wbResult.failed} failed`);
    }

    // Personas
    let personaNameToId = new Map<string, string>();
    if (scope.personas && counts.personas > 0) {
      setPhase("personas");
      logger.info(`Importing ${counts.personas} personas...`);
      const pResult = await importPersonas(targetUserId, dataDir, worldBookNameToId, logger, fs);
      personaNameToId = pResult.nameToId;
      results.personas = {
        imported: pResult.imported,
        failed: pResult.failed,
        avatars_uploaded: pResult.avatarsUploaded,
      };
      logger.info(`Personas: ${pResult.imported} imported, ${pResult.failed} failed, ${pResult.avatarsUploaded} avatars`);
    }

    // Chats
    if (scope.chats && counts.totalChatFiles > 0) {
      setPhase("chats");
      logger.info(`Importing chats...`);
      const chatResult = await importChats(targetUserId, dataDir, filenameToId, personaNameToId, logger, fs);
      results.chats = {
        imported: chatResult.imported,
        failed: chatResult.failed,
        total_messages: chatResult.totalMessages,
      };
      logger.info(`Chats: ${chatResult.imported} imported (${chatResult.totalMessages} messages), ${chatResult.failed} failed`);
      if (chatResult.skippedChars > 0) {
        logger.warn(`${chatResult.skippedChars} character(s) not found — their chats were skipped`);
      }
    }

    // Group Chats
    if (scope.groupChats && counts.groupChats > 0) {
      setPhase("groupChats");
      logger.info(`Importing group chats...`);
      const gcResult = await importGroupChats(targetUserId, dataDir, filenameToId, personaNameToId, logger, fs);
      results.group_chats = {
        imported: gcResult.imported,
        failed: gcResult.failed,
        skipped: gcResult.skipped,
        total_messages: gcResult.totalMessages,
      };
      logger.info(`Group chats: ${gcResult.imported} imported (${gcResult.totalMessages} messages), ${gcResult.failed} failed`);
      if (gcResult.skipped > 0) {
        logger.warn(`${gcResult.skipped} group(s) skipped — no members found`);
      }
    }

    const durationMs = Date.now() - startTime;
    state.results = results;
    state.completed = true;
    state.phase = "completed";

    eventBus.emit(EventType.MIGRATION_COMPLETED, {
      migrationId,
      durationMs,
      results,
    }, callerUserId);

    logger.info(`Migration complete in ${(durationMs / 1000).toFixed(1)}s`);
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    state.error = errorMsg;
    state.completed = true;
    state.phase = "failed";

    eventBus.emit(EventType.MIGRATION_FAILED, {
      migrationId,
      error: errorMsg,
    }, callerUserId);

    logger.error(`Migration failed: ${errorMsg}`);
  } finally {
    // A character batch or later phase can fail after earlier batches commit.
    // Always invalidate after an attempted character phase—even when the final
    // imported count is unavailable—because per-character events are suppressed.
    if (characterImportAttempted) {
      eventBus.emit(EventType.CHARACTER_LIBRARY_CHANGED, {
        reason: "sillytavern_migration",
        migrationId,
        imported: importedCharacterCount,
      }, targetUserId);
    }
    currentMigrationId = null;
    // Disconnect remote filesystems when migration ends
    if (fs.type !== "local") {
      try { await fs.disconnect(); } catch { /* ignore */ }
    }
  }
}
