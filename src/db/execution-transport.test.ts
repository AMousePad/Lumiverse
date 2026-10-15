import { expect, test } from "bun:test";
import { encodeDatabaseMessage, readDatabaseMessages } from "./execution-transport";

test("database pipe framing handles split headers, coalesced messages, and binary values", async () => {
  const first = { type: "result" as const, requestId: "first", durationMs: 0, result: { deleted: undefined, integer: 1n, bytes: new Uint8Array([1, 2, 3]) } };
  const second = { type: "ready" as const };
  const bytes = Buffer.concat([encodeDatabaseMessage(first), encodeDatabaseMessage(second)]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [start, end] of [[0, 1], [1, 3], [3, 7], [7, bytes.length]]) controller.enqueue(bytes.subarray(start, end));
      controller.close();
    },
  });
  const received: unknown[] = [];
  await readDatabaseMessages(stream, (message) => received.push(message));
  expect(received).toEqual([first, second]);
  expect(Object.hasOwn((received[0] as typeof first).result, "deleted")).toBe(true);
});

test("database pipe framing rejects truncated messages", async () => {
  const bytes = encodeDatabaseMessage({ type: "ready" });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes.subarray(0, bytes.length - 1)); controller.close(); },
  });
  const received: unknown[] = [];
  await expect(readDatabaseMessages(stream, (message) => received.push(message))).rejects.toThrow("ended mid-frame");
  expect(received).toEqual([]);
});
