import { appendFileSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ReleaseAPI, sourceFingerprint } from "./desktop-release";
import { publishDesktopRelease, type ReleaseBuild } from "./publish-desktop-release";

export const SOURCE_REPOSITORY = "prolix-oc/Lumiverse";
export const BUILDER_REPOSITORY = "prolix-oc/Lumiverse-Builds";
export const LINUX_TARGETS = { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" } as const;
export function hostedReleasePlatforms(channel: string) {
  if (channel !== "nightly" && channel !== "stable") throw new Error("Unsupported release channel");
  const platforms = [
    { os: "macos-15", platform: "darwin-aarch64", target: "aarch64-apple-darwin", bundles: "app,dmg" },
    { os: "macos-15-intel", platform: "darwin-x86_64", target: "x86_64-apple-darwin", bundles: "app,dmg" },
    { os: "ubuntu-22.04", platform: "linux-x86_64", target: "x86_64-unknown-linux-gnu", bundles: "appimage" },
    { os: "ubuntu-22.04-arm", platform: "linux-aarch64", target: "aarch64-unknown-linux-gnu", bundles: "appimage" },
    { os: "windows-2022", platform: "windows-x86_64", target: "x86_64-pc-windows-msvc", bundles: "nsis" },
    { os: "windows-11-arm", platform: "windows-aarch64", target: "aarch64-pc-windows-msvc", bundles: "nsis" },
  ];
  return platforms.filter(p => channel === "stable" || !p.platform.startsWith("linux-"));
}
export interface LinuxReleaseRequest extends ReleaseBuild {
  format: 1; repository: string; run: string; attempt: string; publicKey: string;
}
interface Run {
  id: number; run_attempt: number; event: string; path: string; head_branch: string;
  status: string; conclusion: string | null; display_title: string;
  repository: { full_name: string }; head_repository: { full_name: string };
}
interface Artifact { id: number; name: string; size_in_bytes: number; expired: boolean }
export class NoReleaseRequestError extends Error {}
export function validateRequest(value: unknown): LinuxReleaseRequest {
  const request = value as LinuxReleaseRequest;
  if (!request || request.format !== 1 || request.repository !== SOURCE_REPOSITORY || request.channel !== "nightly"
    || !/^[1-9]\d*$/.test(request.run) || !/^[1-9]\d*$/.test(request.attempt)
    || !/^\d+\.\d+\.\d+-nightly\.\d{8}\.[1-9]\d*$/.test(request.version)
    || request.version.split(".").at(-1) !== request.run || request.tag !== `desktop-v${request.version}`
    || !/^[a-f0-9]{40}$/.test(request.sha) || !/^[a-f0-9]{64}$/.test(request.fingerprint)
    || !/^[A-Za-z0-9+/=]{20,512}$/.test(request.publicKey)) throw new Error("Invalid private Linux release request");
  return request;
}
export function validateParent(run: Run, request: LinuxReleaseRequest) {
  if (String(run.id) !== request.run || run.run_attempt !== Number(request.attempt)
    || run.repository.full_name !== SOURCE_REPOSITORY || run.head_repository.full_name !== SOURCE_REPOSITORY
    || !["workflow_dispatch", "schedule"].includes(run.event) || !["main", "staging"].includes(run.head_branch)
    || ![".github/workflows/desktop-build.yml", ".github/workflows/desktop-nightly.yml"].includes(run.path)) {
    throw new Error("Release request does not belong to a trusted nightly workflow run");
  }
}
export const builderRunName = (request: LinuxReleaseRequest) => `Linux release ${request.run}.${request.attempt}`;
const requestArtifactName = (attempt: string) => `linux-release-request-${attempt}`;
export const outputArtifactName = (request: LinuxReleaseRequest) => `linux-release-${request.run}-${request.attempt}`;
export class BridgeAPI {
  constructor(readonly token: string, readonly repository: string, readonly transport: typeof fetch = fetch) {
    if (!token) throw new Error("LINUX_RELEASE_BRIDGE_TOKEN is required for cross-repository Actions access");
  }
  async response(path: string, body?: unknown) {
    const response = await this.transport(`https://api.github.com/repos/${this.repository}${path}`, {
      method: body === undefined ? "GET" : "POST", headers: {
        Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub Actions request failed (${response.status}): ${path}`);
    return response;
  }
  async json<T>(path: string, body?: unknown): Promise<T> { return (await this.response(path, body)).json() as Promise<T>; }
  async artifacts(run: string): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.json<{ artifacts: Artifact[] }>(`/actions/runs/${run}/artifacts?per_page=100&page=${page}`);
      artifacts.push(...batch.artifacts);
      if (batch.artifacts.length < 100) return artifacts;
    }
  }
}
export async function resolveBuilderRun(api: BridgeAPI, request: LinuxReleaseRequest): Promise<{ ready: string; builder_run?: string }> {
  const runs = await api.json<{ workflow_runs: Run[] }>("/actions/workflows/linux-release.yml/runs?event=workflow_dispatch&per_page=100");
  const run = runs.workflow_runs.find(r => r.display_title === builderRunName(request));
  if (!run || run.status !== "completed") return { ready: "false" };
  if (run.conclusion !== "success" || run.head_branch !== "main" || run.repository.full_name !== BUILDER_REPOSITORY
    || run.head_repository.full_name !== BUILDER_REPOSITORY || run.path !== ".github/workflows/linux-release.yml") {
    throw new Error("Private Linux build did not complete successfully");
  }
  return { ready: "true", builder_run: String(run.id) };
}
export async function readRequest(api: BridgeAPI, runId: string, attempt: string): Promise<LinuxReleaseRequest> {
  if (!/^[1-9]\d*$/.test(runId) || !/^[1-9]\d*$/.test(attempt)) throw new Error("Invalid source run identity");
  const artifact = (await api.artifacts(runId)).find(a => a.name === requestArtifactName(attempt));
  if (!artifact) throw new NoReleaseRequestError("Release request artifact is missing");
  if (artifact.expired || artifact.size_in_bytes > 128_000) throw new Error("Release request artifact is missing or invalid");
  const response = await api.response(`/actions/artifacts/${artifact.id}/zip`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 128_000) throw new Error("Release request archive exceeds size limit");
  const temporary = mkdtempSync(join(tmpdir(), "lumiverse-request-"));
  try {
    const archive = join(temporary, "request.zip"); writeFileSync(archive, bytes);
    const extracted = Bun.spawnSync(["unzip", "-p", archive, "request.json"], { stdout: "pipe", stderr: "pipe" });
    if (extracted.exitCode !== 0 || extracted.stdout.length > 16_000) throw new Error("Invalid release request archive");
    const request = validateRequest(JSON.parse(extracted.stdout.toString()));
    if (request.run !== runId || request.attempt !== attempt) throw new Error("Release request run identity mismatch");
    validateParent(await api.json<Run>(`/actions/runs/${runId}`), request);
    return request;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function output(values: Record<string, string>) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(""));
}
export function verifyPayload(root: string, request: LinuxReleaseRequest, arch: keyof typeof LINUX_TARGETS) {
  const directory = join(root, arch);
  const metadata = JSON.parse(readFileSync(join(directory, "release.json"), "utf8"));
  for (const key of ["format", "repository", "run", "attempt", "sha", "fingerprint", "version", "tag", "channel", "publicKey"] as const) {
    if (metadata[key] !== request[key]) throw new Error(`Linux artifact provenance mismatch: ${key}`);
  }
  if (metadata.arch !== arch || metadata.target !== LINUX_TARGETS[arch]) throw new Error("Linux artifact architecture mismatch");
  const manifest = JSON.parse(readFileSync(join(directory, "runtime-manifest.json"), "utf8"));
  if (manifest.architecture !== arch || manifest.revision !== request.sha) throw new Error("Native runtime provenance mismatch");
  const images = readdirSync(directory).filter(name => name.endsWith(".AppImage"));
  if (images.length !== 1 || !/^[A-Za-z0-9_. -]+\.AppImage$/.test(images[0]!)) throw new Error("Expected exactly one Linux AppImage");
  const path = join(directory, images[0]!);
  if (!lstatSync(path).isFile()) throw new Error("AppImage must be a regular file");
  const checksum = readFileSync(join(directory, "SHA256SUMS"), "utf8").trim();
  const expected = /^([a-f0-9]{64})  ([^\r\n/\\]+)$/.exec(checksum);
  if (!expected || expected[2] !== images[0] || createHash("sha256").update(readFileSync(path)).digest("hex") !== expected[1]) {
    throw new Error("Linux AppImage checksum mismatch");
  }
  return path;
}
async function main() {
  const mode = process.argv[2];
  const publicApi = () => new BridgeAPI(process.env.GITHUB_TOKEN || process.env.LINUX_RELEASE_BRIDGE_TOKEN!, SOURCE_REPOSITORY);
  const requestFile = resolve(process.env.LINUX_RELEASE_REQUEST || "request.json");
  if (mode === "matrix") {
    output({ platforms: JSON.stringify(hostedReleasePlatforms(process.env.DESKTOP_CHANNEL!)) });
  } else if (mode === "request") {
    const request = validateRequest({ format: 1, repository: process.env.GITHUB_REPOSITORY,
      run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
      channel: process.env.DESKTOP_CHANNEL, version: process.env.DESKTOP_VERSION, tag: process.env.DESKTOP_TAG,
      sha: process.env.DESKTOP_SHA, fingerprint: process.env.DESKTOP_SOURCE, publicKey: process.env.LUMIVERSE_UPDATER_PUBLIC_KEY?.trim() });
    writeFileSync(requestFile, JSON.stringify(request, null, 2) + "\n");
  } else if (mode === "dispatch") {
    await new BridgeAPI(process.env.LINUX_RELEASE_BRIDGE_TOKEN!, BUILDER_REPOSITORY).response("/actions/workflows/linux-release.yml/dispatches", {
      ref: "main", inputs: { source_run: process.env.GITHUB_RUN_ID, source_attempt: process.env.GITHUB_RUN_ATTEMPT },
    });
    console.log("Queued Linux x64 and ARM64 builds in the private repository; no hosted runner waits for compilation.");
  } else if (mode === "fetch" || mode === "resolve") {
    let request: LinuxReleaseRequest;
    try {
      request = await readRequest(publicApi(), process.env.SOURCE_RUN_ID!, process.env.SOURCE_RUN_ATTEMPT!);
    } catch (error) {
      // A nightly with unchanged source succeeds without requesting a build.
      // Manual callbacks and malformed/expired requests still fail closed.
      if (mode === "resolve" && process.env.GITHUB_EVENT_NAME === "workflow_run" && error instanceof NoReleaseRequestError) {
        output({ ready: "false" }); console.log("This workflow did not request a Linux release build."); return;
      }
      throw error;
    }
    writeFileSync(requestFile, JSON.stringify(request, null, 2) + "\n");
    output({ source: request.sha, artifact: outputArtifactName(request), public_key: request.publicKey });
    if (mode === "resolve") {
      if (request.publicKey !== process.env.LUMIVERSE_UPDATER_PUBLIC_KEY?.trim()) throw new Error("Release public key has changed");
      const release = await new ReleaseAPI(SOURCE_REPOSITORY, process.env.GITHUB_TOKEN!).release(request.tag);
      if (release && !release.draft) {
        if (!release.body.includes(`<!-- lumiverse-bundled:${request.sha}:${request.fingerprint} -->`)) throw new Error("Published release source differs");
        // A duplicate callback may follow publication, or retry a failed feed
        // upload. Reuse the signed release without replacing its payloads.
        output({ ready: "false", published: "true" }); return;
      }
      const privateApi = new BridgeAPI(process.env.LINUX_RELEASE_BRIDGE_TOKEN!, BUILDER_REPOSITORY);
      const result = await resolveBuilderRun(privateApi, request);
      output(result);
      if (result.ready !== "true") console.log("Private Linux build is still queued or running.");
    }
  } else if (mode === "stage") {
    const request = validateRequest(JSON.parse(readFileSync(requestFile, "utf8")));
    const source = resolve(process.env.SOURCE_DIRECTORY || "source");
    if (sourceFingerprint(source) !== request.fingerprint) throw new Error("Source fingerprint differs from the release request");
    for (const arch of ["x64", "arm64"] as const) {
      const image = verifyPayload(resolve(process.env.LINUX_ARTIFACT_DIRECTORY || "linux-artifacts"), request, arch);
      const destination = join(source, "desktop/src-tauri/target", LINUX_TARGETS[arch], "release/bundle/appimage");
      mkdirSync(destination, { recursive: true }); copyFileSync(image, join(destination, image.split(/[\\/]/).at(-1)!));
    }
    if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV,
      Object.entries({ DESKTOP_CHANNEL: request.channel, DESKTOP_VERSION: request.version, DESKTOP_TAG: request.tag, DESKTOP_SHA: request.sha, DESKTOP_SOURCE: request.fingerprint }).map(([k, v]) => `${k}=${v}\n`).join(""));
  } else if (mode === "publish") {
    const request = validateRequest(JSON.parse(readFileSync(requestFile, "utf8")));
    const parent = await publicApi().json<Run>(`/actions/runs/${request.run}`);
    validateParent(parent, request);
    if (parent.status !== "completed") { console.log("Hosted builds have not finished; release remains a draft."); return; }
    if (parent.conclusion !== "success") throw new Error("Hosted release builds did not succeed");
    await publishDesktopRelease(new ReleaseAPI(SOURCE_REPOSITORY, process.env.GITHUB_TOKEN!), request);
  } else throw new Error("Use request, dispatch, fetch, resolve, stage or publish");
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
