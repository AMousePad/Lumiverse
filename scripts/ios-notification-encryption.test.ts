import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encryptAPNsPayload } from "../src/services/apns-encryption";

test.skipIf(process.platform !== "darwin")("backend notification envelopes decrypt with the actual native CryptoKit implementation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ios-notification-encryption-"));
  try {
    const key = Buffer.alloc(32, 23), keyId = createHash("sha256").update(key).digest("hex").slice(0, 32);
    const envelope = encryptAPNsPayload(JSON.stringify({ serverOrigin: "https://private.example",
      aps: { alert: { title: "Private name", body: "Private message 🦊" } } }), { key: key.toString("base64"), keyId }, "chat.lumiverse.ios", "production");
    const fixture = join(directory, "input.json"), binary = join(directory, "check");
    writeFileSync(fixture, JSON.stringify({ key: key.toString("base64"), envelope }));
    const build = Bun.spawn(["xcrun", "swiftc", "-module-cache-path", join(directory, "cache"),
      resolve(import.meta.dir, "../ios/native/ios/Sources/NotificationSecurity.swift"),
      resolve(import.meta.dir, "fixtures/ios-notification-encryption.swift"), "-o", binary], { stdout: "pipe", stderr: "pipe" });
    const errors = await new Response(build.stderr).text();
    expect(await build.exited, errors).toBe(0);
    const run = Bun.spawn([binary, fixture], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(run.stdout).text();
    expect(await run.exited).toBe(0); expect(output).toContain("PASS:");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
