import { deserialize, serialize } from "node:v8";
import type { DatabaseChildMessage, DatabaseHostMessage } from "./execution-protocol";

type DatabaseMessage = DatabaseChildMessage | DatabaseHostMessage;

/** Binary framing retains undefined metadata deletions, blobs, and bigint. */
export function encodeDatabaseMessage(message: DatabaseMessage): Buffer {
  const body = serialize(message);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.byteLength);
  return Buffer.concat([header, body]);
}

export async function readDatabaseMessages(
  stream: ReadableStream<Uint8Array>,
  receive: (message: DatabaseMessage) => void,
): Promise<void> {
  const reader = stream.getReader();
  const header = Buffer.allocUnsafe(4);
  let headerOffset = 0;
  let body: Buffer | null = null;
  let bodyOffset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        if (!body) {
          const count = Math.min(4 - headerOffset, value.byteLength - offset);
          header.set(value.subarray(offset, offset + count), headerOffset);
          offset += count;
          headerOffset += count;
          if (headerOffset !== 4) continue;
          const length = header.readUInt32BE();
          if (length === 0 || length > 0x7fffffff) throw new Error("Invalid database message length");
          body = Buffer.allocUnsafe(length);
          bodyOffset = 0;
        }
        const count = Math.min(body.byteLength - bodyOffset, value.byteLength - offset);
        body.set(value.subarray(offset, offset + count), bodyOffset);
        offset += count;
        bodyOffset += count;
        if (bodyOffset === body.byteLength) {
          const message = deserialize(body) as DatabaseMessage;
          body = null;
          headerOffset = 0;
          receive(message);
        }
      }
    }
    if (headerOffset !== 0 || body) throw new Error("Database message stream ended mid-frame");
  } finally {
    reader.releaseLock();
  }
}

export function createDatabaseSubprocessChannel(
  receive: (message: DatabaseHostMessage) => void,
  disconnect: () => void,
): { send: (message: DatabaseChildMessage) => void } {
  if (process.argv[3] === "--stdio") {
    // Periodic SQLite diagnostics must not mix text into the binary channel.
    console.log = console.error.bind(console);
    console.info = console.error.bind(console);
    console.debug = console.error.bind(console);
    process.stdout.on("error", disconnect);
    void readDatabaseMessages(Bun.stdin.stream(), (message) => receive(message as DatabaseHostMessage)).then(disconnect, disconnect);
    return { send: (message) => { process.stdout.write(encodeDatabaseMessage(message)); } };
  }
  if (typeof process.send !== "function") throw new Error("Database subprocess requires a transport");
  process.on("message", (message) => receive(message as DatabaseHostMessage));
  process.on("disconnect", disconnect);
  return { send: (message) => { process.send!(message); } };
}
