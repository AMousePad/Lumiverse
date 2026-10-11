import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import type { ExtensionInfo, SpindleManifest } from "lumiverse-spindle-types";
import * as generateSvc from "../services/generate.service";
import { WorkerHost } from "./worker-host";
import { providerRegistry } from "./provider-registry";

const dryRun = spyOn(generateSvc, "dryRunGeneration");
afterAll(() => dryRun.mockRestore());
afterEach(() => {
  dryRun.mockReset();
  providerRegistry.reset();
});

function fixture(scope: "user" | "operator" = "user", permitted = true) {
  const host = new WorkerHost("generation-api-test", {
    identifier: "generation-api-test", name: "Generation API test",
  } as SpindleManifest, {
    id: "generation-api-test", identifier: "generation-api-test", name: "Generation API test",
    version: "0.0.0", author: "", description: "", github: "", homepage: "",
    permissions: [], granted_permissions: [], enabled: true, installed_at: 0, updated_at: 0,
    has_frontend: false, has_backend: false, status: "stopped",
    metadata: { install_scope: scope, installed_by_user_id: "alice" },
  } satisfies ExtensionInfo);
  const internal = host as unknown as {
    hasPermission(permission: string): boolean;
    handleMessage(message: unknown): void;
    runtime: { mode: string; pid: null; postMessage(message: unknown): void; terminate(): void };
  };
  internal.hasPermission = permission => permitted && permission === "generation";
  return (message: Record<string, unknown>) => new Promise<any>(resolve => {
    internal.runtime = { mode: "worker", pid: null, postMessage: resolve, terminate() {} };
    internal.handleMessage({ requestId: "request", ...message });
  });
}

const baseResult: generateSvc.DryRunResult = {
  messages: [], breakdown: [], parameters: {}, model: "test", provider: "test",
};

test("dry run preserves context clipping statistics and a zero history-token count", async () => {
  const contextClipStats = {
    enabled: true, maxContext: 8192, maxResponseTokens: 1024, safetyMargin: 128,
    inputBudget: 7040, fixedTokens: 100, remainingHistoryBudget: 6940,
    chatHistoryTokensBefore: 8000, chatHistoryTokensAfter: 6900,
    messagesDropped: 2, tokensDropped: 1100, tokenizerUsed: "test",
  };
  dryRun.mockResolvedValue({ ...baseResult, chatHistoryTokens: 0, contextClipStats });
  const response = await fixture()({ type: "generate_dry_run", input: { chatId: "chat" } });
  expect(response).toMatchObject({ type: "response", requestId: "request", result: {
    ...baseResult, chatHistoryTokens: 0, contextClipStats,
  } });
  expect(dryRun.mock.calls[0]?.[0]).toMatchObject({ userId: "alice", chat_id: "chat" });
});

test("dry run leaves unavailable counts and clipping statistics undefined", async () => {
  dryRun.mockResolvedValue(baseResult);
  const response = await fixture()({ type: "generate_dry_run", input: { chatId: "chat" } });
  expect(response.result.chatHistoryTokens).toBeUndefined();
  expect(response.result.contextClipStats).toBeUndefined();
});

test("dry run still requires generation permission and enforces user scope", async () => {
  const request = { type: "generate_dry_run", input: { chatId: "chat" } };
  expect((await fixture("user", false)(request)).error).toContain("generation");
  expect((await fixture("operator")(request)).error).toContain("userId is required");
  expect(dryRun).not.toHaveBeenCalled();
  dryRun.mockResolvedValue(baseResult);
  await fixture()({ ...request, userId: "bob" });
  expect(dryRun.mock.calls[0]?.[0].userId).toBe("alice");
});
