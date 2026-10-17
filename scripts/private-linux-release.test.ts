import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";
import { BridgeAPI, BUILDER_REPOSITORY, SOURCE_REPOSITORY, LINUX_TARGETS, NoReleaseRequestError, builderRunName, hostedReleasePlatforms, readRequest, resolveBuilderRun, validateParent, validateRequest, verifyPayload, type LinuxReleaseRequest } from "./private-linux-release";

const request: LinuxReleaseRequest = { format: 1, repository: SOURCE_REPOSITORY, channel: "nightly", run: "1234", attempt: "2",
  version: "0.3.2-nightly.20261016.1234", tag: "desktop-v0.3.2-nightly.20261016.1234",
  sha: "a".repeat(40), fingerprint: "b".repeat(64), publicKey: "c".repeat(80) };
const run = { id: 1234, run_attempt: 2, event: "workflow_dispatch", path: ".github/workflows/desktop-build.yml", head_branch: "staging",
  status: "in_progress", conclusion: null, display_title: "Nightly", repository: { full_name: SOURCE_REPOSITORY }, head_repository: { full_name: SOURCE_REPOSITORY } };
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

test("nightlies offload both Linux targets while stable platform routing stays unchanged", () => {
  expect(hostedReleasePlatforms("nightly").map(p => p.platform)).toEqual(["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "windows-aarch64"]);
  expect(hostedReleasePlatforms("stable")).toHaveLength(6);
  expect(() => hostedReleasePlatforms("pull_request")).toThrow();
});
test("release requests reject mismatched versions, identities, keys and shell input", () => {
  expect(validateRequest(request)).toEqual(request);
  for (const change of [{ channel: "stable" }, { repository: "other/repo" }, { run: "1234;id" }, { attempt: "0" },
    { version: "0.3.2-nightly.20261016.9999" }, { tag: "different" }, { sha: "z".repeat(40) },
    { fingerprint: "0\nINJECTED=1" }, { publicKey: "key\nINJECTED=1" }]) {
    expect(() => validateRequest({ ...request, ...change })).toThrow();
  }
});
test("requests must originate from the same trusted workflow attempt, never PRs or forks", () => {
  expect(() => validateParent(run, request)).not.toThrow();
  for (const change of [{ event: "pull_request" }, { head_branch: "feature" }, { path: ".github/workflows/untrusted.yml" },
    { run_attempt: 1 }, { id: 5678 }, { head_repository: { full_name: "fork/Lumiverse" } }]) {
    expect(() => validateParent({ ...run, ...change }, request)).toThrow();
  }
});
test("request downloads validate the artifact and original run before returning build metadata", async () => {
  const archive = zipSync({ "request.json": strToU8(JSON.stringify(request)) });
  let expired = false;
  const transport = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/artifacts?")) return Response.json({ artifacts: [{ id: 42, name: "linux-release-request-2", expired, size_in_bytes: archive.length }] });
    if (url.endsWith("/42/zip")) return new Response(new Uint8Array(archive).buffer);
    if (url.endsWith("/runs/1234")) return Response.json(run);
    throw new Error("Unexpected request");
  }) as typeof fetch;
  const api = new BridgeAPI("test-token", SOURCE_REPOSITORY, transport);
  expect(await readRequest(api, "1234", "2")).toEqual(request);
  expired = true;
  await expect(readRequest(api, "1234", "2")).rejects.toThrow("missing or invalid");
  await expect(readRequest(api, "../1234", "2")).rejects.toThrow("Invalid source");
  const empty = new BridgeAPI("test-token", SOURCE_REPOSITORY, (async (_input: RequestInfo | URL) => Response.json({ artifacts: [] })) as typeof fetch);
  await expect(readRequest(empty, "1234", "2")).rejects.toBeInstanceOf(NoReleaseRequestError);
});
test("completion joins only the matching successful private run and waits without polling", async () => {
  const completed = { ...run, id: 99, display_title: builderRunName(request), status: "completed", conclusion: "success",
    head_branch: "main", path: ".github/workflows/linux-release.yml", repository: { full_name: BUILDER_REPOSITORY }, head_repository: { full_name: BUILDER_REPOSITORY } };
  let runs = [completed];
  const api = new BridgeAPI("test-token", BUILDER_REPOSITORY, (async (_input: RequestInfo | URL) => Response.json({ workflow_runs: runs })) as typeof fetch);
  expect(await resolveBuilderRun(api, request)).toEqual({ ready: "true", builder_run: "99" });
  for (const change of [{ status: "in_progress" }, { status: "queued" }, { display_title: "Linux release 1234.1" }]) {
    runs = [{ ...completed, ...change }];
    expect(await resolveBuilderRun(api, request)).toEqual({ ready: "false" });
  }
  for (const change of [{ conclusion: "failure" }, { conclusion: "cancelled" }, { head_branch: "other" },
    { path: ".github/workflows/other.yml" }, { head_repository: { full_name: "other/repo" } }]) {
    runs = [{ ...completed, ...change }];
    await expect(resolveBuilderRun(api, request)).rejects.toThrow("did not complete successfully");
  }
});
function payload() {
  const root = mkdtempSync(join(tmpdir(), "lumiverse-linux-release-test-")); temporary.push(root);
  const directory = join(root, "arm64"); mkdirSync(directory);
  const image = join(directory, "Lumiverse.AppImage"); writeFileSync(image, "finalized payload");
  const checksum = createHash("sha256").update("finalized payload").digest("hex");
  writeFileSync(join(directory, "SHA256SUMS"), `${checksum}  Lumiverse.AppImage\n`);
  writeFileSync(join(directory, "release.json"), JSON.stringify({ ...request, arch: "arm64", target: LINUX_TARGETS.arm64 }));
  writeFileSync(join(directory, "runtime-manifest.json"), JSON.stringify({ architecture: "arm64", revision: request.sha }));
  return { root, directory, image };
}
test("payload verification binds exact bytes, version, runtime and architecture to the original request", () => {
  const f = payload(); expect(verifyPayload(f.root, request, "arm64")).toBe(f.image);
  writeFileSync(f.image, "modified payload"); expect(() => verifyPayload(f.root, request, "arm64")).toThrow("checksum");
  writeFileSync(f.image, "finalized payload");
  expect(() => verifyPayload(f.root, { ...request, version: "different" }, "arm64")).toThrow("provenance");
  writeFileSync(join(f.directory, "runtime-manifest.json"), JSON.stringify({ architecture: "x64", revision: request.sha }));
  expect(() => verifyPayload(f.root, request, "arm64")).toThrow("Native runtime");
});
test("payload verification rejects symlinks and checksum paths outside the artifact", () => {
  const f = payload();
  writeFileSync(join(f.directory, "SHA256SUMS"), "a".repeat(64) + "  ../outside.AppImage\n");
  expect(() => verifyPayload(f.root, request, "arm64")).toThrow("checksum");
  rmSync(f.image); symlinkSync(join(f.directory, "release.json"), f.image);
  expect(() => verifyPayload(f.root, request, "arm64")).toThrow("regular file");
});
