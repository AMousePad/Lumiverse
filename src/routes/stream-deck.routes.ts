import { Hono } from "hono";
import type { Context, Next } from "hono";
import * as tokens from "../services/stream-deck-token.service";
import * as characters from "../services/characters.service";
import * as chats from "../services/chats.service";

const management = new Hono();
const integration = new Hono();

management.get("/tokens", (c) => c.json({ data: tokens.listTokens(c.get("userId")) }));

management.post("/tokens", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(tokens.createToken(c.get("userId"), body), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid token request" }, 400);
  }
});

management.delete("/tokens/:id", (c) => {
  const deleted = tokens.deleteToken(c.get("userId"), c.req.param("id"));
  return deleted ? c.json({ success: true }) : c.json({ error: "Not found" }, 404);
});

declare module "hono" {
  interface ContextVariableMap {
    streamDeckScopes: tokens.StreamDeckScope[];
  }
}

integration.use("/*", async (c: Context, next: Next) => {
  const authorization = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const auth = match ? tokens.authenticateToken(match[1]) : null;
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  c.set("userId", auth.userId);
  c.set("streamDeckScopes", auth.scopes);
  c.header("Cache-Control", "no-store");
  return next();
});

function requireScope(scope: tokens.StreamDeckScope) {
  return async (c: Context, next: Next) => {
    if (!c.get("streamDeckScopes").includes(scope)) return c.json({ error: "Forbidden", required_scope: scope }, 403);
    return next();
  };
}

integration.get("/characters", requireScope("characters:read"), (c) => {
  const result = characters.listCharacterSummaries(c.get("userId"), { limit: 200, offset: 0 }, { sort: "name", direction: "asc" });
  return c.json({
    data: result.data.map((character) => ({
      id: character.id,
      name: character.name,
      image_id: character.image_id ?? null,
    })),
    total: result.total,
  });
});

integration.get("/recent-chat", requireScope("chats:read"), (c) => {
  const characterId = c.req.query("characterId");
  const result = characterId
    ? chats.listChats(c.get("userId"), { limit: 1, offset: 0 }, characterId)
    : chats.listRecentChats(c.get("userId"), { limit: 1, offset: 0 });
  return c.json({ chat: result.data[0] ?? null });
});

export { management as streamDeckManagementRoutes, integration as streamDeckIntegrationRoutes };
