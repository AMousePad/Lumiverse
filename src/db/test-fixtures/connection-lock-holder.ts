import { Database } from "bun:sqlite";

// Release the lock in another process: a timer on the test's thread cannot run
// while a synchronous SQLite caller is waiting in its busy handler.
const db = new Database(process.argv[2]!);
try {
  db.exec("BEGIN IMMEDIATE; UPDATE probe SET value = value + 1");
  await Bun.write(Bun.stdout, "locked\n");
  await Bun.sleep(500);
  db.exec("COMMIT");
} finally {
  db.close(true);
}
