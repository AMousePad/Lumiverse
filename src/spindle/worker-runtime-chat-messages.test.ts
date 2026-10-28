import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

for (const mode of ["worker", "process"] as const) {
  test(`lean chat API preserves options, sparse swipes and scoped patches over ${mode} transport`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `spindle-lean-chat-${mode}-`));
    const entry = join(directory, "backend.mjs");
    await Bun.write(entry, `
      const options = { tail: 2, light: true, includeExtra: false, ownMetadataOnly: true };
      spindle.registerMacro({ name: 'write', handler: () => spindle.chat.updateMessage('chat', 'message', { ownMetadata: null }) });
      const full = await spindle.chat.getMessages('chat');
      const lean = await spindle.chat.getMessages('chat', options);
      await spindle.chat.updateMessage('chat', 'message', { ownMetadata: { selected: true } });
      await spindle.chat.updateMessage('chat', 'message', { ownMetadata: null });
      spindle.sendToFrontend({ full, lean });
    `);
    const completed = Promise.withResolvers<any>();
    const macro = Promise.withResolvers<any>();
    const requests: any[] = [];
    const full = [{ id: "message", content: "B", swipe_id: 1, swipes: ["A", "B"], extra: { hidden: true }, hidden: true }];
    const lean = [{ id: "message", content: "B", swipe_id: 1, swipes: [null, "B"], hidden: true, metadata: { lean_chat: { selected: true } } }];
    let send: (message: unknown) => void;
    const onMessage = (message: any) => {
      if (message.type === "permissions_get_granted") {
        send({ type: "response", requestId: message.requestId, result: ["chat_mutation"] });
      } else if (message.type === "chat_get_messages" || message.type === "chat_update_message") {
        requests.push(message);
        send({ type: "response", requestId: message.requestId, result: message.type === "chat_update_message" ? true : message.options ? lean : full });
      } else if (message.type === "frontend_message") completed.resolve(message.payload);
      else if (message.type === "macro_result") macro.resolve(message);
      else if (message.type === "log" && message.level === "error") completed.reject(new Error(message.message));
    };
    let worker: Worker | undefined;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    const runtime = join(import.meta.dir, "worker-runtime.ts");
    if (mode === "worker") {
      worker = new Worker(runtime);
      worker.onmessage = event => onMessage(event.data);
      worker.onerror = error => completed.reject(error);
      send = message => worker!.postMessage(message);
    } else {
      child = Bun.spawn([process.execPath, runtime], { stdout: "ignore", stderr: "pipe", ipc: onMessage });
      send = message => child!.send(message);
    }
    const timer = setTimeout(() => {
      completed.reject(new Error("Lean chat runtime timed out"));
      macro.reject(new Error("Lean chat macro timed out"));
    }, 5000);
    try {
      send({
        type: "init",
        manifest: { identifier: "lean_chat", entry_backend: pathToFileURL(entry).href, permissions: ["chat_mutation"] },
        storagePath: directory,
        host: { descriptorVersion: 1, lumiverseVersion: "test", capabilities: { "chat-lean-messages-v1": 1 }, extensionInstallationId: "lean_chat" },
      });
      expect(await completed.promise).toEqual({ full, lean });
      expect(requests).toHaveLength(4);
      expect(requests[0].options).toBeUndefined();
      expect(requests[1].options).toEqual({ tail: 2, light: true, includeExtra: false, ownMetadataOnly: true });
      expect(requests[2].patch).toEqual({ ownMetadata: { selected: true } });
      expect(requests[3].patch).toEqual({ ownMetadata: null });
      expect(new Set(requests.map(request => request.requestId)).size).toBe(4);
      send({ type: "event", event: "__macro_invoke__", payload: { requestId: "preview", name: "write", context: { commit: false } } });
      expect((await macro.promise).error).toContain("not allowed during non-committing macro resolution");
      expect(requests).toHaveLength(4);
    } finally {
      clearTimeout(timer);
      worker?.terminate();
      if (child) { child.kill(); await child.exited; }
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
}
