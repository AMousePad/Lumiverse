import { Hono } from "hono";
import { resolve, sep } from "node:path";

const docsRoutes = new Hono();

const DOCS_ROOT = resolve(import.meta.dir, "../../user-docs/docs");

docsRoutes.get("/*", async (c) => {
  const prefix = "/api/v1/docs/";
  const requestPath = decodeURIComponent(c.req.path.slice(prefix.length))
    .replace(/^[/\\]+/, "");

  if (!requestPath) {
    return c.json({ error: "Document path required" }, 400);
  }

  const filePath = resolve(DOCS_ROOT, requestPath);

  // Never allow ../ traversal outside user-docs/docs.
  if (
    filePath !== DOCS_ROOT &&
    !filePath.startsWith(`${DOCS_ROOT}${sep}`)
  ) {
    return c.json({ error: "Invalid document path" }, 400);
  }

  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return c.json({ error: "Document not found" }, 404);
  }

  return new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Cache-Control": "no-cache",
    },
  });
});

export { docsRoutes };