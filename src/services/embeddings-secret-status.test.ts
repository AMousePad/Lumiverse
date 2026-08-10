import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as secretsSvc from "./secrets.service";
import { __test__ } from "./embeddings.service";

const spies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
});

describe("embedding secret status", () => {
  test("treats an unreadable API key as missing", async () => {
    spies.push(
      spyOn(secretsSvc, "getSecretForStatus").mockResolvedValue(null),
    );

    await expect(__test__.hasEmbeddingSecret("broken-secret-user", "openai-compatible")).resolves.toBe(false);
  });

  test("does not hide unrelated secret-store failures", async () => {
    spies.push(spyOn(secretsSvc, "getSecretForStatus").mockRejectedValue(new Error("database is locked")));

    await expect(
      __test__.hasEmbeddingSecret("database-error-user", "openai-compatible"),
    ).rejects.toThrow("database is locked");
  });
});
