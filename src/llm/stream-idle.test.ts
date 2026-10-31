import { expect, test } from "bun:test";

test("provider streams survive Bun's implicit socket idle timeout", async () => {
  const helper = new URL("./stream-utils.ts", import.meta.url).href;
  const source = `
    import { fetchWithPreflightAbort } from ${JSON.stringify(helper)};
    const server = Bun.serve({ port: 0, idleTimeout: 0, fetch() {
      let timer;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("reasoning\\n"));
          timer = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("answer\\n"));
            controller.close();
          }, 12000);
        },
        cancel() { clearTimeout(timer); },
      }));
    } });
    try {
      const url = "http://127.0.0.1:" + server.port;
      const result = await Promise.all([
        fetch(url).then(r => r.text()).catch(error => error.message),
        fetchWithPreflightAbort(url, {}, undefined).then(r => r.text()),
      ]);
      console.log(JSON.stringify(result));
    } finally { server.stop(true); }
  `;
  const child = Bun.spawn([process.execPath, "-e", source], {
    env: { ...process.env, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "2" }, stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill(), 18000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["The operation timed out.", "reasoning\nanswer\n"]);
  } finally { clearTimeout(deadline); child.kill(); }
}, 20000);
