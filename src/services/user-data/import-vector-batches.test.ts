import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { closeDatabase, getDb, initDatabase } from "../../db/connection";
import { env } from "../../env";

const config = { provider: "test", model: "test-model", dimension: 3 };
mock.module("../embeddings.service", () => ({ getEmbeddingConfig: async () => config }));
const batches: { id: string; vector: number[] }[][] = [];
mock.module("@lancedb/lancedb", () => ({ connect: async () => ({
  openTable: async () => ({ add: async (rows: { id: string; vector: Float32Array }[]) => {
    batches.push(rows.map(row => ({ id: row.id, vector: Array.from(row.vector) })));
  } }),
  close() {},
}) }));
const { startImport } = await import("./import.service");
let directory: string;
let originalDataDir: string;

beforeEach(async () => {
  closeDatabase();
  batches.length = 0;
  directory = mkdtempSync(join(tmpdir(), "lvbak-vector-batches-"));
  originalDataDir = env.dataDir;
  env.dataDir = directory;
  initDatabase(":memory:");
  getDb().run(await Bun.file(join(import.meta.dir, "../../db/baseline.sql")).text());
  getDb().query('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, 0)')
    .run("vector-import-user", "Vector import", "vectors@example.com");
});
afterEach(() => {
  closeDatabase();
  env.dataDir = originalDataDir;
  rmSync(directory, { recursive: true, force: true });
});

test("bounds vector batches by source bytes and restores a larger record on its own", async () => {
  const vector = new Float32Array([1, 2, 3]);
  const rows = [3, 3, 9, 3, 3].map((size, index) => ({
    id: `vector-${index}`,
    text: "x".repeat(size * 1024 * 1024),
    vector_b64: Buffer.from(vector.buffer).toString("base64"),
  }));
  const archivePath = join(directory, "vectors.lvbak");
  writeFileSync(archivePath, zipSync({
    "manifest.json": strToU8(JSON.stringify({
      schemaVersion: 1, producer: "lumiverse", archiveId: crypto.randomUUID(), exportedAt: 0,
      includeVectors: true, embeddingConfig: config, counts: {}, missingFiles: [],
    })),
    "lancedb/chat_vectors.ndjson": strToU8(rows.map(row => JSON.stringify(row)).join("\n") + "\n"),
  }));
  const job = startImport({ userId: "vector-import-user", archivePath, jobId: crypto.randomUUID() });
  const deadline = Date.now() + 5000;
  while (job.status === "running" && Date.now() < deadline) await Bun.sleep(5);
  expect(job.error).toBeNull();
  expect(job.status).toBe("complete");
  expect(batches.map(batch => batch.length)).toEqual([2, 1, 2]);
  expect(batches.flat()).toEqual(rows.map(row => ({ id: row.id, vector: [1, 2, 3] })));
});
