import { expect, test } from "bun:test";
import { join } from "path";

import { PROJECT_ROOT } from "./lib/constants";
import { serverLaunchTransport } from "./server-manager";
import { spawnSocketControlledProcess } from "./socket-controlled-process";

test("the backend launcher avoids Bun IPC only on Windows", () => {
  expect(serverLaunchTransport("win32")).toBe("socket");
  expect(serverLaunchTransport("darwin")).toBe("ipc");
  expect(serverLaunchTransport("linux")).toBe("ipc");
});

test("the socket-controlled spawn exchanges messages with a real backend process", async () => {
  const ready = Promise.withResolvers<{ type: string; pid: number }>();
  const pong = Promise.withResolvers<{ type: string; value: string }>();
  const disconnected = Promise.withResolvers<void>();
  const errors: string[] = [];
  let launched: ReturnType<typeof spawnSocketControlledProcess> | null = null;
  let exited = false;

  try {
    launched = spawnSocketControlledProcess({
      cmd: [
        process.execPath,
        join(PROJECT_ROOT, "scripts", "runner", "fixtures", "runner-control-child.ts"),
      ],
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      onMessage(message) {
        const received = message as { type?: unknown; pid?: unknown; value?: unknown };
        if (received.type === "ready") ready.resolve(received as { type: string; pid: number });
        if (received.type === "pong") pong.resolve(received as { type: string; value: string });
      },
      onError(message) {
        errors.push(message);
      },
      onDisconnect() {
        disconnected.resolve();
      },
    });

    const readyMessage = await Promise.race([
      ready.promise,
      Bun.sleep(5_000).then(() => { throw new Error("Child ready message timed out"); }),
    ]);
    expect(readyMessage.pid).toBe(launched.proc.pid);

    expect(launched.control.send({ type: "ping", value: "windows-spawn" })).toBe(true);
    expect(await Promise.race([
      pong.promise,
      Bun.sleep(5_000).then(() => { throw new Error("Child pong message timed out"); }),
    ])).toEqual({ type: "pong", value: "windows-spawn" });

    expect(launched.control.send({ type: "shutdown" })).toBe(true);
    expect(await Promise.race([
      launched.proc.exited,
      Bun.sleep(5_000).then(() => { throw new Error("Child shutdown timed out"); }),
    ])).toBe(0);
    exited = true;
    await Promise.race([
      disconnected.promise,
      Bun.sleep(5_000).then(() => { throw new Error("Control disconnect timed out"); }),
    ]);
    expect(errors).toEqual([]);
  } finally {
    launched?.control.close();
    if (launched && !exited) {
      launched.proc.kill();
      await launched.proc.exited;
    }
  }
}, 15_000);
