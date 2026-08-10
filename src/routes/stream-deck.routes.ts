import { Hono } from "hono";
import type { Context, Next } from "hono";
import * as tokens from "../services/stream-deck-token.service";
import * as characters from "../services/characters.service";
import * as chats from "../services/chats.service";
import * as images from "../services/images.service";
import { parsePagination } from "../services/pagination";
import sharp from "sharp";

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
  const pagination = parsePagination(c.req.query("limit"), c.req.query("offset"), 500);
  const result = characters.listCharacterSummaries(c.get("userId"), pagination, { sort: "name", direction: "asc" });
  return c.json({
    data: result.data.map((character) => ({
      id: character.id,
      name: character.name,
      image_id: character.image_id ?? null,
      image_url: character.image_id
        ? `/api/integrations/stream-deck/v1/characters/${encodeURIComponent(character.id)}/avatar`
        : null,
    })),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
});

integration.get("/characters/:id/avatar", requireScope("characters:read"), async (c) => {
  const userId = c.get("userId");
  const characterId = c.req.param("id");
  if (!characterId) return c.json({ error: "Not found" }, 404);
  const character = characters.getCharacter(userId, characterId);
  if (!character?.image_id) return c.json({ error: "Not found" }, 404);
  const imageId = character.image_id;

  const image = images.getImage(userId, imageId);
  if (!image || !image.mime_type.startsWith("image/")) return c.json({ error: "Not found" }, 404);
  const filepath = await images.getImageFilePath(userId, imageId, "sm");
  if (!filepath) return c.json({ error: "Not found" }, 404);

  // Stream Deck's programmable key-image renderer is inconsistent with WebP
  // data URIs. Normalize to its native 144px key size and a universally
  // supported PNG before the plugin converts the response to a data URI.
  const png = await sharp(filepath)
    .resize(144, 144, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  c.header("Content-Type", "image/png");
  c.header("Content-Length", String(png.byteLength));
  c.header("X-Content-Type-Options", "nosniff");
  const body = new Uint8Array(png.buffer as ArrayBuffer, png.byteOffset, png.byteLength);
  return new Response(body, { headers: c.res.headers });
});

integration.get("/recent-chat", requireScope("chats:read"), (c) => {
  const characterId = c.req.query("characterId");
  const result = characterId
    ? chats.listChats(c.get("userId"), { limit: 1, offset: 0 }, characterId)
    : chats.listRecentChats(c.get("userId"), { limit: 1, offset: 0 });
  return c.json({ chat: result.data[0] ?? null });
});

export { management as streamDeckManagementRoutes, integration as streamDeckIntegrationRoutes };
